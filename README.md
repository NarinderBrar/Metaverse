# Metaverse

A real-time multiplayer 3D collection-and-dodging game built with Three.js, TypeScript, Vite, PartySocket, and PartyKit. Players race to collect 10 water drops while avoiding server-controlled projectiles.

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in two browser tabs and enter a different name in each. The PartyKit development server runs on port `1999`.

You can also run the processes separately:

```bash
npm run dev:server
npm run dev:client
```

## Commands

```bash
npm run typecheck       # TypeScript validation
npm run build           # Production client build in dist/
npm run preview         # Preview the production client
npm run deploy:server   # Deploy the PartyKit room
```

## Deploy

1. Change `name` in `partykit.json` to a globally unique PartyKit project name.
2. Authenticate and run `npm run deploy:server`.
3. Add the deployed host to the frontend environment (host only, without `https://`):

   ```env
   VITE_PARTYKIT_HOST=your-project.your-username.partykit.dev
   ```

4. Run `npm run build` and deploy `dist/` to any static host such as Cloudflare Pages, Netlify, or Vercel.

## Architecture

- `src/client/` — Three.js scene, player entities, input, interpolation, and UI
- `src/shared/protocol.ts` — shared state and network message definitions
- `server/server.ts` — authoritative PartyKit room, validation, presence, and broadcasts
- `partykit.json` — PartyKit server configuration

The server validates names, movement speed, world boundaries, message size, player count, and message sequences. Active state is intentionally held in memory and disappears when the room restarts.

## Game rules

- Every player receives a deterministic PBR material: glass, rubber, wood, metal, ceramic, or crystal.
- Five shared water drops are always active in the arena.
- Collecting a drop adds one point and spawns a replacement elsewhere.
- Glowing projectiles cross the arena from all four edges.
- One projectile hit eliminates the player and resets their next run to zero.
- The first player to collect 10 drops wins; a new round begins after five seconds.

Drop collection, projectiles, collision checks, scores, eliminations, and round wins are authoritative on the PartyKit server.
