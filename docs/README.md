# AUB docs

Where the project actually stands, as of **Phase 4**.

- [Architecture](./architecture.md) — the packages, who talks to whom, the order pipeline.
- [Game mechanics](./game-mechanics.md) — match loop, zone, combat, the directive.
- [Decisions](../DECISIONS.md) — deviations from the spec, with the evidence.
- [Spec](../SPEC.md) — the original design. [Phase plan](../PROMPTS_BY_PHASES.md).

## What this is

You don't steer a character. You type an order in plain language; a local LLM compiles it
into a JSON **directive**; a deterministic 20 Hz server executes it until you say otherwise.
The model is the commander, not the muscles — it is called once per order, never in the
game loop.

## What works today

| | |
|---|---|
| **Play a match** | 5 warriors on an island, last one standing wins, auto-restarts forever. Runs with 0 humans — bots fill every seat. |
| **Command your agent** | Type an order → your agent obeys within ~1.5 s. Orders work in any language. |
| **Orders it understands** | Movement to landmarks or exact coordinates, pacifism ("don't touch anyone"), stance, target priority ("hunt the weakest"), conditional retreat ("hide in the north forest below half HP"). |
| **Battle royale** | Shrinking zone in 6 stages, 5 hp/s outside, sudden-death collapse so matches always end. |
| **Refusals** | Gibberish and jailbreaks return "Order not understood" and keep your last directive. |
| **Degrades** | LLM down/slow/wrong → red ack, agent keeps its last directive, match never stalls. |

## What doesn't, yet

- **Turning fighting on/off in a follow-up** — "and also stop attacking" is acknowledged and ignored ([#2](https://github.com/Slikon/agent-unknown-battleground/issues/2)). Other follow-ups ("and also hold the castle") work fine; it's specific to combat. Restate the whole order as a workaround.
- No archer class (Phase 5), no fog of war, no killfeed, no sound, no lobby screen.
- Map is programmatic, not authored in Tiled.

## Stack

| Layer | Tech |
|---|---|
| Client | Phaser 3, Vite, TypeScript |
| Server | Node, Colyseus (`@colyseus/core` + `ws-transport`), TypeScript via `tsx` |
| Shared | Zod schema, Colyseus schema, constants, map — one source of truth |
| LLM | Ollama, `gemma4:e4b` (**GGUF — never `-mlx`**, see [DECISIONS §2](../DECISIONS.md)) |
| Pathfinding | `pathfinding` (A\*), server-only |

Everything runs locally. No cloud, no API keys.
