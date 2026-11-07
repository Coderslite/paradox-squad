# Paradox Squad

A 2–8 player first-person shooter that runs in the browser. Open a link, share a six-letter code, play.

Status: **milestones 1–2 of 8** — greybox arena with tuned movement and shooting, plus an authoritative multiplayer server with prediction, reconciliation, interpolation and lag-compensated hitscan. See [Roadmap](#roadmap).

## Quick start (macOS / Apple Silicon)

Requirements: Node 20.19+ (22 recommended) and pnpm 9 (`corepack enable pnpm`).

```bash
pnpm install
pnpm dev            # Next.js on :3000 + game server on :2567
```

Open http://localhost:3000 and choose **Play now**.

To keep an 8 GB machine responsive, run one app per terminal instead of both through Turbo:

```bash
pnpm dev:server     # terminal 1
pnpm dev:web        # terminal 2
```

Friends on the same Wi-Fi can join through your LAN address (for example `http://192.168.0.10:3000/play/K7QF2M`). In development the client connects to the game server on the same host at port 2567.

## Playing

| Action | Keyboard / mouse | Gamepad |
| --- | --- | --- |
| Move / look | WASD / mouse | Left / right stick |
| Fire / aim | Left / right mouse | RT / LT |
| Jump, mantle | Space (jump into a ledge to climb it) | A |
| Crouch, slide | C or L-Ctrl (slide when sprinting) | B |
| Sprint | L-Shift | L3 |
| Reload | R | X |
| Switch weapon | 1 / 2 / mouse wheel | Y |
| Scoreboard | Tab | |
| Pause / settings | Esc | |
| Performance overlay | F3 | |

You can rebind every key in **Pause → Controls**. Settings are saved per browser.

### Hosting a private match

1. Go to **Play now → Create private match**.
2. Send the link (`/play/ABC123`) or just the code. **Pause → Copy invite link** copies the link.
3. Friends who open the link join straight into the match: Team Deathmatch, up to 4v4, auto-balanced, with join-in-progress.

A player who disconnects has 30 seconds to rejoin into the same slot. Players who are inactive for 2 minutes are removed.

## Architecture

```
apps/web         Next.js 16 (App Router): landing page, menus, HUD, game client
  game/core      Game loop (fixed 60 Hz step, render interpolation), event bus
  game/player    Input (pointer lock with raw input, gamepad), prediction and reconciliation
  game/remote    Snapshot interpolation of other players (100 ms buffer)
  game/render    Arena, viewmodel pass, quality presets and dynamic resolution
  game/fx        Pooled particles, decals and tracers
  game/audio     Procedural Web Audio (HRTF, air absorption, reverb)
  game/net       Colyseus client session
apps/server      Colyseus 0.18 authoritative server
  rooms          GameRoom (shared rules) and TdmRoom
  sim            Lag compensation and server-side player (input queue, history ring)
packages/shared  Code shared by client and server: movement, weapons, hitboxes, protocol (Zod), maps, RNG
```

Client and server run the same movement and weapon code from `packages/shared` (Rapier kinematic character controller, fixed 60 Hz). The netcode works like this:

- **Inputs:** the client sends inputs every tick, and each message repeats the last 3 inputs so lost packets don't lose inputs.
- **Server authority:** the server simulates each player's inputs in order. It decides everything: movement, fire rate, ammo, line of sight and damage.
- **Snapshots and acks:** the server sends 30 Hz delta-compressed snapshots (Colyseus Schema). Each player also gets a full-precision *ack* containing their own state after their last processed input.
- **Reconciliation:** the client rewinds to the ack and replays any inputs the server hasn't processed yet. The simulation is deterministic, so corrections are normally zero; any remaining difference is smoothed out visually.
- **Lag compensation:** the server stores 4.5 s of history per player. When resolving a shot, it moves hitboxes back to the tick the shooter was rendering, up to 250 ms. Personal Rewind (milestone 3) will reuse the same buffer.

## Testing

```bash
pnpm test                                   # unit tests (Vitest)
pnpm --filter @paradox/server harness       # netcode harness: 150 ms RTT, 2% loss
LAG=250 LOSS=5 pnpm --filter @paradox/server harness
pnpm e2e                                    # Playwright smoke test (starts both servers if needed)
```

The harness starts a local server and runs two headless bots that use the real prediction code. One bot strafes; the other shoots at where it sees the target. The harness fails if more than 0.05 cm of reconciliation error appears (p99) or if fewer than 80% of shots register. Current results: 0 corrections and 98% of shots registered at both 150 ms / 2% and 250 ms / 5%.

To test the browser client under bad network conditions, add `?lag=150&loss=2` to a match URL.

## Deployment

- **Web → Vercel.** Set the project root to `apps/web`, and set `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_GAME_SERVER_URL` (for example `wss://paradox-squad-game.fly.dev`).
- **Game server → Fly.io** (Frankfurt first; it has good latency to both Europe and Lagos):
  ```bash
  fly launch --no-deploy --config apps/server/fly.toml
  fly deploy --config apps/server/fly.toml --dockerfile apps/server/Dockerfile
  ```
  To add a region, add a machine in it (`fly scale count 1 --region iad`) and set `REGION`. A plain VPS also works: `docker build -f apps/server/Dockerfile -t paradox-server .` from the repo root.
- **CI:** GitHub Actions runs lint, typecheck, unit tests, build, the netcode harness and the Playwright smoke test on every push.

All environment variables are documented in [`.env.example`](.env.example).

## Extending

**Add a map:** create `packages/shared/src/maps/<id>.ts` exporting a `MapDef` (boxes, spawns, `killY`). Register it in `maps/registry.ts` and add the id to `JoinOptions.map` in `protocol.ts`. Collision and visuals are both built from the boxes. The art pipeline (milestone 4) will replace the visuals while keeping the same collision layout.

**Add a weapon:** add an entry to `WEAPONS` in `packages/shared/src/weapons/defs.ts`. It needs a fixed recoil pattern, a damage falloff profile and spread values. Then add a viewmodel builder in `apps/web/game/render/weaponModels.ts`. The server picks it up automatically because it runs the same definition.

**Tune movement:** every constant lives in `MOVE` in `packages/shared/src/constants.ts`. Run `pnpm test` afterwards: the movement tests check step-up, mantle height limits, slide and determinism.

## Roadmap

1. ✅ Monorepo, greybox arena, movement and shooting feel
2. ✅ Authoritative server, prediction and reconciliation, interpolation, lag-compensated hitscan, private rooms with invite links, TDM
3. Personal Rewind and Echoes
4. Art pass: baked lighting, PBR, post-processing, characters, audio assets
5. Era Shifts, era-adaptive weapons, asset streaming
6. Menus, accounts (Auth.js and Postgres), progression, leaderboards
7. Remaining eras and maps, CTF, FFA, bots, Horde
8. Agents and abilities, killcam, parties, voice chat, mobile, optimization
