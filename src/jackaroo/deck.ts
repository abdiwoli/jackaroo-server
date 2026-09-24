import { RANKS, SUITS, type Card, type RNG } from './types.js';
import { requireRule } from './rules.js';

export function createDeck(): Card[] {
  return SUITS.flatMap(suit => RANKS.map(rank => ({ id: `${rank}-${suit}`, rank, suit })));
}
export function validateDeck(deck: Card[]) {
  const canonical = createDeck();
  requireRule(deck.length === canonical.length && new Set(deck.map(card => card.id)).size === canonical.length, 'Expected unique 52-card deck');
  requireRule(deck.every(card => canonical.some(expected => expected.id === card.id && expected.rank === card.rank && expected.suit === card.suit)), 'Invalid physical card');
}
export function shuffle(cards: Card[], rng: RNG = Math.random): Card[] {
  const result = structuredClone(cards);
  for (let i = result.length - 1; i > 0; i--) {
    const sample = rng();
    requireRule(Number.isFinite(sample) && sample >= 0 && sample < 1, 'RNG must return a number in [0, 1)');
    const j = Math.floor(sample * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
