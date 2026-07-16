# Decisions

Deviations from `SPEC.md` / `PHASE4_PLAN.md` that were made deliberately, with the
evidence behind them. Each one needs the user's eventual sign-off; none is load-bearing
enough to be irreversible.

## Phase 4 — LLM order pipeline

### 1. `z.toJSONSchema` instead of the `zod-to-json-schema` package

SPEC §9 rule 3 names `zod-to-json-schema`. That was the Zod-3-era answer; this repo is on
Zod 4, where JSON-Schema generation is native. Same guarantee ("generated from the one Zod
schema"), zero new dependencies.

### 2. The model must be a GGUF tag — never an `-mlx` one

**`MODEL = "gemma4:e4b"`, not `gemma4:e4b-mlx`.**

Ollama's MLX backend **silently ignores `format`**. The request still returns HTTP 200 with
plausible-looking JSON, but nothing is grammar-constrained: the model invents enum values,
nulls required fields, and wraps output in markdown fences. There is no error to catch — the
only symptom is every order failing `invalid_schema`.

Measured side by side, same prompt, same schema (`enum: ["red","green"]`, asking the colour
of the sky — a question whose true answer the enum forbids):

| tag | backend | answer |
|---|---|---|
| `gemma4:e4b` | GGUF / llama.cpp | `{"color": "red"}` — grammar enforced ✓ |
| `gemma4:e4b-mlx` | MLX | ```` ```json {"color":"blue","nuance":"..."} ```` — ignored ✗ |

Running the full 10-order harness against `gemma4:e4b-mlx` scored **0/10**; the same code on
`gemma4:e4b` scores **8-9/10**. `qwen3.6:35b` (also GGUF) enforces the grammar too, so this
is the backend, not the model.

Note that llama.cpp's grammar does **not** enforce numeric `minimum`/`maximum` even when it
is working — `engage_range: 1000` was observed against a `max: 400` schema. This is exactly
why Zod validation stays mandatory (SPEC §9 rule 4) and why `sanitize` clamps.

### 3. Field `.describe()` strings are prompt surface, not documentation

Every `DirectiveSchema` field carries a `.describe()`, because `z.toJSONSchema` emits them as
JSON-Schema `description` keywords and the system prompt never explains the fields. Before
this, the model's only clue to a field's meaning was its name — the semantics existed solely
in TypeScript comments, which reach the next developer but never the model. That single gap
accounted for most early failures (`engage_range` never zeroing, coordinates snapping to a
landmark).

They are prompt-tuned, and phrasing measurably matters: `engage_range` described as a scale
("0 = never … 400 = maximum") answered **1000** for *"only fight if they come close"*, while
the same field described as a decision list ("'don't touch anyone' -> 0, 'only fight if they
come close' -> 120, …") answered 100-120. Re-run `scripts/test-llm.ts` after editing one.

### 4. `retreat_hp` is unit-converted, not clamped

The model answers `50` for *"below half HP"* against a `0..1` schema. Everything else in the
conversation is percent — the prompt states "55% HP", the player says "half HP", the model's
own acknowledgement reads "unter 50%" — and only the schema speaks fractions.

**Prompting does not fix it.** Three escalating descriptions, including one spelling out
*"divide it by 100: 50% becomes 0.5"*, returned an identical `50 / 30 / 25`.

`PHASE4_PLAN.md` §2.1 called for clamping this field alongside `engage_range`. Clamping is
wrong here: it maps `50` to `1.0` = *always retreat*, the most wrong value available, and the
agent then cowers permanently while its acknowledgement claims it understood the order. In a
game whose premise is that your words become behaviour, a confident lie is worse than an
honest failure.

So `sanitize` converts instead: `[0,1]` is left alone, `(1,100]` is divided by 100. The
mapping is total and unambiguous — the two readings agree exactly at 1 ("100%" and "always
retreat" are the same directive) — and anything outside `[0,100]` is not a recognisable unit,
so it falls through to Zod and surfaces as "the agent didn't understand" with the previous
directive intact. `engage_range` is still clamped, because 450 -> 400 still means "fight
anything you see", which is what was asked.

### 5. SPEC §5's language rule is reworded

§5 says: *"Write acknowledgement … in the language of the order."* Against `gemma4:e4b` that
makes English orders come back **in German**. This model treats a bare mention of language as
a cue to pick a foreign one, and naming languages makes it worse:

| prompt variant | English order | Russian order |
|---|---|---|
| spec wording | German ✗ | Russian ✓ |
| rule deleted | English ✓ | English ✗ |
| *"if the order is in English, reply in English"* | English ✓ | **Russian for an English order** ✗ |
| + a Russian few-shot example | **Russian / French / Slovenian** ✗ | Russian ✓ |
| **"Use the exact same language as the player's order — never switch languages, never translate."** | English ✓ | Russian ✓ |

The last wording is the only one that scored clean on both, and is what ships. Deleting the
rule is not an option: it fixes English by breaking every other language.

### 6. Human seats start on `humanInitialDirective(spawn)` — and it must not use `null`

Phase 2's `DEFAULT_DIRECTIVE` charges the nearest enemy, so a human seat rushed in and died
before the player could type — which defeats the point of this phase. Human seats now start
defensive: hold position, `engage_range: 120`, `retreat_hp: 0.25`, ack "Awaiting orders."

It is a **function of the spawn point**, not a constant, and `move_target` anchors to that
spawn rather than the `null` that would express "stay put" more naturally. That detail is
load-bearing. `null` and a spawn-anchored point are identical to the executor —
`resolveMoveTarget` returns null either way and the unit stands — but not to the model: **a
`null` `move_target` in the current directive is sticky, and the model will not replace it.**

This broke the SPEC §8 done-criterion in a real match while every harness case passed. The
player's first order, *"run to the lake and don't touch anyone"*, came back as the initial
directive with only `retreat_to` and the acknowledgement rewritten — an agent standing still,
fighting, while its ack read "Running to the lake, keeping distance." The confident lie of
§4, arriving through a different door.

Isolated over three runs each, same order, changing one field of the current directive:

| current directive | result |
|---|---|
| `null` + `hold_position` (as it was) | ✗ ✗ ✗ — keeps `move_target: null`, `engage_range: 120` |
| `null`, `stance: defensive` | ✗ ✓ ✓ |
| **concrete `move_target`**, `hold_position` | **✓ ✓ ✓** |
| `null`, `engage_range: 300` | ✗ ✗ ✗ |

Only `move_target` matters; an anti-anchoring prompt rule barely moved it. The harness missed
all of this because every case started from `DEFAULT_DIRECTIVE`, whose `move_target` is
non-null — so `test-llm.ts` case 11 now runs the done-criterion from whatever
`humanInitialDirective` actually returns. Keep it that way: it is the only case that reflects
what the game really does on a player's first order.

### 7. `test-llm.ts`: the off-topic checks compared the wrong thing

Cases 7 (gibberish) and 8 (jailbreak) originally asserted
`deepEqual(d, DEFAULT_DIRECTIVE) && mentionsNotUnderstood(d.acknowledgement)`. Those two
conditions are mutually exclusive — `DEFAULT_DIRECTIVE.acknowledgement` is "Charging the
nearest enemy.", which does not contain "not understood" — so the checks could never pass,
and reported failures on responses that were in fact exactly what SPEC §5 asks for. They now
compare every field *except* `acknowledgement`, which the spec explicitly wants replaced.

## Known-unfixed

- **A follow-up order can't turn fighting on or off** — [#2](https://github.com/Slikon/agent-unknown-battleground/issues/2),
  the one consistent harness failure (case 5). *"and also stop attacking"* is acknowledged
  and ignored. Not an anchoring problem: every other field takes a follow-up 3/3. The cause
  is that `engage_range` conflates *whether* to fight with *how far* to chase, and the model
  only recognises the distance half — phrase the same change as a distance and it works 3/3.
  Prompt fixes are measured dead ends; the fix is a schema change. Details in the issue.
- **Results are noisy.** The harness scores 9-10/11 run to run at `temperature: 0.2`; a single
  run is not evidence. Compare medians over several runs when tuning.
- **The harness is not the game.** Two of the bugs above (the impossible off-topic check, the
  sticky `null`) were invisible to `test-llm.ts` and only showed up driving a real match in a
  browser. A green harness is necessary, not sufficient — play it before believing it.
