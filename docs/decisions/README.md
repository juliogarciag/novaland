# Architecture decisions

One file per decision, numbered, never edited after the fact (write a new one that supersedes it). Keep them short: context, decision, consequences.

- [0001 - Entity/component layer: bitECS with data definitions](0001-ecs.md)
- [0002 - Physics: Rapier deterministic build inside the sim](0002-physics.md)
- [0003 - Levels as tile grids](0003-levels-as-tiles.md)
- [0004 - Multiplayer netcode: an authoritative server and replica clients](0004-multiplayer-netcode.md)
- [0005 - The world room: one fixed room id, join by id only, and how "full" reaches the client](0005-world-room-join.md)
- [0006 - Client online mode: one playable world, two ways to fill it](0006-client-online-mode.md)
- [0007 - Physics loads on demand](0007-physics-loads-on-demand.md)
- [0008 - The server's HTTP front: its own half, libraries for the work, Colyseus's hooks for the wiring](0008-http-front.md)
- [0009 - Hosting on Railway: one service, settings as code, deploys gated by CI](0009-hosting-on-railway.md)
- [0010 - Standing tiles: tall tile art is one image per tile, sorted among the entities](0010-standing-tiles.md)
- [0011 - Ground textures: a flat tile's art is a sheet of variants copied into the ground tileset](0011-ground-tile-textures.md)
- [0012 - Client-side prediction: a second, local sim that only ever guesses](0012-client-side-prediction.md)
- [0013 - The world as chunks: one map that grows, authored as areas, with terrain out of world state](0013-world-as-chunks.md)
- [0015 - The player's character: a look as palette indexes, a name as code points, both chosen by the player and judged by the sim](0015-player-character.md)
