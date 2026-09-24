import type { Rank } from './types.js';

export const V1_RULES = Object.freeze({
  playerCount: 2,
  cardsPerHand: 5,
  maxSevenMarbles: 2,
  sevenPoints: 7,
  initialStarterIndex: 0,
});
export const MOVEMENT: Partial<Record<Rank, number>> = Object.freeze({
  A: 1, '2': 2, '3': 3, '4': -4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, K: 13,
});
export class RuleError extends Error {
  constructor(message: string) { super(message); this.name = 'RuleError'; }
}
export function requireRule(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RuleError(message);
}
