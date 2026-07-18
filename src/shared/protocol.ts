export const WORLD_LIMIT = 20;
export const MOVE_SPEED = 5;
export const WINNING_SCORE = 10;

export type MaterialKind = "glass" | "rubber" | "wood" | "metal" | "ceramic" | "crystal";

export interface PlayerState {
  id: string;
  name: string;
  x: number;
  z: number;
  rotationY: number;
  color: number;
  material: MaterialKind;
  score: number;
  alive: boolean;
  updatedAt: number;
}

export interface DropState {
  id: string;
  x: number;
  z: number;
}

export interface ProjectileState {
  id: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
}

export interface GameState {
  roundId: number;
  drops: DropState[];
  projectiles: ProjectileState[];
  winningScore: number;
}

export type ClientMessage =
  | { type: "join"; name: string }
  | { type: "move"; sequence: number; x: number; z: number; rotationY: number }
  | { type: "respawn" }
  | { type: "ping"; clientTime: number };

export type ServerMessage =
  | { type: "welcome"; playerId: string; players: PlayerState[]; game: GameState }
  | { type: "player-joined"; player: PlayerState }
  | { type: "player-moved"; playerId: string; sequence: number; x: number; z: number; rotationY: number; serverTime: number }
  | { type: "player-left"; playerId: string }
  | { type: "roster"; players: PlayerState[] }
  | { type: "projectiles"; projectiles: ProjectileState[]; serverTime: number }
  | { type: "drop-collected"; playerId: string; dropId: string; score: number; replacement: DropState }
  | { type: "player-hit"; playerId: string; projectileId: string }
  | { type: "player-respawned"; player: PlayerState }
  | { type: "game-won"; playerId: string; playerName: string }
  | { type: "round-reset"; roundId: number; players: PlayerState[]; drops: DropState[] }
  | { type: "pong"; clientTime: number; serverTime: number }
  | { type: "error"; code: string; message: string };

export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > 4096) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const message = value as Record<string, unknown>;
    if (message.type === "join" && typeof message.name === "string") {
      return { type: "join", name: message.name };
    }
    if (message.type === "respawn") return { type: "respawn" };
    if (
      message.type === "move" &&
      Number.isInteger(message.sequence) &&
      Number.isFinite(message.x) &&
      Number.isFinite(message.z) &&
      Number.isFinite(message.rotationY)
    ) {
      return message as ClientMessage;
    }
    if (message.type === "ping" && Number.isFinite(message.clientTime)) {
      return message as ClientMessage;
    }
  } catch {
    // Malformed network input is intentionally ignored.
  }
  return null;
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || typeof (value as { type?: unknown }).type !== "string") return null;
    return value as ServerMessage;
  } catch {
    return null;
  }
}
