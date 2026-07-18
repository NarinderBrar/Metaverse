# Metaverse

A real-time multiplayer 3D collection-and-dodging game built with Three.js, TypeScript, Vite, and Socket.IO. Players race to collect 10 water drops while avoiding server-controlled projectiles.

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in two browser tabs and enter a different name in each. The Socket.IO server runs on port `3000`.

You can also run the processes separately:

```bash
npm run dev:server
npm run dev:client
```

## Commands

```bash
npm run typecheck       # TypeScript validation
npm run build           # Production client build in dist/
npm run test:socket     # Two-client Socket.IO integration smoke test
npm run preview         # Preview the production client
npm start               # Start the production Socket.IO server
```

## Deploy

### Socket.IO server on Render

Create a Render Web Service from this repository with:

- Build command: `npm ci`
- Start command: `npm start`
- Health check path: `/health`
- Environment variable: `CLIENT_ORIGINS=https://narinderbrar.github.io`

Render supplies the `PORT` environment variable automatically. The server binds to `0.0.0.0` and uses WebSocket-only Socket.IO transport.

### Three.js client on GitHub Pages

The production workflow connects to the deployed Render service:

```text
VITE_SOCKET_SERVER_URL=https://cube-world-socket-server.onrender.com
```

The workflow in `.github/workflows/deploy-pages.yml` builds and publishes the client. It runs automatically on pushes to `main`.

## Architecture

- `src/client/` — Three.js scene, player entities, input, interpolation, and UI
- `src/shared/protocol.ts` — shared state and validated network messages
- `server/server.ts` — authoritative Socket.IO server, health endpoint, presence, and broadcasts
- `scripts/socket-smoke.mjs` — local two-player networking smoke test

The server validates names, movement speed, world boundaries, message size, player count, and message sequences. Active state is intentionally held in memory and disappears when the Render service restarts or sleeps.

## Game rules

- Every player receives a deterministic PBR material: glass, rubber, wood, metal, ceramic, or crystal.
- Five shared water drops are always active in the arena.
- Collecting a drop adds one point and spawns a replacement elsewhere.
- Glowing projectiles cross the arena from all four edges.
- One projectile hit eliminates the player and resets their next run to zero.
- The first player to collect 10 drops wins; a new round begins after five seconds.

Drop collection, projectiles, collision checks, scores, eliminations, and round wins are authoritative on the Socket.IO server.
