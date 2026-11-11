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
