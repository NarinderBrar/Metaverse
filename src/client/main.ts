import * as THREE from "three";
import PartySocket from "partysocket";
import {
  MOVE_SPEED,
  WINNING_SCORE,
  WORLD_LIMIT,
  parseServerMessage,
  type DropState,
  type PlayerState,
  type ProjectileState,
  type ServerMessage,
} from "../shared/protocol";
import { DropEntity, ProjectileEntity } from "./GameObjects";
import { PlayerEntity } from "./PlayerEntity";
import { World } from "./World";
import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <main id="world"></main>
  <section class="join-panel" id="join-panel">
    <div class="eyebrow">Collect. Dodge. Survive.</div>
    <h1>Cube World</h1>
    <p>Race for 10 water drops while glowing projectiles sweep across the arena. One hit ends your run.</p>
    <form id="join-form">
      <label for="name">Choose your name</label>
      <div class="join-row"><input id="name" maxlength="20" minlength="2" autocomplete="nickname" placeholder="Explorer" required /><button>Enter arena <span>&rarr;</span></button></div>
      <div class="form-error" id="form-error"></div>
    </form>
  </section>
  <header class="hud hidden" id="hud">
    <div class="brand"><span class="brand-cube"></span><strong>Cube World</strong></div>
    <div class="objective"><span class="drop-icon"></span><b id="local-score">0</b><span>/ ${WINNING_SCORE}</span></div>
    <div class="status"><span id="status-dot" class="status-dot"></span><span id="status-text">Connecting&hellip;</span><span class="divider"></span><span><b id="online">0</b> online</span><span class="divider"></span><span id="ping">&mdash; ms</span></div>
  </header>
  <aside class="scoreboard hidden" id="scoreboard"><div class="scoreboard-title"><span>Leaderboard</span><small>First to ${WINNING_SCORE}</small></div><div id="scoreboard-list"></div></aside>
  <aside class="controls hidden" id="controls"><div class="keys"><kbd>W</kbd><div><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></div></div><div><strong>Move & dodge</strong><span>Collect blue water drops</span></div></aside>
  <section class="game-overlay hidden" id="game-overlay"><div class="result-card"><div class="result-icon" id="result-icon">!</div><div class="eyebrow" id="result-eyebrow">Round over</div><h2 id="result-title">You were hit</h2><p id="result-copy">Your score was reset. Jump back in when you are ready.</p><button id="respawn-button">Re-enter arena <span>&rarr;</span></button></div></section>
  <div class="toast" id="toast"></div>`;

const worldElement = document.querySelector<HTMLElement>("#world")!;
const world = new World(worldElement);
const entities = new Map<string, PlayerEntity>();
const playerData = new Map<string, PlayerState>();
const drops = new Map<string, DropEntity>();
const projectiles = new Map<string, ProjectileEntity>();
const keys = new Set<string>();
const clock = new THREE.Clock();
let socket: PartySocket | null = null;
let localId = "";
let displayName = "";
let sequence = 0;
let lastSent = 0;
const lastPosition = new THREE.Vector3();
let messagesSent = 0;
let messagesReceived = 0;
let lastDebugUpdate = 0;
let roundEnded = false;

const joinPanel = document.querySelector<HTMLElement>("#join-panel")!;
const joinForm = document.querySelector<HTMLFormElement>("#join-form")!;
const nameInput = document.querySelector<HTMLInputElement>("#name")!;
const formError = document.querySelector<HTMLElement>("#form-error")!;
const hud = document.querySelector<HTMLElement>("#hud")!;
const controls = document.querySelector<HTMLElement>("#controls")!;
const scoreboard = document.querySelector<HTMLElement>("#scoreboard")!;
const gameOverlay = document.querySelector<HTMLElement>("#game-overlay")!;
const respawnButton = document.querySelector<HTMLButtonElement>("#respawn-button")!;
nameInput.value = localStorage.getItem("cube-world-name") ?? "";
nameInput.focus();

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  displayName = nameInput.value.trim();
  if (displayName.length < 2) {
    formError.textContent = "Please use at least 2 characters.";
    return;
  }
  localStorage.setItem("cube-world-name", displayName);
  formError.textContent = "";
  joinForm.querySelector("button")!.setAttribute("disabled", "");
  connect();
});

respawnButton.addEventListener("click", () => {
  socket?.send(JSON.stringify({ type: "respawn" }));
  respawnButton.disabled = true;
  respawnButton.textContent = "Re-entering…";
});

function connect(): void {
  setStatus("connecting", "Connecting…");
  const configuredHost = import.meta.env.VITE_PARTYKIT_HOST as string | undefined;
  socket = new PartySocket({ host: configuredHost || `${location.hostname}:1999`, room: "lobby" });
  socket.addEventListener("open", () => {
    setStatus("connected", "Connected");
    socket?.send(JSON.stringify({ type: "join", name: displayName }));
  });
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const message = parseServerMessage(event.data);
    if (message) {
      messagesReceived += 1;
      routeMessage(message);
    }
  });
  socket.addEventListener("close", () => setStatus("connecting", "Reconnecting…"));
  socket.addEventListener("error", () => setStatus("error", "Connection issue"));
}

function routeMessage(message: ServerMessage): void {
  if (message.type === "welcome") {
    localId = message.playerId;
    clearPlayers();
    message.players.forEach(addPlayer);
    syncDrops(message.game.drops);
    syncProjectiles(message.game.projectiles);
    const localPlayer = entities.get(localId);
    if (localPlayer) lastPosition.copy(localPlayer.root.position);
    lastSent = performance.now();
    roundEnded = false;
    joinPanel.classList.add("leaving");
    hud.classList.remove("hidden");
    controls.classList.remove("hidden");
    scoreboard.classList.remove("hidden");
    setTimeout(() => joinPanel.classList.add("hidden"), 450);
  } else if (message.type === "player-joined") {
    addPlayer(message.player);
    showToast(`${message.player.name} entered the arena`);
  } else if (message.type === "player-moved") {
    const player = entities.get(message.playerId);
    const data = playerData.get(message.playerId);
    if (!player || !data) return;
    Object.assign(data, { x: message.x, z: message.z, rotationY: message.rotationY });
    if (message.playerId === localId) {
      const correction = new THREE.Vector3(message.x, 0.5, message.z);
      if (player.root.position.distanceTo(correction) > 0.65) player.root.position.lerp(correction, 0.35);
    } else player.setTarget(message.x, message.z, message.rotationY);
  } else if (message.type === "player-left") {
    const player = entities.get(message.playerId);
    if (player) showToast(`${player.name} left`);
    removePlayer(message.playerId);
  } else if (message.type === "roster") {
    syncRoster(message.players);
  } else if (message.type === "projectiles") {
    syncProjectiles(message.projectiles);
  } else if (message.type === "drop-collected") {
    removeDrop(message.dropId);
    addDrop(message.replacement);
    const data = playerData.get(message.playerId);
    if (data) {
      data.score = message.score;
      entities.get(message.playerId)?.updateStatus(data.score, data.alive);
      showToast(`${data.name} collected a drop · ${data.score}/${WINNING_SCORE}`);
    }
  } else if (message.type === "player-hit") {
    const data = playerData.get(message.playerId);
    if (data) {
      data.alive = false;
      entities.get(message.playerId)?.updateStatus(data.score, false);
      if (message.playerId === localId) showEliminated(data.score);
      else showToast(`${data.name} was hit`);
    }
  } else if (message.type === "player-respawned") {
    applyPlayerState(message.player);
    if (message.player.id === localId) {
      const localPlayer = entities.get(localId);
      if (localPlayer) lastPosition.copy(localPlayer.root.position);
      hideResult();
    }
  } else if (message.type === "game-won") {
    roundEnded = true;
    showWinner(message.playerId === localId ? "You win!" : `${message.playerName} wins!`);
  } else if (message.type === "round-reset") {
    roundEnded = false;
    message.players.forEach(applyPlayerState);
    syncDrops(message.drops);
    syncProjectiles([]);
    const localPlayer = entities.get(localId);
    if (localPlayer) lastPosition.copy(localPlayer.root.position);
    hideResult();
    showToast(`Round ${message.roundId} started`);
  } else if (message.type === "pong") {
    document.querySelector("#ping")!.textContent = `${Date.now() - message.clientTime} ms`;
  } else if (message.type === "error") {
    formError.textContent = message.message;
    joinPanel.classList.remove("leaving", "hidden");
    joinForm.querySelector("button")!.removeAttribute("disabled");
  }
  if (message.type !== "player-moved" && message.type !== "projectiles" && message.type !== "pong") updateHud();
}

function addPlayer(state: PlayerState): void {
  if (entities.has(state.id)) return;
  playerData.set(state.id, { ...state });
  const entity = new PlayerEntity(state.id, state.name, state.color, state.material, state.id === localId);
  entity.applyState(state);
  entities.set(state.id, entity);
  world.scene.add(entity.root);
}

function applyPlayerState(state: PlayerState): void {
  if (!entities.has(state.id)) addPlayer(state);
  playerData.set(state.id, { ...state });
  const entity = entities.get(state.id)!;
  entity.applyState(state);
  entity.updateStatus(state.score, state.alive);
}

function syncRoster(players: PlayerState[]): void {
  const ids = new Set(players.map((player) => player.id));
  for (const id of entities.keys()) if (!ids.has(id)) removePlayer(id);
  for (const player of players) {
    if (!entities.has(player.id)) addPlayer(player);
    else {
      const existing = playerData.get(player.id);
      playerData.set(player.id, { ...player });
      entities.get(player.id)!.updateStatus(player.score, player.alive);
      if (player.id !== localId) entities.get(player.id)!.setTarget(player.x, player.z, player.rotationY);
      if (existing?.alive === false && player.alive) entities.get(player.id)!.applyState(player);
    }
  }
}

function removePlayer(id: string): void {
  entities.get(id)?.dispose();
  entities.delete(id);
  playerData.delete(id);
}

function clearPlayers(): void {
  entities.forEach((entity) => entity.dispose());
  entities.clear();
  playerData.clear();
}

function addDrop(state: DropState): void {
  if (drops.has(state.id)) return;
  const entity = new DropEntity(state.id, state);
  drops.set(state.id, entity);
  world.scene.add(entity.root);
}

function removeDrop(id: string): void {
  drops.get(id)?.dispose();
  drops.delete(id);
}

function syncDrops(states: DropState[]): void {
  const ids = new Set(states.map((state) => state.id));
  for (const id of drops.keys()) if (!ids.has(id)) removeDrop(id);
  states.forEach(addDrop);
}

function syncProjectiles(states: ProjectileState[]): void {
  const ids = new Set(states.map((state) => state.id));
  for (const [id, projectile] of projectiles) {
    if (!ids.has(id)) {
      projectile.dispose();
      projectiles.delete(id);
    }
  }
  for (const state of states) {
    let entity = projectiles.get(state.id);
    if (!entity) {
      entity = new ProjectileEntity(state.id, state);
      projectiles.set(state.id, entity);
      world.scene.add(entity.root);
    } else entity.apply(state);
  }
}

addEventListener("keydown", (event) => {
  if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(event.key.toLowerCase())) event.preventDefault();
  keys.add(event.key.toLowerCase());
});
addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
addEventListener("blur", () => keys.clear());

function updateLocal(delta: number, now: number): void {
  const player = entities.get(localId);
  const data = playerData.get(localId);
  if (!player || !data?.alive || roundEnded) return;
  const direction = new THREE.Vector3(
    Number(keys.has("d") || keys.has("arrowright")) - Number(keys.has("a") || keys.has("arrowleft")),
    0,
    Number(keys.has("s") || keys.has("arrowdown")) - Number(keys.has("w") || keys.has("arrowup")),
  );
  if (direction.lengthSq() > 0) {
    direction.normalize();
    player.root.position.addScaledVector(direction, MOVE_SPEED * delta);
    player.root.position.x = THREE.MathUtils.clamp(player.root.position.x, -WORLD_LIMIT + 0.6, WORLD_LIMIT - 0.6);
    player.root.position.z = THREE.MathUtils.clamp(player.root.position.z, -WORLD_LIMIT + 0.6, WORLD_LIMIT - 0.6);
    player.root.rotation.y = Math.atan2(direction.x, direction.z);
  }
  if (now - lastSent >= 100 && player.root.position.distanceToSquared(lastPosition) > 0.0001 && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "move", sequence: ++sequence, x: player.root.position.x, z: player.root.position.z, rotationY: player.root.rotation.y }));
    messagesSent += 1;
    lastPosition.copy(player.root.position);
    lastSent = now;
  }
}

function animate(now = performance.now()): void {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  const time = now / 1000;
  updateLocal(delta, now);
  entities.forEach((entity, id) => { if (id !== localId) entity.updateRemote(delta); });
  drops.forEach((drop) => drop.update(time));
  projectiles.forEach((projectile) => projectile.update(delta));
  world.render(entities.get(localId)?.root.position, delta);
  if (import.meta.env.DEV && now - lastDebugUpdate > 100) {
    worldElement.dataset.networkState = JSON.stringify(getDebugState());
    lastDebugUpdate = now;
  }
}
animate();

setInterval(() => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping", clientTime: Date.now() }));
}, 5000);

function updateHud(): void {
  document.querySelector("#online")!.textContent = String(entities.size);
  document.querySelector("#local-score")!.textContent = String(playerData.get(localId)?.score ?? 0);
  const list = [...playerData.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  document.querySelector("#scoreboard-list")!.innerHTML = list.map((player, index) => `
    <div class="score-row ${player.id === localId ? "me" : ""} ${player.alive ? "" : "out"}">
      <span class="rank">${index + 1}</span><span class="material-dot" style="--player-color:#${player.color.toString(16).padStart(6, "0")}"></span>
      <span class="score-name">${escapeHtml(player.name)}<small>${player.material}</small></span><b>${player.score}</b>
    </div>`).join("");
}

function setStatus(kind: "connecting" | "connected" | "error", text: string): void {
  document.querySelector("#status-text")!.textContent = text;
  document.querySelector("#status-dot")!.className = `status-dot ${kind}`;
}

function showEliminated(score: number): void {
  keys.clear();
  document.querySelector("#result-icon")!.textContent = "×";
  document.querySelector("#result-eyebrow")!.textContent = "Projectile impact";
  document.querySelector("#result-title")!.textContent = "You were hit";
  document.querySelector("#result-copy")!.textContent = `You collected ${score} of ${WINNING_SCORE} drops. Your next run starts from zero.`;
  respawnButton.classList.remove("hidden");
  respawnButton.disabled = false;
  respawnButton.innerHTML = `Re-enter arena <span>&rarr;</span>`;
  gameOverlay.classList.remove("hidden");
}

function showWinner(title: string): void {
  keys.clear();
  document.querySelector("#result-icon")!.textContent = "◇";
  document.querySelector("#result-eyebrow")!.textContent = "10 drops collected";
  document.querySelector("#result-title")!.textContent = title;
  document.querySelector("#result-copy")!.textContent = "A fresh round begins automatically in 5 seconds.";
  respawnButton.classList.add("hidden");
  gameOverlay.classList.remove("hidden");
}

function hideResult(): void {
  gameOverlay.classList.add("hidden");
  respawnButton.disabled = false;
  respawnButton.classList.remove("hidden");
}

let toastTimer = 0;
function showToast(text: string): void {
  const toast = document.querySelector<HTMLElement>("#toast")!;
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

function getDebugState() {
  return {
    localId,
    messagesSent,
    messagesReceived,
    drops: drops.size,
    projectiles: projectiles.size,
    projectilePositions: [...projectiles.values()].slice(0, 3).map((projectile) => ({
      id: projectile.id,
      x: projectile.root.position.x,
      z: projectile.root.position.z,
      vx: projectile.velocity.x,
      vz: projectile.velocity.z,
    })),
    players: [...entities.values()].map((entity) => ({
      id: entity.id,
      name: entity.name,
      material: entity.materialName,
      local: entity.id === localId,
      score: playerData.get(entity.id)?.score ?? 0,
      alive: playerData.get(entity.id)?.alive ?? false,
      position: { x: entity.root.position.x, z: entity.root.position.z },
      target: { x: entity.target.x, z: entity.target.z },
    })),
  };
}
