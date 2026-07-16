# Agent Unknown's Battlegrounds (AUB)

A top-down pixel-art battle royale where you don't steer a character — you give
your **agent** orders in natural language. A local LLM compiles each order into
a structured JSON *directive*, and a deterministic 20 Hz game server executes it.
The model is the commander, not the muscles: it's called only when you issue an
order, never inside the game loop.

**Status: Phase 4 — you can play it.** A match is always running: 5 warriors on an
island, a shrinking zone, last one standing wins, then it restarts. Bots fill every
seat, so it plays itself with nobody connected. Your agent takes typed orders in any
language.

This README is how to run it. For how it works:

- **[docs/](./docs/)** — [architecture](./docs/architecture.md) · [game mechanics](./docs/game-mechanics.md) · [what works today](./docs/README.md)
- [`SPEC.md`](./SPEC.md) — the original design · [`DECISIONS.md`](./DECISIONS.md) — where we deviated, and why

## Stack

| Layer  | Tech |
|--------|------|
| Client | Phaser 3 + Vite + TypeScript (`packages/client`) |
| Server | Node + Colyseus + TypeScript (`packages/server`) |
| Shared | Directive Zod schema, types, constants (`packages/shared`) |
| LLM    | Ollama (local), `gemma4:e4b` — interprets typed orders (Phase 4) |

## Prerequisites

- **Node.js ≥ 20.19** (developed on v26). Check with `node --version`.
- **pnpm ≥ 9** — the package manager for this workspace. If you don't have it:
  ```bash
  npm install -g pnpm
  ```
- **[Ollama](https://ollama.com) running locally**, with the order-interpreter model:
  ```bash
  ollama serve          # if it isn't already running
  ollama pull gemma4:e4b
  ```
  The game still runs fine without it — orders just come back "the agent didn't
  understand" and every agent keeps its current directive. Nothing crashes.

  > **Use the GGUF tag `gemma4:e4b`, not `gemma4:e4b-mlx`.** Ollama's MLX backend
  > silently ignores the `format` schema, so every order fails validation. See
  > [`DECISIONS.md`](./DECISIONS.md) §2.

## Run it from scratch

```bash
# 1. Clone, then from the repo root install all workspace dependencies:
pnpm install

# 2. Start client + server together (two labelled processes, one terminal):
pnpm dev
```

Then open **http://localhost:5173** — a match is already in progress. Opening a second
window drops another warrior in; both windows see everyone.

Type into the box at the bottom to command your agent:

> `run to the lake and don't touch anyone` — it goes, and refuses to fight
> `hold the castle, only fight if they come close`
> `hunt down the weakest enemy`
> `if you drop below half HP, hide in the north forest`

Orders work in any language. Gibberish gets "Order not understood" and your agent
carries on. Follow-ups like *"and also stop attacking"* often don't take —
[#2](https://github.com/Slikon/agent-unknown-battleground/issues/2); restate the full
order instead.

### Running them separately

```bash
pnpm dev:client   # Vite dev server on http://localhost:5173
pnpm dev:server   # Colyseus on ws://localhost:2567 (auto-restarts on change)
```

### Other scripts

```bash
pnpm typecheck                                    # strict tsc across every package
pnpm build                                        # production client build
pnpm --filter @aub/server test:llm                # 11 orders through the real pipeline
pnpm --filter @aub/server test:llm -- --model X   # benchmark another Ollama tag
npx tsx packages/server/scripts/sim-verify.ts 20  # headless matches — run after any tuning
```

## LAN / second machine

The server binds to `0.0.0.0` and the Vite dev server is exposed on the LAN, so
a second computer on the same Wi-Fi can play (see SPEC.md §10). Find your Mac's
IP and use it in place of `localhost`:

```bash
ipconfig getifaddr en0        # e.g. 192.168.1.42
# → open http://192.168.1.42:5173 on the other machine
```

## Repo layout

```
aubg/
├── packages/
│   ├── client/   Phaser 3 + Vite client
│   │   └── public/assets/   ← drop the Tiny Swords art here (see ASSETS.md)
│   ├── server/   Node + Colyseus authoritative server
│   └── shared/   Directive schema (Zod) + types + constants — the LLM↔game contract
├── docs/                how it all works — start at docs/README.md
├── tsconfig.base.json   one shared strict TS config, extended by every package
├── SPEC.md              full architecture & phased plan
├── DECISIONS.md         deviations from the spec, with the evidence
└── ASSETS.md            how to install the Tiny Swords asset pack
```

## Art assets

The Tiny Swords pack is **not committed**. Grab it and drop it in per
[`ASSETS.md`](./ASSETS.md) before the phases that render sprites.
