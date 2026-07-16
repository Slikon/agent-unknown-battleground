# Architecture

One rule explains most of it: **the server is the only source of truth.** The client renders
state and sends two things (an order, a join). It never decides anything.

## The pieces

```mermaid
flowchart TB
    subgraph client["packages/client — renders, never decides"]
        GS["GameScene<br/><i>draws agents, zone, map</i>"]
        OC["OrderConsole<br/><i>your order box + ack log</i>"]
        MO["MatchOverlay<br/><i>alive count, timers, winner</i>"]
    end

    subgraph shared["packages/shared — the contract, imported by both"]
        DIR["directive.ts<br/><i>Zod schema = THE contract</i>"]
        ST["state.ts<br/><i>Colyseus synced schema</i>"]
        LLM["llm.ts<br/><i>JSON schema, system prompt</i>"]
        MAP["map.ts + constants.ts<br/><i>island, tuning</i>"]
    end

    subgraph server["packages/server — authoritative"]
        MR["MatchRoom<br/><i>phase machine, 20 Hz tick</i>"]
        BE["BehaviorExecutor<br/><i>runs directives</i>"]
        ZN["Zone"]
        PF["Pathfinder<br/><i>A*</i>"]
        SVC["LlmDirectiveService<br/><i>queue, validate</i>"]
        LOG["DirectiveLog<br/><i>JSONL</i>"]
    end

    OL(["Ollama<br/>gemma4:e4b"])

    OC -- "order {text}" --> MR
    MR -- "ack (to that client only)" --> OC
    MR -. "state sync (broadcast)" .-> GS
    MR -. "state sync" .-> MO
    MR --> BE --> PF
    MR --> ZN
    MR --> SVC --> OL
    SVC --> LOG
    BE -.reads.- DIR
    SVC -.reads.- LLM
    GS -.reads.- MAP

    style shared fill:#f5f5dc,stroke:#999
    style OL fill:#e8e8ff,stroke:#669
```

`shared` exists so the `Directive` schema lives in exactly one place — the same Zod object
validates the LLM's output *and* generates the JSON schema handed to it.

## Who does what

| Component | Job |
|---|---|
| `MatchRoom` | Owns the match: seats agents, runs the phase machine, ticks at 20 Hz, handles orders. |
| `BehaviorExecutor` | Turns one directive into movement/combat, per agent, per tick. Stateless about *who* — a bot and a human are both just directives. |
| `Zone` | The shrinking circle; damages whoever's outside. |
| `LlmDirectiveService` | The only thing that talks to Ollama. Queue → call → sanitize → **Zod** → directive. |
| `DirectiveLog` | Appends every order→directive pair to `logs/directives.jsonl`. This is the prompt-tuning dataset. |
| `GameScene` | Draws synced state. No game logic. |
| `OrderConsole` | Your input box + your own order/ack log. Never sees other players' orders. |

## Sending an order

```mermaid
sequenceDiagram
    participant P as You
    participant C as OrderConsole
    participant R as MatchRoom
    participant S as LlmDirectiveService
    participant O as Ollama
    participant E as BehaviorExecutor

    P->>C: "run to the lake and don't touch anyone"
    C->>R: order {text}
    Note over R: guards: real text? phase live?<br/>agent alive? → else reject with a reason
    R->>R: snapshot (hp, pos, enemies, current directive)
    R->>S: interpret(order, snapshot)
    Note over R,E: tick loop never blocks — the match<br/>keeps running the OLD directive
    S->>O: /api/chat + JSON schema (grammar-constrained)
    O-->>S: JSON directive
    S->>S: sanitize → Zod validate
    alt valid
        S-->>R: directive
        R->>E: setDirective(agent)
        R-->>C: ack ok "Running to the lake…"
    else timeout / bad JSON / schema fail
        S-->>R: failure
        R-->>C: ack fail "didn't understand" (old directive stands)
    end
```

Two things guard against chaos: a **match-epoch fence** (a reply landing after the match
reset is dropped) and an **alive re-check** (your agent may have died while the model thought).

## The tick (20 Hz, fixed)

```mermaid
flowchart LR
    A["accumulate<br/>real ms"] --> B{"≥ 50 ms?"}
    B -- yes --> C["zone update<br/>+ damage"] --> D["executor:<br/>each agent"] --> E["deaths /<br/>winner?"] --> F["state syncs<br/>to clients"]
    B -- no --> G["wait"]
```

Wall-clock deltas are jittery, so the loop accumulates them and steps the simulation in exact
50 ms slices — the sim stays deterministic regardless of frame timing.

## Privacy

Orders and acks travel over `client.send()` to one client. Nothing order-related is ever
written to synced state, so it structurally cannot leak to other players. Positions, HP and
the winner are public — that's the whole synced schema.
