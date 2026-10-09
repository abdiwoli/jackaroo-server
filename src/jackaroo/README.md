# Jackaroo game engine

Pure TypeScript rules engine for 1v1, three-player, four-player, and 2v2 team games. Import from `./index.js`. It has no transport, database, mobile, or UI dependencies. The authoritative 1v1 rules live in the workspace's `JACKAROO-RULES.md`; multi-player and team rules live in `GAME-MODES.md`.

```typescript
import { createGame, startGame, getLegalActions, applyAction } from './jackaroo/index.js';

let state = startGame(createGame(['player-a', 'player-b']));
const choices = getLegalActions(state);
const chosen = choices[0]; // A caller selects a complete server-provided action.
if (chosen) state = applyAction(state, chosen.action);
```

This is an API example, not a simulation or network endpoint.

## Transitions

`createGame(ids, { mode?, deck?, rng?, board? })` creates a game with base marbles. Mode defaults to 1v1 and is inferred from three or four supplied player IDs when omitted. Inject a complete physical deck to preserve exact order, or inject an RNG to control shuffling. The default uses `Math.random`; all transition randomness is injectable, and no RNG is stored in state.

`startGame(state)` deals the first hand. `applyAction(state, action, { rng? })` dispatches a play or validated forced discard, consumes the card, checks winning, advances scheduled turns, and redeals when needed. `playCard` and `discardCard` are also available separately. Every transition returns a detached new state. Invalid actions throw `RuleError` and leave input state unchanged.

`getLegalActions(state)` returns action envelopes with travelled paths, ordered captured marble IDs, and destinations. It returns forced-discard choices only when no play exists. `getLegalCards` returns playable cards, excluding forced-discard-only cards. Generated actions can be submitted directly to `applyAction`.

`dealCards` requires both hands empty and no pending forced discard. `endTurn` only permits an empty-hand pass; callers cannot use it to bypass a nonempty hand. Normal actions resolve turns automatically. `getCurrentPlayer` returns a detached player snapshot or null. `checkWinner` inspects completed home occupancy; successful actions set finished status and reject subsequent actions.

Home positions in state are zero-based (0–3 = Home 1–4). Track positions are global, but forward home routing is calculated relative to each owner's configured start. Backward 4 remains on the circular track. Jack simply relocates track coordinates. Protection is derived from owner plus own start, so it changes automatically on movement/swap/release/capture.

Queen and the `ten-discard` action set `pendingDiscardPlayerId` to the opponent. Their turn offers a discard action for every held card and rejects all normal card effects. The opponent chooses one card to discard, clearing the effect and ending that turn. If their hand is empty, the effect clears before a new deal. Both local and online views expose the pending player ID so clients explain the forced-discard turn.

King metadata includes own and opponent path kills. Internal draft movement helpers are implementation details; callers use validated engine transitions, not direct movement operations. `assertGameState` checks fixture integrity and card conservation. Exact-state tests may construct hands/positions, but must preserve all physical cards and legal occupancy.

## Checks

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:jackaroo
npm.cmd test
```

Step 2 introduced the foundation/card examples. Step 3 adds exhaustive track/home origin matrices, swap-position pairs, complete split choices, special-card boundary tests, and invalid-input regressions. Tests cover both players and every suit. These bounded matrices do not enumerate every possible global board/hand combination. Step 4 adds backend-only full-game simulations under `../simulation/`; the rules engine remains independent of that test harness.
