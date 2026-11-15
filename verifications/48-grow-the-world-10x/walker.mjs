/* global window */
/**
 * A walker that runs inside the game's page: it plans a route over the
 * map's walkable tiles and walks the local player along it with
 * `player/move` commands, the same commands the keyboard makes. It only
 * reads what the debug API shows and never touches sim state, so the walk
 * is one a player could do by hand.
 *
 * Both functions are passed to the page (`page.addInitScript`,
 * `page.evaluate`): neither may use anything from outside its own body.
 */

/**
 * Before the page loads: times every WebSocket message handler, so the work
 * the game does when a server state arrives (writing the replica,
 * reconciling the prediction) is counted in the frame it delayed. The total
 * so far is `window.__messageHandlerMs`.
 */
export function timeMessageHandlers() {
  window.__messageHandlerMs = 0;
  const timed = (handler) =>
    typeof handler !== 'function'
      ? handler
      : function timedHandler(event) {
          const startedAt = window.performance.now();
          try {
            return handler.call(this, event);
          } finally {
            window.__messageHandlerMs += window.performance.now() - startedAt;
          }
        };
  const { addEventListener } = window.WebSocket.prototype;
  window.WebSocket.prototype.addEventListener = function addTimedListener(type, handler, options) {
    return addEventListener.call(this, type, type === 'message' ? timed(handler) : handler, options);
  };
  const onMessage = Object.getOwnPropertyDescriptor(window.WebSocket.prototype, 'onmessage');
  Object.defineProperty(window.WebSocket.prototype, 'onmessage', {
    configurable: true,
    get() {
      return onMessage.get.call(this);
    },
    set(handler) {
      onMessage.set.call(this, timed(handler));
    },
  });
}

