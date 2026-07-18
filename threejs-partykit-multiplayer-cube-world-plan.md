# Multiplayer Cube World  
## Three.js + PartyKit / PartyServer Implementation Plan

## 1. Project Overview

Build a small browser-based multiplayer 3D experience where users:

1. Open a public URL.
2. Enter a display name.
3. Join a shared 3D room.
4. Appear as a colored cube on a flat ground plane.
5. Move using the keyboard.
6. See other connected users moving in real time.
7. See each user's name above their cube.
8. Automatically disappear from the room when they disconnect.

This project is intentionally small. Its purpose is to create a live, playable proof that demonstrates real-time multiplayer synchronization in a browser-based 3D environment.

It can later become the technical foundation for:

- Humanoid avatars
- Character animations
- Multiple rooms
- Interactive tables
- Proximity chat
- Points and tokens
- Server-authoritative activities
- Voice chat
- Persistent accounts and profiles

---

## 2. Version-One Goal

The first release should answer one question:

> Can several users enter the same browser-based Three.js world and see each other moving smoothly in real time?

### Version-one features

- Three.js scene
- Flat ground plane
- Simple lighting
- Local player represented by a cube
- Remote players represented by cubes
- Name entry screen
- Name label above each cube
- WASD and arrow-key movement
- Third-person or fixed isometric camera
- One shared multiplayer room
- Real-time player join, movement, and leave events
- Smooth interpolation for remote players
- Online player count
- Connection-status indicator
- Automatic reconnection
- Basic server-side input validation
- Responsive browser layout
- Public deployment

### Explicitly excluded from version one

- User accounts
- Passwords
- Database
- Persistent player positions
- Imported avatar models
- Skeletal animation
- Physics engine
- Jumping
- Voice communication
- Matchmaking
- Multiple maps
- Private rooms
- Inventory
- Points or tokens
- Interactive tables
- Production-grade anti-cheat
- Mobile controls

Keeping these items out of the first milestone will make the prototype easier to complete, test, and deploy.

---

## 3. Recommended Technology Stack

### Client

- **Three.js** — 3D rendering
- **TypeScript** — application code
- **Vite** — development and production build
- **CSS/HTML** — login form, status display, player list
- **PartySocket** — browser WebSocket connection to the room server

### Realtime server

Use one of the following closely related approaches.

#### Preferred starting point: PartyKit

PartyKit provides a simple room-based server API and deployment workflow for multiplayer and collaborative applications.

Use it for:

- WebSocket connections
- Room membership
- Player state
- Broadcasting updates
- Disconnect cleanup
- Initial multiplayer prototype deployment

#### Longer-term option: PartyServer on Cloudflare

PartyServer is suitable when the project is deployed directly on Cloudflare's infrastructure and needs more control over Workers, Durable Objects, storage, routing, or other Cloudflare services.

Use this path when:

- The prototype needs to live inside a larger Cloudflare application.
- Direct Cloudflare deployment is preferred.
- Durable Object configuration needs to be managed explicitly.
- Authentication, persistence, or additional backend routes are added.

### Initial recommendation

Start with the simplest PartyKit workflow. Keep the multiplayer protocol and room code framework-independent enough that it can later be moved to PartyServer or a direct Durable Object implementation without redesigning the Three.js client.

---

## 4. High-Level Architecture

```text
┌───────────────────────────────┐
│ Browser A                     │
│ Three.js + Local Cube         │
└───────────────┬───────────────┘
                │ WebSocket
                │
┌───────────────▼───────────────┐
│ PartyKit / PartyServer Room   │
│                               │
│ - Connected players           │
│ - Names                       │
│ - Authoritative positions     │
│ - Movement validation         │
│ - Join/leave lifecycle        │
└───────────────┬───────────────┘
                │ WebSocket broadcasts
        ┌───────┴────────┐
        │                │
┌───────▼───────┐ ┌──────▼────────┐
│ Browser B     │ │ Browser C      │
│ Remote cubes  │ │ Remote cubes   │
└───────────────┘ └───────────────┘
```

### Client responsibilities

The browser should handle:

- Rendering the 3D environment
- Reading keyboard input
- Moving the local visual cube
- Sending movement input or snapshots
- Receiving server messages
- Creating and removing remote cubes
- Interpolating remote-player movement
- Updating name labels
- Displaying connection state
- Reconnecting after temporary network loss

