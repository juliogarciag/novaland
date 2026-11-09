import { describe, expect, it } from 'vitest';
import { Seats } from './seats';

describe('Seats', () => {
  it('hands out the lowest free slot and refuses when every seat is taken', () => {
    const seats = new Seats(3);
    expect(seats.claim('a')).toBe(0);
    expect(seats.claim('b')).toBe(1);
    expect(seats.claim('c')).toBe(2);
    expect(seats.claim('d')).toBeUndefined();
    expect(seats.taken).toBe(3);
  });

  it('gives a released seat to the next session, lowest first', () => {
    const seats = new Seats(3);
    seats.claim('a');
    seats.claim('b');
    seats.claim('c');
    expect(seats.release('b')).toBe(1);
    expect(seats.release('a')).toBe(0);
    expect(seats.claim('d')).toBe(0);
    expect(seats.claim('e')).toBe(1);
    expect(seats.slotOf('c')).toBe(2);
  });

  it('never seats the same session twice and releasing a stranger frees nothing', () => {
    const seats = new Seats(2);
    expect(seats.claim('a')).toBe(0);
    expect(seats.claim('a')).toBeUndefined();
    expect(seats.release('ghost')).toBeUndefined();
    expect(seats.taken).toBe(1);
    expect(seats.slotOf('ghost')).toBeUndefined();
  });
});
