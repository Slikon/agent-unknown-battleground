# Prompts for the coding agent — Agent Unknown's Battlegrounds

How to use this:
1. Put the spec file (`agent-battlegrounds-architecture.md`) at the repo root — e.g. as `SPEC.md`. The agent should have it in view every session.
2. Start with Prompt 0 (setup). After that — strictly one phase at a time.
3. After each phase: manually verify the readiness criterion from the spec yourself → give the revision prompt → only then move to the next phase.
4. Prompts can be given in any language — doesn't matter. Ask for code, variable names, and commits in English.

---

## Prompt 0 — Project setup

```
Read the SPEC.md file at the repo root in full. This is the spec for
the project you'll be following in every task from now on.

Your first task is setup only, no game logic:

1. Create a pnpm monorepo with the structure from spec section 2:
   packages/client (Vite + Phaser 3 + TypeScript),
   packages/server (Node + Colyseus + TypeScript),
   packages/shared (plain TypeScript: types, Zod schemas, constants).
2. Enable TypeScript strict mode everywhere, one shared tsconfig.base.json.
3. Add scripts: `pnpm dev` (client + server in parallel),
   `pnpm dev:client`, `pnpm dev:server`.
4. In shared, create a stub DirectiveSchema from spec section 4 (Zod)
   and export the Directive type.
5. Client: an empty Phaser scene showing "AUB — Phase 0".
   Server: Colyseus boots on port 2567, a "match" room is created
   but stays empty.
6. Create ASSETS.md with instructions on where I should drop the Tiny
   Swords pack (assets go into packages/client/public/assets/).
7. README.md: how to run the project from scratch.

Rules that apply to the whole project:
- Don't implement anything from future phases, even if it's
  "convenient to do now."
- All rules from spec section 9 (best practices) are mandatory.
- At the end give me a list of commands to verify everything works.
```

After this runs: drop the assets into the noted folder, run `pnpm dev`, confirm the client opens and the server boots without errors.

---

## Prompt 1 — Phase 0: map and a walking warrior

```
Moving on to Phase 0 from SPEC.md (section 8). Client only, don't touch
the server.

1. I've created a map in Tiled and placed it at
   public/assets/maps/island.tmj (if the file's missing — generate a
   simple 60x60 map programmatically: a grass island, water around the
   edges, 20-30 impassable tree/rock tiles, and tell me the map should
   be replaced with a Tiled version).
2. Load and render the tilemap in GameScene.
3. Slice the blue warrior's spritesheet (Blue Units/Warrior). IMPORTANT:
   first determine frameWidth/frameHeight from the actual PNG dimensions
   and frame count — don't guess numbers. Create idle and run animations.
4. The warrior walks on mouse click: click -> smooth movement to the
   point, run animation while moving, idle when stopped, sprite flip
   based on direction. NO pathfinding yet — straight-line movement.
5. Camera follows the warrior, pick a zoom level that keeps the pixel
   art crisp (pixelArt: true, integer zoom).

Done when: I open the browser and see the island and an animated
warrior walking around on clicks. Don't build the server, combat, or
other units yet.
```

---

## Prompt 2 — Phase 1: authoritative server

```
Phase 1 from SPEC.md. Move movement to the server, make the client thin.

1. In shared: a Colyseus state schema (MatchState, AgentState:
   id, color, x, y, dir, anim).
2. Server: a MatchRoom with a fixed 20 Hz timestep (spec section 9,
   rule 2). A unit spawns when a client connects, each subsequent
   player gets the next color (blue, red, purple, yellow, black).
3. The client only sends a move {x, y} message to the server on click.
   The server validates and moves the unit itself. The client renders
   the state from the Colyseus sync with lerp interpolation between
   ticks.
4. The server listens on 0.0.0.0 so it can later be reached over LAN.
5. Remove all the movement logic left over from Phase 0 on the client.

Done when: two browser windows — each one shows BOTH units of
different colors, movement in the other window is smooth, no
teleporting. Test it yourself with two connections if you can.
```