### Server responsibilities

The room server should handle:

- Assigning a connection ID
- Accepting or rejecting a player name
- Maintaining the current room roster
- Maintaining authoritative player positions
- Validating movement speed and map limits
- Broadcasting joins, movement, and leaves
- Sending a full initial snapshot to new users
- Removing disconnected players
- Preventing malformed messages from crashing the room

---

## 5. Room Model

Version one uses one public room:

```text
Room ID: lobby
```

Every player who opens the demo joins this room.

Later, the room ID can come from the URL:

```text
/world/lobby
/world/demo-1
/world/private-room-code
```

Each PartyKit or Durable Object room acts as an isolated multiplayer session.

---

## 6. Player Data Model

Use a small shared data model.

```ts
export interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  color: number;
  updatedAt: number;
}
```

### Field meanings

- `id`: server-generated connection identifier
- `name`: sanitized display name
- `x`, `y`, `z`: authoritative world position
- `rotationY`: horizontal facing direction
- `color`: cube color assigned by the server
- `updatedAt`: server timestamp for debugging and stale-state checks

The first version can keep all active player data in room memory.

No database is required because player state disappears when users leave or the room restarts.

---

## 7. Network Message Protocol

Create shared TypeScript definitions used by both client and server.

### Client-to-server messages

```ts
export type ClientMessage =
  | {
      type: "join";
      name: string;
    }
  | {
      type: "move";
      sequence: number;
      x: number;
      z: number;
      rotationY: number;
    }
  | {
      type: "ping";
      clientTime: number;
    };
```

### Server-to-client messages

```ts
export type ServerMessage =
  | {
      type: "welcome";
      playerId: string;
      players: PlayerState[];
    }
  | {
      type: "player-joined";
      player: PlayerState;
    }
  | {
      type: "player-moved";
      playerId: string;
      sequence: number;
      x: number;
      z: number;
      rotationY: number;
      serverTime: number;
    }
  | {
      type: "player-left";
      playerId: string;
    }
  | {
      type: "roster";
      players: PlayerState[];
    }
  | {
      type: "pong";
      clientTime: number;
      serverTime: number;
    }
  | {
      type: "error";
      code: string;
      message: string;
    };
```

### Why use event messages instead of broadcasting the entire roster constantly?

Broadcasting the entire roster after every movement is easy but inefficient.

A better approach is:

- Send the full roster when a user joins.
- Send `player-joined` when someone enters.
- Send `player-moved` for movement.
- Send `player-left` when someone disconnects.
- Occasionally send a complete roster as a recovery snapshot.

This keeps movement messages small and prepares the project for more users.

---

## 8. Server Lifecycle

### On connection

1. Accept the WebSocket.
2. Do not create a visible player yet.
3. Wait for a valid `join` message.
4. Send connection status if required.

### On join

1. Parse the message safely.
2. Trim the name.
3. Remove unsupported characters.
4. Enforce a length limit, such as 2–20 characters.
5. Reject empty names.
6. Assign a spawn position.
7. Assign a cube color.
8. Add the player to the room state.
9. Send `welcome` to the new player.
10. Broadcast `player-joined` to everyone else.

### On movement

1. Confirm the sender has joined.
2. Confirm all values are finite numbers.
3. Calculate elapsed time since the previous accepted update.
4. Calculate the maximum allowed movement distance.
5. Reject impossible movement.
6. Clamp the position to the world boundary.
7. Update authoritative room state.
8. Broadcast the accepted position.

### On disconnect

1. Remove the player from the room state.
2. Broadcast `player-left`.
3. Update online-player count.

### On malformed input

1. Ignore invalid JSON.
2. Reject unknown message types.
3. Reject oversized messages.
4. Never trust the client-provided player ID.
5. Use the WebSocket connection ID as identity.

---

## 9. Server-Side Movement Validation

The client is responsible for responsive visual movement, but the server must prevent obviously invalid state.

### World boundaries

```ts
const WORLD_MIN_X = -20;
const WORLD_MAX_X = 20;
const WORLD_MIN_Z = -20;
const WORLD_MAX_Z = 20;
```

Clamp accepted coordinates:

```ts
const x = Math.max(WORLD_MIN_X, Math.min(WORLD_MAX_X, message.x));
const z = Math.max(WORLD_MIN_Z, Math.min(WORLD_MAX_Z, message.z));
```

