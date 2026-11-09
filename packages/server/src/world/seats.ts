/**
 * The seats of a room: which session holds which slot. The slot is the
 * number the player feature and every command use; the server stamps it on
 * what a session sends. Seats are handed out lowest-free-first so a leaver's
 * seat is the next one taken.
 */
export class Seats {
  private readonly slotBySession = new Map<string, number>();

  constructor(private readonly maxSeats: number) {}

  get taken(): number {
    return this.slotBySession.size;
  }

  /** The lowest free slot, now held by `sessionId`; undefined when every seat is taken or the session already holds one. */
  claim(sessionId: string): number | undefined {
    if (this.slotBySession.has(sessionId)) return undefined;
    const held = new Set(this.slotBySession.values());
    for (let slot = 0; slot < this.maxSeats; slot += 1) {
      if (!held.has(slot)) {
        this.slotBySession.set(sessionId, slot);
        return slot;
      }
    }
    return undefined;
  }

  /** The slot `sessionId` held, now free; undefined when it held none. */
  release(sessionId: string): number | undefined {
    const slot = this.slotBySession.get(sessionId);
    this.slotBySession.delete(sessionId);
    return slot;
  }

  slotOf(sessionId: string): number | undefined {
    return this.slotBySession.get(sessionId);
  }
}