---

## Prompt 3 — Phase 2: combat

```
Phase 2 from SPEC.md. Combat and death, all on the server.

1. Wire up A* pathfinding over the tile grid on the server (easystar.js
   or pathfinding). Impassable tiles come from the map. Click-to-move
   now paths around obstacles.
2. AgentState: hp (100). Warrior: 15 damage per hit, 0.8 s cooldown,
   40 px attack range. Put combat constants in shared/constants.ts.
3. Hardcode a temporary directive for all agents from shared:
   { stance: "aggressive", move_target: {type:"nearest_enemy"},
     engage_range: 400, target_priority: "closest",
     retreat_hp: 0, retreat_to: "away_from_enemy" }.
4. Implement the Behavior Executor with the priority order from spec
   section 3.1 (skip the zone rule for now — there's no zone yet). It
   should read ANY directive, not just the hardcoded one — write the
   general-purpose version straight away.
5. Death: hp <= 0 -> explosion animation (Particle FX/Explosion_01),
   agent is removed from state.
6. Client: HP bars above units (UI Elements/Bars/SmallBar),
   Warrior_Attack1 animation on hit.

Done when: two connected units close in on each other on their own,
fight, and one dies. It's fine to disable click-to-move now — agents
are driven by directives.
```

---

## Prompt 4 — Phase 3: battle royale loop

```
Phase 3 from SPEC.md. The full game loop.

1. Zone: a circle (center, radius) in MatchState. Cycle: 30 s pause ->
   20 s smooth shrink -> repeat. Final center is random. Outside the
   zone: 5 hp/sec. Client draws the circle and darkens the area outside it.
2. Add override rule #2 from spec section 3.1 to the Behavior Executor:
   if the agent is outside the safe circle or the circle is shrinking
   onto them, movement toward the circle overrides the directive's
   move_target. The player cannot disable this rule.
3. A 5-slot match: live players + bots filling the rest. Give bots
   2-3 different hardcoded directives (an aggressor, a camper near
   the center, a coward with retreat_hp 0.5).
4. Match phases: lobby (waiting) -> countdown -> live -> finished.
   Spawn 5 agents around the map's edge. Win = last one alive, a
   winner screen (color + name), room auto-restarts after 10 s.
5. Mini UI: live-player counter, timer until the next zone shrink.

Done when: I start a match with 0 humans (5 bots) — the match plays
itself out to a winner in 3-5 minutes. Same with 1-2 connected windows.
```

---

## Prompt 5 — Phase 4: LLM pipeline (the heart of the project)

```
Phase 4 from SPEC.md — the main phase. Wiring up LLM interpretation of
orders.

Context: an inference server is running locally on this machine
[Ollama at http://localhost:11434 / llama.cpp server at http://localhost:8080 —
SUBSTITUTE YOUR ACTUAL SETUP], model [MODEL NAME]. It supports
structured output against a JSON Schema.

1. In shared: the final DirectiveSchema (spec section 4) + JSON Schema
   generation from the Zod schema (zod-to-json-schema). Move
   LANDMARK_NAMES into constants; landmark coordinates/polygons go in
   the map config.
2. Server, LlmDirectiveService module:
   - a request queue, max 2 in parallel;
   - system prompt from spec section 5, with agent state and current
     directive substituted in;
   - call the inference server with a forced JSON schema,
     temperature 0.2, 6-second timeout;
   - validate the response with Zod; invalid or timed out -> keep the
     directive unchanged, send the player "the agent didn't understand
     the order."
3. Client: an order input field (HTML overlay at the bottom), Enter ->
   send. Below the field — a log: my order + the agent's
   acknowledgement. Other players' orders stay hidden from me (rule 9
   in section 9).
4. Logging: write every call as a line to logs/directives.jsonl:
   { ts, agentId, playerText, promptState, rawResponse, parsedDirective,
     latencyMs, ok }.
5. Write a small script scripts/test-llm.ts: runs 10 test orders
   (give it a variety: movement, "don't fight," retreating, gibberish,
   a jailbreak attempt) with no game running, prints the directives
   and latencies.

Done when: in a live match, typing "run to the lake and don't touch
anyone" makes the agent run to the lake, ignoring enemies. Typing
gibberish makes the agent report it didn't understand, and its
behavior doesn't change.
```