### Speed validation

```ts
const MAX_SPEED = 5;
const POSITION_TOLERANCE = 0.75;
```

Conceptually:

```ts
const elapsedSeconds = (now - player.updatedAt) / 1000;
const allowedDistance =
  MAX_SPEED * elapsedSeconds + POSITION_TOLERANCE;

const requestedDistance = Math.hypot(
  message.x - player.x,
  message.z - player.z,
);

if (requestedDistance > allowedDistance) {
  return;
}
```

For this prototype, the validation does not need to be perfect. It only needs to stop obvious teleporting and corrupted values.

---

## 10. Client Scene Design

### Scene contents

- Perspective camera
- WebGL renderer
- Ambient or hemisphere light
- Directional light
- Ground plane
- Grid helper
- Four simple boundary walls
- Local player cube
- Remote player cubes
- CSS-based name labels

### Suggested dimensions

```text
Ground: 40 × 40 units
Cube:   1 × 1 × 1 units
Cube Y: 0.5
Camera: approximately 8–12 units behind/above player
```

### Visual direction

Keep the scene intentionally minimal:

- Neutral background
- Matte ground
- Thin grid
- Different cube color for each player
- Local cube outlined or highlighted
- White name labels
- Small online counter
- Green/red connection indicator

The purpose is to demonstrate synchronization, not environment art.

---

## 11. Player Representation

Create a `PlayerEntity` abstraction.

```ts
export class PlayerEntity {
  readonly root: THREE.Group;
  readonly cube: THREE.Mesh;
  readonly labelElement: HTMLDivElement;

  targetPosition = new THREE.Vector3();
  targetRotationY = 0;

  constructor(
    public readonly id: string,
    public readonly name: string,
    color: number,
  ) {
    // Create cube, group, and name label.
  }

  setNetworkTarget(
    x: number,
    z: number,
    rotationY: number,
  ): void {
    this.targetPosition.set(x, 0.5, z);
    this.targetRotationY = rotationY;
  }

  updateRemote(deltaTime: number): void {
    // Interpolate position and rotation.
  }

  dispose(): void {
    // Remove DOM label and dispose Three.js resources.
  }
}
```

Use a separate local-player controller for keyboard input.

---

## 12. Name Labels

Use `CSS2DRenderer` from Three.js for labels above cubes.

Benefits:

- Easy-to-read text
- No canvas text texture generation
- Easy name updates
- Normal HTML/CSS styling
- Good enough for a small prototype

Suggested label design:

```css
.player-label {
  padding: 3px 7px;
  border-radius: 4px;
  background: rgb(0 0 0 / 65%);
  color: white;
  font: 12px/1.2 system-ui, sans-serif;
  pointer-events: none;
  user-select: none;
  white-space: nowrap;
}
```

Do not insert unsanitized user names using `innerHTML`. Assign them with `textContent`.

---

## 13. Controls

### Desktop controls

- `W` or Up Arrow: move forward
- `S` or Down Arrow: move backward
- `A` or Left Arrow: move left
- `D` or Right Arrow: move right

For the first release, use camera-relative movement or fixed world-axis movement.

### Recommended initial implementation

Use a fixed isometric camera and world-axis controls. This avoids:

- Mouse pointer-lock complexity
- Camera collision
- Character-camera rotation coupling
- First-person motion discomfort

A later milestone can add third-person orbit or pointer-lock controls.

---

## 14. Local Movement

The local cube should respond immediately to keyboard input.

```ts
function updateLocalMovement(deltaTime: number): void {
  direction.set(0, 0, 0);

  if (keys.forward) direction.z -= 1;
  if (keys.backward) direction.z += 1;
  if (keys.left) direction.x -= 1;
  if (keys.right) direction.x += 1;

  if (direction.lengthSq() === 0) return;

  direction.normalize();

  localPlayer.position.addScaledVector(
    direction,
    MOVE_SPEED * deltaTime,
  );

  localPlayer.position.x = THREE.MathUtils.clamp(
    localPlayer.position.x,
    WORLD_MIN_X,
    WORLD_MAX_X,
  );

  localPlayer.position.z = THREE.MathUtils.clamp(
    localPlayer.position.z,
    WORLD_MIN_Z,
    WORLD_MAX_Z,
  );
}
```

The client should send snapshots of this movement to the room server.

---

## 15. Network Update Rate

