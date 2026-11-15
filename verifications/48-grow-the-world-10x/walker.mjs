/* global window */
/**
 * A walker that runs inside the game's page: it plans a route over the
 * map's walkable tiles and walks the local player along it with
 * `player/move` commands, the same commands the keyboard makes. It only
 * reads what the debug API shows and never touches sim state, so the walk
 * is one a player could do by hand.
 *
 * `installWalker` is passed to `page.evaluate`: it must not use anything
 * from outside its own body.
 */
export function installWalker() {
  const api = window.__novaland;
  const { bounds } = api.tiles;
  const solidDefIds = new Set(api.defs.filter((def) => def.solid === true).map((def) => def.id));
  const isWalkable = (tile) => {
    const defId = api.tileDefIdAt(tile);
    return defId !== undefined && !solidDefIds.has(defId);
  };
  const keyOf = (tile) => `${tile.column},${tile.row}`;
  const NEIGHBOURS = [{ column: 1, row: 0 }, { column: -1, row: 0 }, { column: 0, row: 1 }, { column: 0, row: -1 }];

  /** Where the sim (solo) or the replica (online: the last state the server sent) has the local player, in metres. */
  const position = () => {
    const slot = api.localSlot();
    const player = api.snapshot().entities.find((entity) => entity.components.Player?.slot === slot);
    return player ? { x: player.components.Position.x, y: player.components.Position.y } : undefined;
  };
  /** Where the player is on screen, which is what a person steers by: online that is the predicted position, ahead of the server's. */
  const drawnPosition = () => api.online?.localPlayerDrawnAt() ?? position();

  /** The walkable tile nearest to `tile`, itself if it is walkable. */
  const nearestWalkable = (tile) => {
    for (let ring = 0; ring < 12; ring += 1) {
      for (let row = tile.row - ring; row <= tile.row + ring; row += 1) {
        for (let column = tile.column - ring; column <= tile.column + ring; column += 1) {
          if (Math.max(Math.abs(column - tile.column), Math.abs(row - tile.row)) === ring && isWalkable({ column, row })) return { column, row };
        }
      }
    }
    return undefined;
  };

  /**
   * The tiles to step through from one tile to another, up, down, left and
   * right only. Among the ways there it prefers tiles with nothing solid
   * around them, so the walk keeps to the middle of trails. Undefined when
   * there is no way.
   */
  const route = (from, to) => {
    const costOf = (tile) => {
      let solidAround = 0;
      for (let row = tile.row - 1; row <= tile.row + 1; row += 1) {
        for (let column = tile.column - 1; column <= tile.column + 1; column += 1) if (!isWalkable({ column, row })) solidAround += 1;
      }
      return 1 + solidAround;
    };
    const best = new Map([[keyOf(from), 0]]);
    const cameFrom = new Map();
    const open = [{ tile: from, cost: 0 }];
    while (open.length > 0) {
      let cheapest = 0;
      for (let index = 1; index < open.length; index += 1) if (open[index].cost < open[cheapest].cost) cheapest = index;
      const [{ tile, cost }] = open.splice(cheapest, 1);
      if (tile.column === to.column && tile.row === to.row) break;
      if (cost > best.get(keyOf(tile))) continue;
      for (const step of NEIGHBOURS) {
        const next = { column: tile.column + step.column, row: tile.row + step.row };
        if (!isWalkable(next)) continue;
        const nextCost = cost + costOf(next);
        if (nextCost >= (best.get(keyOf(next)) ?? Infinity)) continue;
        best.set(keyOf(next), nextCost);
        cameFrom.set(keyOf(next), tile);
        open.push({ tile: next, cost: nextCost });
      }
    }
    if (!best.has(keyOf(to))) return undefined;
    const tiles = [to];
    while (keyOf(tiles[0]) !== keyOf(from)) tiles.unshift(cameFrom.get(keyOf(tiles[0])));
    return tiles;
  };

  const walk = {
    state: 'standing',
    /**
     * One entry per frame drawn while walking: `ms` after the frame before
     * it, `gameMs` of that spent in the game's own update and render (the
     * rest is the browser's), and whether a chunk was built or dropped in it.
     */
    frames: [],
    /** Most chunks drawn at once, and chunks the camera showed that were not drawn, over every frame of the walk. */
    mostChunksDrawn: 0,
    missingChunkFrames: 0,
    legs: [],
    position,
    nearestWalkable,
    route,
    bounds,
  };
  let leg;
  let lastFrameAt;
  let lastSent;
  let lastSentAt = 0;

  const send = (direction, now) => {
    api.queueCommand({ type: 'player/move', slot: api.localSlot(), x: direction.x, y: direction.y });
    lastSent = direction;
    lastSentAt = now;
  };

  /** Starts walking to `tile`. `walk.state` becomes 'arrived' or 'stuck'. */
  walk.walkTo = (tile) => {
    const at = drawnPosition();
    const from = api.tileAt(at.x, at.y);
    const tiles = route(from, tile);
    if (!tiles) {
      walk.state = 'no-route';
      return;
    }
    leg = { from, to: tile, tiles, next: 0, startedAt: window.performance.now(), progressAt: window.performance.now(), metres: (tiles.length - 1) * api.tiles.tileSize };
    lastSent = undefined;
    // Planning the route took a while, in this script, not in the game: the frame it fell in is not counted.
    lastFrameAt = undefined;
    walk.state = 'walking';
  };

  // Steering: head for the next tile centre of the route; a new command only when the heading changes, as the keyboard does.
  window.setInterval(() => {
    if (walk.state !== 'walking') return;
    const now = window.performance.now();
    const at = drawnPosition();
    let target = api.tileCentre(leg.tiles[leg.next]);
    while (Math.hypot(target.x - at.x, target.y - at.y) < 0.3) {
      leg.next += 1;
      leg.progressAt = now;
      if (leg.next === leg.tiles.length) {
        send({ x: 0, y: 0 }, now);
        walk.legs.push({ from: leg.from, to: leg.to, tiles: leg.tiles.length, metres: leg.metres, seconds: (now - leg.startedAt) / 1000 });
        walk.state = 'arrived';
        return;
      }
      target = api.tileCentre(leg.tiles[leg.next]);
    }
    if (now - leg.progressAt > 4000) {
      send({ x: 0, y: 0 }, now);
      walk.stuckAt = { position: at, next: leg.tiles[leg.next] };
      walk.state = 'stuck';
      return;
    }
    const length = Math.hypot(target.x - at.x, target.y - at.y);
    const heading = { x: (target.x - at.x) / length, y: (target.y - at.y) / length };
    // The room takes 20 messages a second from a seat: stay well under it.
    const turned = !lastSent || lastSent.x * heading.x + lastSent.y * heading.y < 0.995;
    if (turned && now - lastSentAt > 120) send(heading, now);
  }, 40);

  // Every frame the game renders while walking: its length, and what terrain was drawn in it.
  let lastChunks = '';
  let updateMs = 0;
  let renderStartedAt;
  const scene = api.game.scene.getScene('world');
  const sceneUpdate = scene.update.bind(scene);
  scene.update = (time, deltaMs) => {
    const startedAt = window.performance.now();
    sceneUpdate(time, deltaMs);
    updateMs = window.performance.now() - startedAt;
  };
  api.game.events.on('prerender', () => {
    renderStartedAt = window.performance.now();
  });
  api.game.events.on('postrender', () => {
    const now = window.performance.now();
    const terrain = api.terrain();
    const chunks = terrain ? [...terrain.chunksDrawn].sort().join(' ') : '';
    if (walk.state === 'walking' && lastFrameAt !== undefined && terrain) {
      walk.frames.push({ ms: now - lastFrameAt, gameMs: updateMs + (now - renderStartedAt), chunksChanged: chunks !== lastChunks });
      walk.mostChunksDrawn = Math.max(walk.mostChunksDrawn, terrain.chunksDrawn.length);
      const view = api.game.scene.getScene('world').cameras.main.worldView;
      const chunkPixels = api.chunkSize * api.tiles.tileSize * api.pixelsPerMetre;
      const missing = api.tiles.chunks.some(
        (chunk) => chunk.column * chunkPixels < view.x + view.width && (chunk.column + 1) * chunkPixels > view.x && chunk.row * chunkPixels < view.y + view.height && (chunk.row + 1) * chunkPixels > view.y && !terrain.chunksDrawn.includes(`${chunk.column},${chunk.row}`),
      );
      if (missing) walk.missingChunkFrames += 1;
    }
    lastFrameAt = now;
    lastChunks = chunks;
  });

  window.__walk = walk;
}