---

## Prompt 6 — Phase 5: archer and playability

```
Phase 5 from SPEC.md.

1. Archer class: 10 damage, 1.5 s cooldown, 300 px range, an Arrow
   projectile that travels at finite speed, damage on hit (simple
   radius-based collision). Sprites from <Color> Units/Archer.
2. Lobby scene: player name, class pick (Warrior/Archer), buttons from
   the UI kit (BigBlueButton). Bots get a random class.
3. Killfeed top-right on Ribbon_<Color> banners: "Red killed Yellow."
4. Sounds: 2-3 free SFX (hit, shot, death) — grab them from
   freesound/kenney.nl, credit the sources in CREDITS.md.
5. Walk through the edge cases: death mid-order, an order to a dead
   agent, a player disconnect (the agent stays as a bot running its
   current directive).

Done when: a match with 2 humans + 3 bots, both classes present, runs
crash-free and feels like a game rather than a tech demo.
```

---

## Prompt 7 — Phase 6: LAN and playtest prep

```
Phase 6 from SPEC.md.

1. Verify the client builds to static files (pnpm build) and the
   server serves them itself — so a second computer can just open
   http://<IP>:2567 without the Vite dev server.
2. Inference server address, port, room size, zone timings — move into
   .env / config.ts, not hardcoded.
3. Script scripts/analyze-logs.ts: reads logs/directives.jsonl, prints:
   total orders, % ok, p50/p95 latency, the last 10 failed orders with
   their text.
4. README: a "How to play over LAN" section (finding your IP, macOS
   firewall).

Done when: from a second device on the same Wi-Fi network, the game
opens and is playable.
```

---

## Utility prompts (situational)

**Revision after each phase** (give before moving on):
```
Phase N is done on my end. Before we move on, do a review pass:
1) check the code for this phase against SPEC.md sections 3 and 9;
2) find any places where logic leaked into the client — fix them;
3) remove dead code and TODOs from this phase;
4) commit with tag phase-N and give me a short summary: what was
   done, any deviations from the spec and why.
```

**Bug report:**
```
Bug: [what I'm doing] -> [what happens] -> [what I expected].
[paste error/log/screenshot]
First explain your hypothesis for the cause and where you'll look,
then fix it. Don't refactor anything unrelated to the bug while
you're at it.
```

**Agent is running ahead of the plan:**
```
Stop. You're implementing functionality from phase N+1 (or outside
the spec). Roll these changes back. We work strictly one phase at a
time. If you think it's genuinely unavoidable, argue the case to me
first — I'll decide.
```

**Agent proposes an architecture change:**
```
Log the proposal in a DECISIONS.md file with pros/cons, but implement
it as written in SPEC.md. Deviations from the spec only happen after
my explicit sign-off.
```

---

## When to come back to Claude

1. **Before Phase 4** — if you want, we can calibrate the system
   prompt for whichever specific model you land on (the prompt in
   spec section 5 is a starting point, not the final version).
2. **Most important: after the first Phase 4-6 playtests** — bring
   back logs/directives.jsonl (or the analyze-logs output plus 15-20
   raw failed "order -> model response" pairs). We'll go through where
   the model is getting things wrong and figure out what to tune:
   prompt wording, the directive schema, temperature, or the model
   itself.
3. Along the way — any time the coding agent is going in circles on
   something: sometimes it just needs a second pair of eyes at the
   architecture level.
