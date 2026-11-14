/**
 * Rows of a generated map, for measurements: a forest two tiles thick around
 * the edge and, inside it, trees and rocks scattered by a fixed rule (about
 * one tile in thirty-three is solid). The same size always gives the same rows.
 * It is plain characters, so the baseline (a level) and the new code (an
 * area) are measured on the same ground: T tree, o rock, . grass.
 */
export function generatedRows({ columns, rows }) {
  let state = (columns * 73856093) ^ (rows * 19349663);
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const result = [];
  for (let row = 0; row < rows; row += 1) {
    let text = '';
    for (let column = 0; column < columns; column += 1) {
      const onEdge = row < 2 || column < 2 || row >= rows - 2 || column >= columns - 2;
      const roll = next();
      text += onEdge ? 'T' : roll < 0.02 ? 'T' : roll < 0.03 ? 'o' : '.';
    }
    result.push(text);
  }
  return result;
}

/** A walkable tile near the middle of generated rows: where players appear on a generated map. */
export function generatedSpawn(rows) {
  const centre = { column: Math.floor(rows[0].length / 2), row: Math.floor(rows.length / 2) };
  for (let ring = 0; ring < rows.length; ring += 1) {
    for (let row = centre.row - ring; row <= centre.row + ring; row += 1) {
      for (let column = centre.column - ring; column <= centre.column + ring; column += 1) {
        if (rows[row]?.[column] === '.') return { column, row };
      }
    }
  }
  throw new Error('generated rows have no walkable tile');
}

/**
 * The moves of a scripted walk: five players, each given a new direction
 * every `ticksPerMove` ticks by a fixed rule. `commandsAt(tick)` is what to
 * hand `sim.step` for that tick; the joins come at tick 0.
 */
export function scriptedWalk({ players = 5, ticksPerMove = 30 } = {}) {
  let state = 0x9e3779b9;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const directions = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }, { x: 0, y: 0 },
  ];
  return {
    players,
    commandsAt(tick) {
      if (tick === 0) return Array.from({ length: players }, (_, slot) => ({ type: 'player/join', slot }));
      if (tick % ticksPerMove !== 0) return [];
      return Array.from({ length: players }, (_, slot) => ({ type: 'player/move', slot, ...directions[Math.floor(next() * directions.length)] }));
    },
  };
}