Do not send a WebSocket message every render frame.

### Recommended values

```text
Rendering:             60 FPS or display refresh rate
Movement transmission: 10–15 updates per second
Roster recovery:       every 5–10 seconds, optional
Ping measurement:      every 5 seconds
```

Start at 10 movement updates per second:

```ts
const NETWORK_INTERVAL_MS = 100;
```

Only send when:

- The player moved.
- The player rotated.
- A periodic forced update is due.

This avoids unnecessary messages while keeping movement responsive.

---

## 16. Remote Movement Interpolation

Network positions arrive at a lower rate than the render loop. Remote cubes should move toward their latest target rather than teleporting.

```ts
function updateRemotePlayer(
  player: PlayerEntity,
  deltaTime: number,
): void {
  const positionAlpha =
    1 - Math.exp(-12 * deltaTime);

  player.root.position.lerp(
    player.targetPosition,
    positionAlpha,
  );

  player.root.rotation.y = lerpAngle(
    player.root.rotation.y,
    player.targetRotationY,
    positionAlpha,
  );
}
```

### Optional improvement

Store two or more snapshots per remote player and render slightly behind real time. This produces more stable interpolation but is not necessary for the first milestone.

---

## 17. Client Prediction and Server Correction

For version one:

1. Move the local cube immediately.
2. Send snapshots to the server.
3. Let the server validate them.
4. Broadcast accepted positions.
5. Correct the local cube only if the server position differs significantly.

```ts
const correctionDistance =
  localPosition.distanceTo(authoritativePosition);

if (correctionDistance > 1.0) {
  localPosition.copy(authoritativePosition);
}
```

Small errors can be blended rather than snapped.

This is not a full competitive-game prediction and reconciliation system. It is sufficient for a casual social-room prototype.

---

## 18. Connection and Reconnection UX

Display one of these states:

```text
Connecting…
Connected
Reconnecting…
Disconnected
Unable to join
```

### Reconnection behavior

When the socket reconnects:

1. Send the user's name again.
2. Receive a new welcome message.
3. Replace the local player ID.
4. Clear stale remote entities.
5. Rebuild the room from the returned roster.
6. Restore the last local position if accepted, or use a new spawn point.

Save only the display name in `localStorage`:

```ts
localStorage.setItem("cube-world-name", name);
```

Do not treat local storage as authentication.

---

## 19. Proposed Repository Structure

```text
multiplayer-cube-world/
├── public/
│   └── favicon.svg
│
├── src/
│   ├── client/
│   │   ├── app/
│   │   │   ├── GameApp.ts
│   │   │   └── AppState.ts
│   │   │
│   │   ├── scene/
│   │   │   ├── createScene.ts
│   │   │   ├── createEnvironment.ts
│   │   │   ├── createLights.ts
│   │   │   └── CameraController.ts
│   │   │
│   │   ├── players/
│   │   │   ├── PlayerEntity.ts
│   │   │   ├── LocalPlayerController.ts
│   │   │   ├── RemotePlayerManager.ts
│   │   │   └── PlayerLabel.ts
│   │   │
│   │   ├── multiplayer/
│   │   │   ├── MultiplayerClient.ts
│   │   │   ├── MessageRouter.ts
│   │   │   ├── interpolation.ts
│   │   │   └── connectionState.ts
│   │   │
│   │   ├── input/
│   │   │   └── KeyboardInput.ts
│   │   │
│   │   ├── ui/
│   │   │   ├── JoinScreen.ts
│   │   │   ├── ConnectionBadge.ts
│   │   │   └── PlayerList.ts
│   │   │
│   │   ├── styles/
│   │   │   └── main.css
│   │   │
│   │   └── main.ts
│   │
│   ├── server/
│   │   ├── room.ts
│   │   ├── playerStore.ts
│   │   ├── validation.ts
│   │   ├── spawn.ts
│   │   └── broadcast.ts
│   │
│   └── shared/
│       ├── messages.ts
│       ├── player.ts
│       ├── constants.ts
│       ├── guards.ts
│       └── math.ts
│
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── partykit.json
├── README.md
└── .gitignore
```

For the earliest proof of concept, this can be reduced to fewer files. The proposed structure is intended to prevent networking, Three.js, and UI logic from becoming mixed together.

---

## 20. Shared Runtime Validation

TypeScript types disappear at runtime. Incoming WebSocket messages must still be checked.

