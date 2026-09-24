import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { simulateGame, type SimulationResult } from './runner.js';
import type { Policy } from './policy.js';
import { RANKS } from '../jackaroo/types.js';

function parseArgs(args: string[]) {
  const options = { games: 100, seed: 1, maxActions: 5000, policy: 'mixed' as Policy };
  const flags = new Map<string, 'games' | 'seed' | 'maxActions' | 'policy'>([['--games', 'games'], ['--seed', 'seed'], ['--max-actions', 'maxActions'], ['--policy', 'policy']]);
  for (let index = 0; index < args.length; index += 2) {
    const key = flags.get(args[index]!);
    const raw = args[index + 1];
    if (!key || raw === undefined) throw new Error(`Unknown/incomplete flag: ${args[index]}`);
    if (key === 'policy') {
      if (!['progress', 'mixed', 'random'].includes(raw)) throw new Error('Policy must be progress, mixed or random');
      options.policy = raw as Policy;
    } else {
      const value = Number(raw);
      if (!Number.isSafeInteger(value) || value < (key === 'seed' ? 0 : 1)) throw new Error(`Invalid ${key}`);
      options[key] = value;
    }
  }
  if (options.seed + options.games - 1 > 0xffffffff) throw new Error('Seed range must fit unsigned 32-bit integers');
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const results: SimulationResult[] = [];
  for (let index = 0; index < options.games; index++) {
    results.push(simulateGame({ seed: options.seed + index, maxActions: options.maxActions, policy: options.policy, trace: index === 0 }));
    if ((index + 1) % 10 === 0) console.log(`Verified ${index + 1}/${options.games} complete games`);
  }
  const sum = (key: keyof SimulationResult) => results.reduce((total, result) => total + Number(result[key]), 0);
  const summary = {
    options, completed: results.length, failed: 0,
    winners: Object.fromEntries(['Player A', 'Player B'].map(id => [id, results.filter(result => result.winnerId === id).length])),
    actions: sum('actions'), minActions: Math.min(...results.map(result => result.actions)), maxActions: Math.max(...results.map(result => result.actions)),
    redeals: sum('redeals'), reshuffles: sum('reshuffles'), captures: sum('captures'), ownKingKills: sum('ownKingKills'),
    normalCaptures: sum('normalCaptures'), kingCaptures: sum('kingCaptures'), releaseCaptures: sum('releaseCaptures'),
    homeEntries: sum('homeEntries'), emptyPasses: sum('emptyPasses'), queenSkips: sum('queenSkips'), splitSevens: sum('splitSevens'),
    releases: sum('releases'), swaps: sum('swaps'), discards: sum('discards'), rejectedProbes: sum('rejectedProbes'),
    playedRanks: Object.fromEntries(RANKS.map(rank => [rank, results.reduce((total, result) => total + result.playedRanks[rank], 0)])),
  };
  const directory = resolve('simulation-results');
  await mkdir(directory, { recursive: true });
  const label = `${options.policy}-${options.seed}-${options.games}`;
  const games = results.map(result => Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'trace' && key !== 'finalState')));
  await writeFile(resolve(directory, `${label}-summary.json`), JSON.stringify({ summary, games }, null, 2));
  await writeFile(resolve(directory, `${label}-trace.json`), JSON.stringify(results[0]!.trace, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Summary and first complete game trace written to ${directory}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
