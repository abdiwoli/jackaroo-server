# Step 4: complete backend-only 1v1 simulation

Run from `jackaroo-server`:

```powershell
npm.cmd run simulate:jackaroo -- --games 100 --seed 1 --policy mixed
npm.cmd run simulate:jackaroo -- --games 10 --seed 1 --policy random
npm.cmd run test:simulation
```

No HTTP server, mobile app, database, or external service is needed. Each game starts normally with four base marbles per player, a shuffled standard deck, five cards each, and Player A starting hand 1. Two fake players choose only from `getLegalActions`, submitting actions through `applyAction` until a winner is returned. No positions/hands are patched during a simulation, no cards are forced into hands, and no winner is fabricated.

## Determinism and bots

Deck and action selection use separate seeded random streams. Initial shuffles and subsequent reshuffles share the injected deck stream. Each game's seed is the starting seed plus its index, so any game can be reproduced individually.

`progress` chooses the greatest heuristic progress with seeded tie-breaking. `mixed` uses that strategy but sometimes chooses a random legal action. `random` uniformly chooses among supplied legal actions. These are simulation strategies, not new gameplay rules, production AI, or a second legality engine. Bots can see backend state for testing.

Default action limit is 5,000 per game. Override with `--max-actions N`. Reaching the limit is an explicit failure with seed, policy, action, and hand context; it is never recorded as a completed game. The command stops with nonzero exit status on a failure rather than skipping failed seeds.

## Verification on every action

The simulation checks:

- State geometry, ownership, occupancy and conservation of all 52 physical cards.
- Current-player ownership, consumed card, no replacement draw, discard order, redeal trigger, five-card dealing, alternate hand starter, and reshuffle preservation of undealt remainder.
- Ordinary scheduling, Queen once-only skip including empty hands, and automatic empty-hand passes.
- Independent relative-coordinate path arithmetic, actual marble changes, ordered captures, protection, home privacy/blocking, and agreement between legal-action metadata and resulting state.
- Original input state is unchanged after both legal commits and rejected fake-card/out-of-turn probes.
- Actual complete home occupancy determines the finished winner, no redeal occurs after winning, no further choices exist, and post-finish actions reject.

The auditor is a test verifier, not an API for generating or applying game actions. All actual gameplay uses the existing authoritative backend engine.

## Artifacts

`simulation-results/POLICY-SEED-GAMES-summary.json` stores aggregate checks and each game's outcome/counters. `simulation-results/POLICY-SEED-GAMES-trace.json` stores the first game's initial state and every chronological action, metadata, and resulting state through completion. Subsequent runs with identical options overwrite that run's artifacts. The trace contains internal backend hands for diagnostics; it is not a client payload.

`replayTrace(seed, trace)` reproduces the initial shuffle and every action/reshuffle, audits each transition, and requires exactly the recorded winner/final state. Tests verify deterministic results, complete replay, all strategies, explicit action-limit failure, and auditor rejection of deliberately corrupted transitions/traces.

Stop before Step 5 mobile board implementation.
