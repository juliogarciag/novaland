import { describe, expect, it } from 'vitest';
import { CURSORS, DEFAULT_CURSOR_NAME, cursorAfter, cursorDeclarations, cursorNamed } from './cursors';

describe('cursorAfter', () => {
  it('goes through every cursor once and comes back to the first', () => {
    const visited = [DEFAULT_CURSOR_NAME];
    for (let presses = 1; presses < CURSORS.length; presses += 1) visited.push(cursorAfter(visited[visited.length - 1] ?? DEFAULT_CURSOR_NAME));
    expect(visited).toEqual(CURSORS.map((cursor) => cursor.name));
    expect(cursorAfter(visited[visited.length - 1] ?? DEFAULT_CURSOR_NAME)).toBe(DEFAULT_CURSOR_NAME);
  });
});

describe('cursorDeclarations', () => {
  it('names the image for each screen, clicks at the hotspot and falls back to the default pointer', () => {
    expect(cursorDeclarations('dark-dart')).toEqual([
      "url('/cursors/dark-dart.png') 0 0, auto",
      "image-set(url('/cursors/dark-dart.png') 1x, url('/cursors/dark-dart@2x.png') 2x) 0 0, auto",
    ]);
  });
});

describe('cursorNamed', () => {
  it('takes the names of the list and nothing else', () => {
    for (const cursor of CURSORS) expect(cursorNamed(cursor.name)).toBe(cursor.name);
    for (const remembered of [null, undefined, '', 'arrow', 'warm-arrow ', 3, { name: 'warm-arrow' }]) expect(cursorNamed(remembered)).toBeUndefined();
  });
});