Use small manual type guards or a schema library.

Example:

```ts
export function isMoveMessage(
  value: unknown,
): value is Extract<ClientMessage, { type: "move" }> {
  if (!value || typeof value !== "object") return false;

  const message = value as Record<string, unknown>;

  return (
    message.type === "move" &&
    Number.isFinite(message.x) &&
    Number.isFinite(message.z) &&
    Number.isFinite(message.rotationY) &&
    Number.isInteger(message.sequence)
  );
}
```

For this small prototype, manual guards avoid adding another dependency.

---

## 21. Development Phases

## Phase 0 — Repository Setup

### Tasks

- Create Vite TypeScript project.
- Install Three.js.
- Install PartyKit and PartySocket packages.
- Configure TypeScript.
- Configure PartyKit server entry.
- Add formatting and linting.
- Add shared message types.
- Confirm client and server development commands run.

### Completion criteria

- Browser opens successfully.
- Empty Three.js scene renders.
- Client can connect to a local PartyKit room.
- Server logs a connection.

---

## Phase 1 — Local Single-Player Scene

### Tasks

- Create renderer, camera, and scene.
- Add lights.
- Add ground and grid.
- Add boundary walls.
- Create a cube player.
- Add keyboard controls.
- Clamp movement to the map.
- Add camera following or fixed isometric camera.
- Handle resize.

### Completion criteria

- One user can move a cube smoothly.
- Cube cannot leave the map.
- Camera and controls are understandable.
- No multiplayer code is required to verify movement.

---

## Phase 2 — Join Flow and Player Identity

### Tasks

- Add name-entry screen.
- Validate the name on the client.
- Save the name locally.
- Connect to the room.
- Send the `join` message.
- Add server-side name validation.
- Return the assigned player ID and initial roster.
- Add a name label over the local cube.

### Completion criteria

- User cannot enter the world without a valid name.
- Server assigns identity.
- Page refresh allows the user to re-enter.
- User-supplied names are displayed safely.

---

## Phase 3 — Multiplayer Presence

### Tasks

- Maintain players in the server room.
- Broadcast `player-joined`.
- Broadcast `player-left`.
- Send the current roster to new users.
- Create remote cubes from roster data.
- Remove cubes after disconnect.
- Add online-player count.

### Completion criteria

- Two browser windows show two players.
- Opening a third window creates a third cube.
- Closing a window removes its cube from the others.
- Names remain associated with the correct cubes.

---

## Phase 4 — Movement Synchronization

### Tasks

- Add fixed-rate network updates.
- Add message sequence numbers.
- Validate movement on the server.
- Broadcast accepted movement.
- Store remote target positions.
- Add interpolation.
- Add local correction for rejected positions.
- Avoid sending unchanged positions.

### Completion criteria

- Multiple users see each other move.
- Remote movement looks smooth.
- Movement does not depend on render FPS.
- Obvious teleport messages are rejected.
- Network messages remain small.

---

## Phase 5 — Reliability and UX

### Tasks

- Add connection status.
- Add reconnect handling.
- Add ping display.
- Add full-roster recovery snapshot.
- Handle malformed server data.
- Handle duplicate joins.
- Dispose Three.js resources correctly.
- Prevent tab-switch time jumps.
- Test slow and unstable network conditions.

### Completion criteria

- Temporary disconnects do not permanently break the app.
- Stale players are removed.
- Reloading one client does not affect other clients.
- Errors are visible rather than silently failing.

---

## Phase 6 — Deployment

### Tasks

- Create PartyKit or Cloudflare account.
- Configure project name.
- Deploy the room server.
- Build the Three.js client.
- Deploy the client.
- Configure production WebSocket host.
- Test HTTPS/WSS.
- Test from two different networks.
- Add a public demo URL.
- Add minimal README instructions.

### Completion criteria

- Demo is accessible from a public URL.
- Two people on different networks can join.
- WebSocket connection works over `wss://`.
- The first user and later users see consistent room state.

---

## 22. Suggested Package Scripts

The exact scripts depend on the selected PartyKit/PartyServer setup, but the intended workflow should resemble:

```json
{
  "scripts": {
    "dev": "concurrently \"npm:dev:client\" \"npm:dev:server\"",
    "dev:client": "vite",
    "dev:server": "partykit dev",
    "build": "vite build",
    "deploy:server": "partykit deploy",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  }
}
```

