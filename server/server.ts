import type * as Party from "partykit/server";
import {
  MOVE_SPEED,
  WINNING_SCORE,
  WORLD_LIMIT,
  parseClientMessage,
  type ClientMessage,
  type DropState,
  type GameState,
  type MaterialKind,
  type PlayerState,
  type ProjectileState,
  type ServerMessage,
} from "../src/shared/protocol";

const COLORS = [0x67e8f9, 0x818cf8, 0xe879f9, 0xfb7185, 0xfbbf24, 0x4ade80, 0xf97316, 0xa3e635];
const MATERIALS: MaterialKind[] = ["glass", "rubber", "wood", "metal", "ceramic", "crystal"];
const SPAWNS = [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [4, 4], [-4, -4], [4, -4], [-4, 4]] as const;
const MAX_PLAYERS = 20;
const POSITION_TOLERANCE = 0.85;
const DROP_COUNT = 5;
const PLAYER_HIT_RADIUS = 0.72;
const DROP_COLLECT_RADIUS = 1.05;
const PROJECTILE_SPEED = 7.5;
const MAX_PROJECTILES = 14;

export default class CubeWorldRoom implements Party.Server {
  private readonly players = new Map<string, PlayerState>();
  private readonly lastSequences = new Map<string, number>();
  private readonly drops = new Map<string, DropState>();
  private readonly projectiles = new Map<string, ProjectileState>();
  private rosterTimer?: ReturnType<typeof setInterval>;
  private simulationTimer?: ReturnType<typeof setInterval>;
  private roundResetTimer?: ReturnType<typeof setTimeout>;
  private roundId = 1;
  private objectCounter = 0;
  private lastSimulationAt = Date.now();
  private nextProjectileAt = Date.now() + 1200;
  private winnerId: string | null = null;

  constructor(readonly room: Party.Room) {}

  onStart(): void {
    this.fillDrops();
    this.rosterTimer = setInterval(() => this.broadcast({ type: "roster", players: [...this.players.values()] }), 5000);
    this.simulationTimer = setInterval(() => this.simulate(), 50);
  }

  onConnect(): void {
    // Players become visible only after sending a valid join message.
  }

  onMessage(raw: string | ArrayBuffer, sender: Party.Connection): void {
    if (typeof raw !== "string") return;
    const message = parseClientMessage(raw);
    if (!message) return;

    if (message.type === "join") this.handleJoin(sender, message.name);
    if (message.type === "move") this.handleMove(sender, message);
    if (message.type === "respawn") this.handleRespawn(sender);
    if (message.type === "ping") {
      this.send(sender, { type: "pong", clientTime: message.clientTime, serverTime: Date.now() });
    }
  }

  onClose(connection: Party.Connection): void {
    if (!this.players.delete(connection.id)) return;
    this.lastSequences.delete(connection.id);
    this.broadcast({ type: "player-left", playerId: connection.id });
  }

  onError(connection: Party.Connection): void {
    this.onClose(connection);
  }

  private handleJoin(connection: Party.Connection, rawName: string): void {
    if (this.players.has(connection.id)) return;
    if (this.players.size >= MAX_PLAYERS) {
      this.send(connection, { type: "error", code: "room-full", message: "This world is full." });
      connection.close(1008, "Room full");
      return;
    }

    const name = rawName.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 20);
    if (name.length < 2) {
      this.send(connection, { type: "error", code: "invalid-name", message: "Use a name with 2–20 characters." });
      return;
    }

