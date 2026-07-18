import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";

const port = 3100;
const serverUrl = `http://127.0.0.1:${port}`;
const tsxCli = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
const server = spawn(process.execPath, [tsxCli, "server/server.ts"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: { ...process.env, PORT: String(port), CLIENT_ORIGINS: "http://localhost:5173" },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk; });
server.stderr.on("data", (chunk) => { serverOutput += chunk; });

function waitForMessage(socket, predicate, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("server-message", listener);
      reject(new Error("Timed out waiting for a server message"));
    }, timeout);
    const listener = (raw) => {
      const message = JSON.parse(raw);
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("server-message", listener);
      resolve(message);
    };
    socket.on("server-message", listener);
  });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${serverUrl}/health`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become healthy. ${serverOutput}`);
}

async function join(name) {
  const socket = io(serverUrl, { transports: ["websocket"], reconnection: false });
  const welcome = waitForMessage(socket, (message) => message.type === "welcome");
  socket.on("connect", () => socket.emit("client-message", JSON.stringify({ type: "join", name })));
  return { socket, welcome: await welcome };
}

const clients = [];
try {
  await waitForHealth();
  const first = await join("Smoke One");
  clients.push(first.socket);

  const joinedNotice = waitForMessage(first.socket, (message) => message.type === "player-joined");
  const second = await join("Smoke Two");
  clients.push(second.socket);
  await joinedNotice;

  const moved = waitForMessage(second.socket, (message) =>
    message.type === "player-moved" && message.playerId === first.welcome.playerId,
  );
  first.socket.emit("client-message", JSON.stringify({ type: "move", sequence: 1, x: 1, z: 0, rotationY: 1 }));
  const movement = await moved;
  if (movement.x !== 1 || movement.z !== 0) throw new Error("Movement state did not round-trip correctly");

  const pong = waitForMessage(first.socket, (message) => message.type === "pong");
  first.socket.emit("client-message", JSON.stringify({ type: "ping", clientTime: 12345 }));
  const pongMessage = await pong;
  if (pongMessage.clientTime !== 12345) throw new Error("Ping response was invalid");

  console.log("Socket.IO smoke test passed: health, two joins, movement broadcast, and ping.");
} finally {
  clients.forEach((socket) => socket.disconnect());
  server.kill();
}