Keep deployment scripts separate so the client and realtime server can be deployed independently if needed.

---

## 23. Example PartyKit Server Shape

This is a structural example, not necessarily final copy-and-paste code.

```ts
import type * as Party from "partykit/server";
import type {
  ClientMessage,
  ServerMessage,
} from "../shared/messages";
import type { PlayerState } from "../shared/player";

export default class CubeWorldRoom implements Party.Server {
  private readonly players =
    new Map<string, PlayerState>();

  constructor(readonly room: Party.Room) {}

  onConnect(connection: Party.Connection): void {
    // Wait for an explicit join message.
  }

  onMessage(
    rawMessage: string,
    sender: Party.Connection,
  ): void {
    const message = this.parseMessage(rawMessage);

    if (!message) return;

    switch (message.type) {
      case "join":
        this.handleJoin(sender, message.name);
        break;

      case "move":
        this.handleMove(sender, message);
        break;

      case "ping":
        this.send(sender, {
          type: "pong",
          clientTime: message.clientTime,
          serverTime: Date.now(),
        });
        break;
    }
  }

  onClose(connection: Party.Connection): void {
    const removed = this.players.delete(connection.id);

    if (!removed) return;

    this.broadcast({
      type: "player-left",
      playerId: connection.id,
    });
  }

  private handleJoin(
    connection: Party.Connection,
    rawName: string,
  ): void {
    // Sanitize name, allocate spawn/color,
    // store player, send welcome, broadcast join.
  }

  private handleMove(
    connection: Party.Connection,
    message: Extract<ClientMessage, { type: "move" }>,
  ): void {
    // Validate sender, sequence, finite numbers,
    // elapsed time, speed and boundaries.
  }

  private send(
    connection: Party.Connection,
    message: ServerMessage,
  ): void {
    connection.send(JSON.stringify(message));
  }

  private broadcast(message: ServerMessage): void {
    this.room.broadcast(JSON.stringify(message));
  }

  private parseMessage(
    rawMessage: string,
  ): ClientMessage | null {
    // Safe JSON parsing and runtime validation.
    return null;
  }
}
```

---

## 24. Example Multiplayer Client Shape

```ts
import PartySocket from "partysocket";
import type {
  ClientMessage,
  ServerMessage,
} from "../../shared/messages";

export class MultiplayerClient {
  private socket: PartySocket | null = null;
  private sequence = 0;

  connect(name: string, roomId = "lobby"): void {
    this.socket = new PartySocket({
      host: import.meta.env.VITE_PARTYKIT_HOST,
      room: roomId,
    });

    this.socket.addEventListener("open", () => {
      this.send({
        type: "join",
        name,
      });
    });

    this.socket.addEventListener("message", event => {
      this.handleServerMessage(event.data);
    });

    this.socket.addEventListener("close", () => {
      // Update connection state.
    });

    this.socket.addEventListener("error", () => {
      // Update connection state.
    });
  }

  sendMovement(
    x: number,
    z: number,
    rotationY: number,
  ): void {
    this.send({
      type: "move",
      sequence: ++this.sequence,
      x,
      z,
      rotationY,
    });
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(message));
  }

  private handleServerMessage(raw: string): void {
    // Parse, validate, and route the message.
  }
}
```

---

## 25. Spawn Strategy

Start with a deterministic list of spawn locations:

```ts
const SPAWN_POINTS = [
  { x: 0, z: 0 },
  { x: 3, z: 0 },
  { x: -3, z: 0 },
  { x: 0, z: 3 },
  { x: 0, z: -3 },
];
```

Select the first spawn not currently occupied.

If all predefined points are occupied, choose a random valid point within a safe radius.

For a cube-only prototype, overlapping cubes are acceptable temporarily, but simple spacing improves the demo.

---

## 26. Color Assignment

Assign colors on the server so all users agree on each player's appearance.

Options:

1. Cycle through a predefined palette.
2. Hash the connection ID into a color.
3. Choose a random color and store it in player state.

A deterministic hash is convenient:

```ts
function colorFromId(id: string): number {
  let hash = 0;

  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }

  const hue = Math.abs(hash) % 360;
  return new THREE.Color(`hsl(${hue}, 65%, 55%)`).getHex();
}
```

Since the server should not depend on Three.js, implement HSL-to-RGB directly or send a hue number instead.