/** Once the game plays: puts the walker on `window.__walk`. */
export function installWalker() {
  const game = window.__novaland;
  const solidDefIds = new Set(game.defs.filter((def) => def.solid === true).map((def) => def.id));
  const isWalkable = (tile) => {
    const defId = game.tileDefIdAt(tile);
    return defId !== undefined && !solidDefIds.has(defId);
  };
  const keyOf = (tile) => `${tile.column},${tile.row}`;
  const NEIGHBOURS = [{ column: 1, row: 0 }, { column: -1, row: 0 }, { column: 0, row: 1 }, { column: 0, row: -1 }];
  /** Milliseconds this walker spent reading snapshots since the last frame: its own load on the page, kept out of the game's. */
  let walkerMsThisFrame = 0;

  /** Where the sim (solo) or the replica (online: the last state the server sent) has the local player, in metres. */
  const simPosition = () => {
    const startedAt = window.performance.now();
    const slot = game.localSlot();
    const player = game.snapshot().entities.find((entity) => entity.components.Player?.slot === slot);
    walkerMsThisFrame += window.performance.now() - startedAt;
    return player ? { x: player.components.Position.x, y: player.components.Position.y } : undefined;
  };
  /** Where the player is on screen, which is what a person steers by: online that is the predicted position, ahead of the server's. */
  const drawnPosition = () => game.online?.localPlayerDrawnAt() ?? simPosition();

  /** The walkable tile nearest to `tile`, itself if it is walkable. */
  const nearestWalkableTile = (tile) => {
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
  const routeBetween = (from, to) => {
    const costOfEntering = (tile) => {
      let solidAround = 0;
      for (let row = tile.row - 1; row <= tile.row + 1; row += 1) {
        for (let column = tile.column - 1; column <= tile.column + 1; column += 1) if (!isWalkable({ column, row })) solidAround += 1;
      }
      return 1 + solidAround;
    };
    const cheapestCostTo = new Map([[keyOf(from), 0]]);
    const tileBefore = new Map();
    const tilesToExpand = [{ tile: from, cost: 0 }];
    while (tilesToExpand.length > 0) {
      let cheapest = 0;
      for (let index = 1; index < tilesToExpand.length; index += 1) if (tilesToExpand[index].cost < tilesToExpand[cheapest].cost) cheapest = index;
      const [{ tile, cost }] = tilesToExpand.splice(cheapest, 1);
      if (tile.column === to.column && tile.row === to.row) break;
      if (cost > cheapestCostTo.get(keyOf(tile))) continue;
      for (const step of NEIGHBOURS) {
        const neighbour = { column: tile.column + step.column, row: tile.row + step.row };
        if (!isWalkable(neighbour)) continue;
        const costToNeighbour = cost + costOfEntering(neighbour);
        if (costToNeighbour >= (cheapestCostTo.get(keyOf(neighbour)) ?? Infinity)) continue;
        cheapestCostTo.set(keyOf(neighbour), costToNeighbour);
        tileBefore.set(keyOf(neighbour), tile);
        tilesToExpand.push({ tile: neighbour, cost: costToNeighbour });
      }
    }
    if (!cheapestCostTo.has(keyOf(to))) return undefined;
    const tiles = [to];
    while (keyOf(tiles[0]) !== keyOf(from)) tiles.unshift(tileBefore.get(keyOf(tiles[0])));
    return tiles;
  };

  const walk = {
    /** 'standing', 'walking', 'arrived', 'stuck' or 'no-route'. */
    state: 'standing',
    /**
     * One entry per frame drawn while walking: `ms` since the frame before;
     * `gameMs` of that spent in the game (the scene's update, the render
     * call, and the WebSocket message handlers that ran since the frame
     * before); `walkerMs` this walker spent reading snapshots;
     * `framesSinceChunkChange`, 0 for a frame whose update built or dropped
     * a chunk; and the tile the player was on.
     */
    frames: [],
    /** Most chunks drawn at once, and frames in which a chunk the camera showed was not drawn. */
    mostChunksDrawn: 0,
    framesMissingAChunk: 0,
    /** One entry per finished leg: its route, how long it took, and the least way the player made in any thirty ticks of it. */
    legs: [],
    simPosition,
    nearestWalkableTile,
  };
  let leg;
  let lastFrameAt;
  let headingSent;
  let headingSentAt = 0;

  const sendHeading = (heading, now) => {
    game.queueCommand({ type: 'player/move', slot: game.localSlot(), x: heading.x, y: heading.y });
    headingSent = heading;
    headingSentAt = now;
  };

  /** Starts walking to `tile`. `walk.state` becomes 'arrived' or 'stuck' when the walk ends, or 'no-route' at once. */
  walk.walkTo = (tile) => {
    const startsAt = drawnPosition();
    const from = game.tileAt(startsAt.x, startsAt.y);
    const tiles = routeBetween(from, tile);
    if (!tiles) {
      walk.state = 'no-route';
      return;
    }
    const now = window.performance.now();
    leg = { from, to: tile, tiles, nextTileIndex: 0, startedAt: now, lastProgressAt: now, metres: (tiles.length - 1) * game.tiles.tileSize, thirtyTicksStartedAt: game.sim.tick, lastSampledAt: simPosition(), metresTheseThirtyTicks: 0, metresPerThirtyTicks: [] };
    headingSent = undefined;
    // Planning the route took a while, in this script, not in the game: the frame it fell in is not counted.
    lastFrameAt = undefined;
    walk.state = 'walking';
  };

  // Steering: head for the next tile centre of the route; a new command only when the heading changes, as the keyboard does.
  window.setInterval(() => {
    if (walk.state !== 'walking') return;
    const now = window.performance.now();
    const steersFrom = drawnPosition();
    // Way made in every thirty ticks of the leg, half a second of the game's own time: the length of the path the sim
    // (solo) or the server (online) moved the player along, sampled here, so a turn counts as much as a straight line
    // and only a player the world held up counts as less. Ticks, not the clock: a page the machine starves of frames
    // runs fewer ticks, and that is not the world's doing.
    const sampledAt = simPosition();
    leg.metresTheseThirtyTicks += Math.hypot(sampledAt.x - leg.lastSampledAt.x, sampledAt.y - leg.lastSampledAt.y);
    leg.lastSampledAt = sampledAt;
    const ticksSince = game.sim.tick - leg.thirtyTicksStartedAt;
    if (ticksSince >= 30) {
      leg.metresPerThirtyTicks.push((leg.metresTheseThirtyTicks * 30) / ticksSince);
      leg.thirtyTicksStartedAt = game.sim.tick;
      leg.metresTheseThirtyTicks = 0;
    }
    let target = game.tileCentre(leg.tiles[leg.nextTileIndex]);
    while (Math.hypot(target.x - steersFrom.x, target.y - steersFrom.y) < 0.3) {
      leg.nextTileIndex += 1;
      leg.lastProgressAt = now;
      if (leg.nextTileIndex === leg.tiles.length) {
        sendHeading({ x: 0, y: 0 }, now);
        // The first thirty ticks start from standing: that is not walking yet.
        const walkingSpans = leg.metresPerThirtyTicks.slice(1);
        walk.legs.push({ from: leg.from, to: leg.to, tiles: leg.tiles.length, metres: leg.metres, seconds: (now - leg.startedAt) / 1000, spansOfThirtyTicks: walkingSpans.length, leastMetresInThirtyTicks: Math.min(...walkingSpans) });
        walk.state = 'arrived';
        return;
      }
      target = game.tileCentre(leg.tiles[leg.nextTileIndex]);
    }
    if (now - leg.lastProgressAt > 4000) {
      sendHeading({ x: 0, y: 0 }, now);
      walk.stuckAt = { position: steersFrom, nextTile: leg.tiles[leg.nextTileIndex] };
      walk.state = 'stuck';
      return;
    }
    const metresToTarget = Math.hypot(target.x - steersFrom.x, target.y - steersFrom.y);
    const heading = { x: (target.x - steersFrom.x) / metresToTarget, y: (target.y - steersFrom.y) / metresToTarget };
    // The room takes 20 messages a second from a seat: stay well under it.
    const turned = !headingSent || headingSent.x * heading.x + headingSent.y * heading.y < 0.995;
    if (turned && now - headingSentAt > 120) sendHeading(heading, now);
  }, 40);

  // Every frame the game renders while walking: how long it took, how much of that was the game's, and what terrain was drawn.
  let chunksDrawnLastFrame = '';
  let framesSinceChunkChange = Infinity;
  let updateMs = 0;
  let renderStartedAt;
  let messageHandlerMsAtLastFrame = window.__messageHandlerMs ?? 0;
  const scene = game.game.scene.getScene('world');
  const sceneUpdate = scene.update.bind(scene);
  scene.update = (time, deltaMs) => {
    const startedAt = window.performance.now();
    sceneUpdate(time, deltaMs);
    updateMs = window.performance.now() - startedAt;
  };
  game.game.events.on('prerender', () => {
    renderStartedAt = window.performance.now();
  });
  game.game.events.on('postrender', () => {
    const now = window.performance.now();
    const terrain = game.terrain();
    const chunksDrawn = terrain ? [...terrain.chunksDrawn].sort().join(' ') : '';
    framesSinceChunkChange = chunksDrawn === chunksDrawnLastFrame ? framesSinceChunkChange + 1 : 0;
    const messageHandlerMs = window.__messageHandlerMs ?? 0;
    if (walk.state === 'walking' && lastFrameAt !== undefined && terrain) {
      const drawnAt = game.online?.localPlayerDrawnAt();
      walk.frames.push({
        ms: now - lastFrameAt,
        gameMs: updateMs + (now - renderStartedAt) + (messageHandlerMs - messageHandlerMsAtLastFrame),
        walkerMs: walkerMsThisFrame,
        framesSinceChunkChange: Number.isFinite(framesSinceChunkChange) ? framesSinceChunkChange : null,
        tile: drawnAt ? game.tileAt(drawnAt.x, drawnAt.y) : leg.tiles[Math.min(leg.nextTileIndex, leg.tiles.length - 1)],
      });
      walk.mostChunksDrawn = Math.max(walk.mostChunksDrawn, terrain.chunksDrawn.length);
      const view = scene.cameras.main.worldView;
      const chunkPixels = game.chunkSize * game.tiles.tileSize * game.pixelsPerMetre;
      const isMissingAChunk = game.tiles.chunks.some(
        (chunk) => chunk.column * chunkPixels < view.x + view.width && (chunk.column + 1) * chunkPixels > view.x && chunk.row * chunkPixels < view.y + view.height && (chunk.row + 1) * chunkPixels > view.y && !terrain.chunksDrawn.includes(`${chunk.column},${chunk.row}`),
      );
      if (isMissingAChunk) walk.framesMissingAChunk += 1;
    }
    walkerMsThisFrame = 0;
    messageHandlerMsAtLastFrame = messageHandlerMs;
    lastFrameAt = now;
    chunksDrawnLastFrame = chunksDrawn;
  });

  window.__walk = walk;
}