    const [x, z] = this.findSpawn();
    const playerHash = this.hash(connection.id);
    const player: PlayerState = {
      id: connection.id,
      name,
      x,
      z,
      rotationY: 0,
      color: COLORS[playerHash % COLORS.length],
      material: MATERIALS[playerHash % MATERIALS.length],
      score: 0,
      alive: true,
      updatedAt: Date.now(),
    };
    this.players.set(connection.id, player);
    this.lastSequences.set(connection.id, 0);
    this.send(connection, { type: "welcome", playerId: connection.id, players: [...this.players.values()], game: this.gameState() });
    this.broadcast({ type: "player-joined", player }, [connection.id]);
  }

  private handleMove(connection: Party.Connection, message: Extract<ClientMessage, { type: "move" }>): void {
    const player = this.players.get(connection.id);
    if (!player || !player.alive || this.winnerId) return;
    const lastSequence = this.lastSequences.get(connection.id) ?? 0;
    if (message.sequence <= lastSequence) return;

    const now = Date.now();
    const elapsed = Math.max(0.05, Math.min(0.5, (now - player.updatedAt) / 1000));
    let x = Math.max(-WORLD_LIMIT + 0.6, Math.min(WORLD_LIMIT - 0.6, message.x));
    let z = Math.max(-WORLD_LIMIT + 0.6, Math.min(WORLD_LIMIT - 0.6, message.z));
    const deltaX = x - player.x;
    const deltaZ = z - player.z;
    const requestedDistance = Math.hypot(deltaX, deltaZ);
    const allowedDistance = MOVE_SPEED * elapsed + POSITION_TOLERANCE;

    if (requestedDistance > allowedDistance) {
      const correctionScale = allowedDistance / requestedDistance;
      x = player.x + deltaX * correctionScale;
      z = player.z + deltaZ * correctionScale;
    }

    Object.assign(player, { x, z, rotationY: message.rotationY, updatedAt: now });
    this.lastSequences.set(connection.id, message.sequence);
    this.broadcast({ type: "player-moved", playerId: connection.id, sequence: message.sequence, x, z, rotationY: message.rotationY, serverTime: now });
    this.checkDropCollection(player);
  }

  private handleRespawn(connection: Party.Connection): void {
    const player = this.players.get(connection.id);
    if (!player || player.alive || this.winnerId) return;
    const [x, z] = this.findSpawn();
    Object.assign(player, { x, z, rotationY: 0, score: 0, alive: true, updatedAt: Date.now() });
    this.lastSequences.set(connection.id, 0);
    this.broadcast({ type: "player-respawned", player });
  }

  private simulate(): void {
    const now = Date.now();
    const delta = Math.min(0.1, Math.max(0, (now - this.lastSimulationAt) / 1000));
    this.lastSimulationAt = now;

    if (!this.winnerId && this.players.size > 0 && now >= this.nextProjectileAt) {
      if (this.projectiles.size < MAX_PROJECTILES) this.spawnProjectile();
      this.nextProjectileAt = now + 850 + Math.random() * 650;
    }

    const removed = new Set<string>();
    for (const projectile of this.projectiles.values()) {
      projectile.x += projectile.vx * delta;
      projectile.z += projectile.vz * delta;
      if (Math.abs(projectile.x) > WORLD_LIMIT + 2 || Math.abs(projectile.z) > WORLD_LIMIT + 2) {
        removed.add(projectile.id);
        continue;
      }
      if (this.winnerId) continue;
      for (const player of this.players.values()) {
        if (!player.alive) continue;
        if (Math.hypot(projectile.x - player.x, projectile.z - player.z) < PLAYER_HIT_RADIUS) {
          player.alive = false;
          removed.add(projectile.id);
          this.broadcast({ type: "player-hit", playerId: player.id, projectileId: projectile.id });
          break;
        }
      }
    }
    removed.forEach((id) => this.projectiles.delete(id));
    this.broadcast({ type: "projectiles", projectiles: [...this.projectiles.values()], serverTime: now });
  }

  private checkDropCollection(player: PlayerState): void {
    for (const drop of this.drops.values()) {
      if (Math.hypot(drop.x - player.x, drop.z - player.z) >= DROP_COLLECT_RADIUS) continue;
      this.drops.delete(drop.id);
      player.score += 1;
      const replacement = this.createDrop();
      this.drops.set(replacement.id, replacement);
      this.broadcast({ type: "drop-collected", playerId: player.id, dropId: drop.id, score: player.score, replacement });
      if (player.score >= WINNING_SCORE) this.finishRound(player);
      return;
    }
  }

  private finishRound(winner: PlayerState): void {
    if (this.winnerId) return;
    this.winnerId = winner.id;
    this.projectiles.clear();
    this.broadcast({ type: "game-won", playerId: winner.id, playerName: winner.name });
    this.roundResetTimer = setTimeout(() => this.resetRound(), 5000);
  }

  private resetRound(): void {
    this.roundId += 1;
    this.winnerId = null;
    this.projectiles.clear();
    this.drops.clear();
    this.fillDrops();
    let spawnIndex = 0;
    for (const player of this.players.values()) {
      const [x, z] = SPAWNS[spawnIndex++ % SPAWNS.length];
      Object.assign(player, { x, z, rotationY: 0, score: 0, alive: true, updatedAt: Date.now() });
      this.lastSequences.set(player.id, 0);
    }
    this.nextProjectileAt = Date.now() + 1400;
    this.broadcast({ type: "round-reset", roundId: this.roundId, players: [...this.players.values()], drops: [...this.drops.values()] });
  }

  private spawnProjectile(): void {
    const side = Math.floor(Math.random() * 4);
    const lane = Math.random() * 32 - 16;
    const drift = Math.random() * 1.2 - 0.6;
    let x = 0;
    let z = 0;
    let vx = 0;
    let vz = 0;
    if (side === 0) { x = -WORLD_LIMIT - 1; z = lane; vx = PROJECTILE_SPEED; vz = drift; }
    if (side === 1) { x = WORLD_LIMIT + 1; z = lane; vx = -PROJECTILE_SPEED; vz = drift; }
    if (side === 2) { x = lane; z = -WORLD_LIMIT - 1; vx = drift; vz = PROJECTILE_SPEED; }
    if (side === 3) { x = lane; z = WORLD_LIMIT + 1; vx = drift; vz = -PROJECTILE_SPEED; }
    const projectile: ProjectileState = { id: `r${this.roundId}-p${++this.objectCounter}`, x, z, vx, vz };
    this.projectiles.set(projectile.id, projectile);
  }

  private fillDrops(): void {
    while (this.drops.size < DROP_COUNT) {
      const drop = this.createDrop();
      this.drops.set(drop.id, drop);
    }
  }

  private createDrop(): DropState {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const x = Math.random() * 32 - 16;
      const z = Math.random() * 32 - 16;
      const clearOfPlayers = [...this.players.values()].every((player) => Math.hypot(player.x - x, player.z - z) > 3);
      const clearOfDrops = [...this.drops.values()].every((drop) => Math.hypot(drop.x - x, drop.z - z) > 3);
      if (clearOfPlayers && clearOfDrops) return { id: `r${this.roundId}-d${++this.objectCounter}`, x, z };
    }
    return { id: `r${this.roundId}-d${++this.objectCounter}`, x: Math.random() * 28 - 14, z: Math.random() * 28 - 14 };
  }

  private gameState(): GameState {
    return { roundId: this.roundId, drops: [...this.drops.values()], projectiles: [...this.projectiles.values()], winningScore: WINNING_SCORE };
  }

  private findSpawn(): readonly [number, number] {
    return SPAWNS.find(([x, z]) => [...this.players.values()].every((player) => Math.hypot(player.x - x, player.z - z) > 1.5))
      ?? [Math.random() * 12 - 6, Math.random() * 12 - 6];
  }

  private hash(value: string): number {
    let hash = 0;
    for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return Math.abs(hash);
  }

  private send(connection: Party.Connection, message: ServerMessage): void {
    connection.send(JSON.stringify(message));
  }

  private broadcast(message: ServerMessage, exclude?: string[]): void {
    this.room.broadcast(JSON.stringify(message), exclude);
  }
}