---

## 27. Security and Abuse Controls

Even a public demo needs basic protection.

### Required controls

- Maximum name length
- Maximum message size
- Allowed message types
- Numeric-value checks
- World-boundary checks
- Movement-speed checks
- Per-connection movement rate limit
- Ignore messages before join
- Escape or safely render names
- Remove control characters from names
- Maximum players per room
- Close abusive connections when necessary

### Suggested limits

```text
Maximum players:         20
Maximum name length:     20 characters
Movement rate:           15 messages/second
Maximum message payload: 2–4 KB
```

Do not add complex authentication until the demo requires user identity or persistence.

---

## 28. Performance Targets

### Initial target

- 10–20 simultaneous players
- 60 FPS on a normal desktop browser
- 10 movement updates per second per player
- Small JSON messages
- One draw call per cube initially
- Smooth remote interpolation
- No visible garbage-collection spikes during ordinary movement

### Easy later optimizations

- Share one cube geometry.
- Share or pool materials.
- Use `InstancedMesh` for remote cubes.
- Reuse vector objects.
- Replace JSON with binary messages only if profiling proves necessary.
- Apply area-of-interest filtering for larger maps.
- Split users across rooms.

Do not optimize prematurely. Twenty cubes and labels are inexpensive.

---

## 29. Testing Plan

### Local functional testing

- Open two browser tabs.
- Enter different names.
- Move both cubes.
- Close one tab.
- Refresh one tab.
- Disconnect and reconnect Wi-Fi.
- Send malformed messages from DevTools.
- Attempt to move outside the map.
- Attempt to send very large coordinate values.

### Cross-browser testing

- Chrome
- Firefox
- Edge
- Safari, if available

### Cross-network testing

- One desktop on broadband
- One phone using mobile data
- Two users in different locations

### Network-condition testing

Use browser developer tools to simulate:

- Fast 3G
- High latency
- Temporary offline state
- Packet delay
- Background-tab throttling

### Acceptance checklist

- [ ] Joining creates one player only.
- [ ] Names display correctly.
- [ ] New users receive existing users.
- [ ] Existing users receive new users.
- [ ] Movement synchronizes.
- [ ] Remote movement is interpolated.
- [ ] Disconnect removes the player.
- [ ] Refresh does not leave a permanent ghost.
- [ ] Invalid movement is rejected.
- [ ] No uncaught errors occur during normal use.
- [ ] Public deployment works across networks.

---

## 30. Observability

For the prototype, use structured server logs.

```ts
console.log({
  event: "player_joined",
  roomId: this.room.id,
  playerId: connection.id,
  playerCount: this.players.size,
});
```

Log:

- Room start
- Connection
- Successful join
- Rejected join
- Disconnect
- Invalid message
- Movement rejection
- Current player count

Avoid logging private or unnecessary information.

Add a small debug panel in development mode:

```text
FPS
Ping
Connection state
Player ID
Player count
Messages sent/sec
Messages received/sec
```

---

## 31. Deployment Strategy

## Option A — PartyKit-managed workflow

Best for the fastest proof of concept.

1. Build the Three.js frontend.
2. Implement the PartyKit room.
3. Run both locally.
4. Deploy the PartyKit server using its CLI.
5. Point the production PartySocket client at the deployed host.
6. Deploy the static frontend.
7. Test WebSocket access from separate networks.

## Option B — Own Cloudflare account with PartyServer

Best for longer-term control.

1. Create a Cloudflare Worker application.
2. Configure the PartyServer/Durable Object room.
3. Bind the Durable Object namespace.
4. Route room connections through the Worker.
5. Use WebSocket hibernation-compatible APIs where supported.
6. Deploy through Cloudflare tooling.
7. Host the static frontend on Cloudflare Pages or within the same application.
8. Add storage only when persistence is required.

Cloudflare Durable Objects are suitable for room coordination because one object can coordinate multiple WebSocket clients and maintain room-specific state. Hibernatable WebSockets can reduce idle compute usage while keeping connections attached.

---

## 32. PartyKit-to-PartyServer Migration Boundary

Keep these layers independent:

```text
Three.js Scene
      │
Game/Player State
      │
MultiplayerClient Interface
      │
PartySocket Transport
      │
PartyKit or PartyServer Room
```

Define a client interface:

