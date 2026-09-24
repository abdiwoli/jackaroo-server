import { requireRule } from '../jackaroo/rules.js';
import type { RNG } from '../jackaroo/types.js';

export function seededRng(seed: number): RNG {
  requireRule(Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'Seed must be an unsigned 32-bit integer');
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), value | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
