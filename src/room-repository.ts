import type { Room } from './online-games.js';

export interface RoomRepository {
  // false indicates an invitation-code collision; no room was inserted.
  insert(room: Room): Promise<boolean>;
  findById(id: string): Promise<Room | null>;
  findByCode(code: string): Promise<Room | null>;
  // Must atomically check both the revision and expiry before replacing the row.
  save(room: Room, expectedRevision: number, now: number): Promise<boolean>;
  deleteExpired(now: number): Promise<void>;
}