```ts
export interface RealtimeTransport {
  connect(name: string, roomId: string): void;
  sendMovement(
    x: number,
    z: number,
    rotationY: number,
  ): void;
  disconnect(): void;
}
```

This prevents the rest of the Three.js project from directly depending on PartyKit details.

The server message protocol should remain stable during migration.

---

## 33. Future Milestones

## Milestone 2 — Chat

- Global text chat
- Nearby/proximity chat
- Message length limit
- Server-side chat routing
- Basic spam throttling
- Chat bubbles above cubes

## Milestone 3 — Interactive Table

- One table object
- Four seat locations
- Approach detection
- Request-to-sit event
- Server-controlled seat ownership
- Sit and stand state
- Shared table activity state

## Milestone 4 — Points and Tokens

- Demo point balance
- Server-authoritative token changes
- Shared table results
- Activity event log
- Optional short-lived persistence

## Milestone 5 — Avatar Upgrade

- Replace cubes with low-poly GLTF avatars
- Idle animation
- Walk animation
- Sit animation
- Animation state synchronized separately from position

## Milestone 6 — Voice

- WebRTC audio
- Signalling through the room server
- Proximity-based peer selection
- Mute controls
- TURN service for difficult networks

## Milestone 7 — Production Foundations

- Authentication
- User profiles
- Persistent inventory
- Moderation tools
- Private rooms
- Multiple maps
- Analytics
- Rate limiting
- Durable storage
- Horizontal room scaling strategy

---

## 34. Definition of Done

Version one is complete when:

1. A public URL opens the experience.
2. A user enters a name and joins.
3. The user appears as a cube with a label.
4. A second remote user can join from another network.
5. Both users see each other.
6. Both users see movement in near real time.
7. Remote movement looks smooth.
8. A disconnected player is removed.
9. Invalid movement cannot teleport a player outside the world.
10. The app reconnects after a short network interruption.
11. The codebase separates scene, player, networking, shared protocol, and server logic.
12. The repository includes setup and deployment instructions.

---

## 35. Recommended Implementation Order

Use this exact order to reduce debugging complexity:

```text
1. Render ground and one cube.
2. Add local movement.
3. Add the join screen.
4. Establish one WebSocket connection.
5. Implement server-side join state.
6. Display two connected users.
7. Broadcast movement.
8. Add remote interpolation.
9. Handle disconnects.
10. Add validation.
11. Add reconnection.
12. Deploy and test across networks.
13. Add UI polish.
14. Record a short demonstration.
```

Do not begin with chat, avatars, tables, or persistence.

---

## 36. Portfolio Presentation

The live demo should immediately explain itself.

Suggested landing text:

```text
Multiplayer Cube World

Open this page in another browser or share the link with
someone. Enter a name and move with WASD to see real-time
multiplayer synchronization.
```

Display:

- Live demo link
- GitHub repository
- Number of users online
- Controls
- Architecture summary
- Technologies used

Suggested technical summary:

> A real-time multiplayer 3D browser prototype built with Three.js and a room-based WebSocket server. The server owns room membership and validates player state, while clients perform responsive local movement and interpolate remote-player snapshots.

This makes the demo relevant to clients looking for shared browser-based 3D experiences, even before humanoid avatars and complex interactions are implemented.

---

## 37. Official References

- PartyKit documentation: https://docs.partykit.io/
- How PartyKit works: https://docs.partykit.io/how-partykit-works/
- PartyKit server API: https://docs.partykit.io/reference/partyserver-api/
- PartyKit configuration: https://docs.partykit.io/reference/partykit-configuration/
- PartyKit authentication guide: https://docs.partykit.io/guides/authentication/
- Deploying to a Cloudflare account: https://docs.partykit.io/guides/deploy-to-cloudflare/
- Cloudflare Durable Objects overview: https://developers.cloudflare.com/durable-objects/
- Durable Objects and WebSockets: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- WebSocket hibernation example: https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/

---

## Final Recommendation

Build the first release with:

```text
Three.js + TypeScript + Vite
PartySocket client
One PartyKit / PartyServer room
One public lobby
Temporary in-memory player state
10 movement snapshots per second
Client-side local movement
Server-side position validation
Remote-player interpolation
No database
Maximum 10–20 players
```

This is the smallest credible implementation that produces a real, publicly playable multiplayer 3D web demo while leaving a clean path toward avatars, shared tables, chat, points, and voice communication.
