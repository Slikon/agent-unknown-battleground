import {
  type AgentSnapshot,
  type Directive,
  DEFAULT_DIRECTIVE,
  DIRECTIVE_JSON_SCHEMA,
  DirectiveSchema,
  renderSystemPrompt,
} from "@aub/shared";
import { DirectiveLog } from "./DirectiveLog";

/**
 * The LLM Directive Service (SPEC.md §3.1/§8 Phase 4) — the one place that
 * talks to Ollama. Owns a small request queue (so a burst of orders can't
 * choke the Mac), builds the structured-output request, and runs every
 * response through mandatory Zod validation before it's trusted (SPEC.md §9
 * rule 4). One instance per `MatchRoom`.
 *
 * Config is hardcoded here this phase (`.env` extraction is Phase 6, see
 * PHASE4_PLAN.md §0); the model choice is recorded in DECISIONS.md.
 */
const OLLAMA_URL = "http://localhost:11434";
/**
 * Must be a GGUF (llama.cpp-backed) tag — never an `-mlx` one. Ollama's MLX
 * backend silently ignores `format`: the request still returns 200 with
 * plausible-looking JSON, but nothing is grammar-constrained, so the model
 * invents enum values, nulls required fields and wraps output in markdown
 * fences. Measured side by side on the same prompt and schema (enum
 * ["red","green"]): `gemma4:e4b` answered `{"color":"red"}`, `gemma4:e4b-mlx`
 * answered ```json {"color":"blue", "nuance":...} ```. There is no error to
 * catch — the only symptom is a flood of `invalid_schema`. See DECISIONS.md.
 */
const MODEL = "gemma4:e4b";
const TEMPERATURE = 0.2; // SPEC §5
const TIMEOUT_MS = 6_000; // SPEC §3.1
const MAX_IN_FLIGHT = 2; // SPEC §3.1: request queue, max 1-2 parallel
const KEEP_ALIVE = "60m"; // model stays hot between orders
const NUM_PREDICT = 512; // hard cap; schema-constrained output is ~150 tok

// Sanitize-clamp bounds (see DECISIONS.md — deliberate, small leniency BEFORE
// strict Zod validation; structural violations are never repaired).
const ACK_MAX_CHARS = 120;
const ENGAGE_RANGE_MIN = 0;
const ENGAGE_RANGE_MAX = 400;
/** Above this a `retreat_hp` can only be a percentage; at or below it, a fraction. */
const RETREAT_HP_FRACTION_MAX = 1;
const RETREAT_HP_PERCENT_MAX = 100;

export type InterpretFailureReason =
  | "timeout"
  | "http_error"
  | "bad_json"
  | "invalid_schema"
  | "overloaded";

export type InterpretResult =
  | { ok: true; directive: Directive; latencyMs: number }
  | { ok: false; reason: InterpretFailureReason; latencyMs: number };

export interface InterpretRequest {
  agentId: string;
  playerText: string;
  snapshot: AgentSnapshot;
}

interface Job extends InterpretRequest {
  enqueuedAt: number;
  resolve: (result: InterpretResult) => void;
}

/** A trivial snapshot for the boot warm-up call — its content is never used. */
const WARMUP_SNAPSHOT: AgentSnapshot = {
  hpPercent: 100,
  pos: { x: 0, y: 0 },
  nearestLandmark: "center",
  visibleEnemies: [],
  currentDirective: DEFAULT_DIRECTIVE,
};

/** Constructor overrides — only `scripts/test-llm.ts` uses these (`--model` benchmarking); the
 *  game path always uses the hardcoded default. */
export interface LlmDirectiveServiceOptions {
  model?: string;
}

export class LlmDirectiveService {
  private readonly log = new DirectiveLog();
  private readonly queue: Job[] = [];
  private readonly model: string;
  private inFlight = 0;

  constructor(options: LlmDirectiveServiceOptions = {}) {
    this.model = options.model ?? MODEL;
  }

  /**
   * Queue an order for interpretation. Resolves once Ollama has answered (or
   * failed) — never rejects; every failure mode maps to `{ok:false, reason}`
   * so the caller never needs a try/catch (SPEC.md §9 rule 5).
   */
  interpret(req: InterpretRequest): Promise<InterpretResult> {
    return new Promise((resolve) => {
      // Per-agent coalescing: a new order replaces this agent's still-queued
      // (not yet started) job — latest order wins, the bumped one reads as
      // "Belay that — new orders." to the player.
      const staleIndex = this.queue.findIndex((j) => j.agentId === req.agentId);
      if (staleIndex !== -1) {
        const [stale] = this.queue.splice(staleIndex, 1);
        stale.resolve({ ok: false, reason: "overloaded", latencyMs: Date.now() - stale.enqueuedAt });
      }

      this.queue.push({ ...req, enqueuedAt: Date.now(), resolve });
      this.pump();
    });
  }

  /** Fire-and-forget tiny request at boot so the first real order isn't a cold model load. */
  warmUp(): void {
    void this.chat(WARMUP_SNAPSHOT, "hold your position").then((result) => {
      if ("error" in result) {
        console.warn(
          `[LlmDirectiveService] warm-up call failed (${result.error}) — Ollama may be ` +
            `down or unreachable at ${OLLAMA_URL}; orders will degrade gracefully until it's up.`,
        );
      } else {
        console.log(`[LlmDirectiveService] warm-up ok — model "${this.model}" is loaded`);
      }
    });
  }

  // ── Queue pump ──────────────────────────────────────────────────────────────

  private pump(): void {
    while (this.inFlight < MAX_IN_FLIGHT && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;
      this.inFlight += 1;
      void this.runJob(job).finally(() => {
        this.inFlight -= 1;
        this.pump();
      });
    }
  }

  private async runJob(job: Job): Promise<void> {
    const startedAt = Date.now();
    const result = await this.chat(job.snapshot, job.playerText);
    const latencyMs = Date.now() - startedAt;
    const ts = new Date().toISOString();

    if ("error" in result) {
      await this.log.append({
        ts,
        agentId: job.agentId,
        playerText: job.playerText,
        promptState: job.snapshot,
        rawResponse: result.error,
        parsedDirective: null,
        latencyMs,
        ok: false,
      });
      job.resolve({ ok: false, reason: result.error, latencyMs });
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(result.raw);
    } catch {
      await this.log.append({
        ts,
        agentId: job.agentId,
        playerText: job.playerText,
        promptState: job.snapshot,
        rawResponse: result.raw,
        parsedDirective: null,
        latencyMs,
        ok: false,
      });
      job.resolve({ ok: false, reason: "bad_json", latencyMs });
      return;
    }

    const parsed = DirectiveSchema.safeParse(sanitize(parsedJson));
    if (!parsed.success) {
      await this.log.append({
        ts,
        agentId: job.agentId,
        playerText: job.playerText,
        promptState: job.snapshot,
        rawResponse: result.raw,
        parsedDirective: null,
        latencyMs,
        ok: false,
      });
      job.resolve({ ok: false, reason: "invalid_schema", latencyMs });
      return;
    }

    await this.log.append({
      ts,
      agentId: job.agentId,
      playerText: job.playerText,
      promptState: job.snapshot,
      rawResponse: result.raw,
      parsedDirective: parsed.data,
      latencyMs,
      ok: true,
    });
    job.resolve({ ok: true, directive: parsed.data, latencyMs });
  }

  // ── The Ollama call ──────────────────────────────────────────────────────────

  /** POST /api/chat with structured output; resolves the raw content string or a failure tag. */
  private async chat(
    snapshot: AgentSnapshot,
    playerText: string,
  ): Promise<{ raw: string } | { error: "timeout" | "http_error" }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          think: false, // Qwen3.x reasons by default; we need fast JSON, not a chain of thought
          format: DIRECTIVE_JSON_SCHEMA,
          options: { temperature: TEMPERATURE, num_predict: NUM_PREDICT },
          keep_alive: KEEP_ALIVE,
          messages: [
            { role: "system", content: renderSystemPrompt(snapshot) },
            { role: "user", content: playerText }, // raw, untrusted
          ],
        }),
      });
      if (!res.ok) return { error: "http_error" };
      const body = (await res.json()) as { message?: { content?: unknown } };
      const content = body.message?.content;
      if (typeof content !== "string") return { error: "http_error" };
      return { raw: content };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return { error: "timeout" };
      return { error: "http_error" };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Deliberate, small leniency applied BEFORE strict Zod validation (see
 * DECISIONS.md): truncate `acknowledgement` to `ACK_MAX_CHARS` and clamp
 * `engage_range` into its spec range — but ONLY when the raw value is already
 * a number/string of the right type. Ollama's grammar doesn't reliably enforce
 * numeric bounds; rejecting an otherwise-perfect directive because the model
 * said `engage_range: 450` would punish the player for our schema's ceiling.
 * Structural violations (wrong types, missing fields, bad enums) are NOT
 * repaired — `DirectiveSchema.safeParse` still runs on the result and is the
 * real gate.
 *
 * `retreat_hp` is converted rather than clamped, because its failure mode is a
 * unit error, not an overshoot. Every part of the conversation is in percent —
 * the prompt states "55% HP", the player says "below half HP", the model's own
 * acknowledgement reads "unter 50%" — and only this schema speaks fractions, so
 * the model answers `50` meaning `0.5`. Clamping that to 1.0 would mean "always
 * retreat", the most wrong value available rather than a nearly-right one, and
 * the agent would cower permanently while its acknowledgement claimed it
 * understood — worse than an honest failure in a game whose premise is that
 * your words become behavior.
 *
 * Prompting does not fix it: three escalating `retreat_hp` descriptions,
 * including one spelling out "divide it by 100, 50% becomes 0.5", all returned
 * an identical 50/30/25 (see DECISIONS.md). So the conversion is load-bearing
 * and runs on essentially every retreat order, not as a rare safety net.
 *
 * The mapping is total and unambiguous: [0,1] is already a fraction and is left
 * alone, (1,100] can only be a percentage, and the two readings agree exactly at
 * 1 ("100%" and "always retreat" are the same directive). Anything outside
 * [0,100] is not a recognisable unit at all — it falls through to Zod, fails
 * `invalid_schema`, and surfaces as "the agent didn't understand" with the
 * previous directive intact. Clamping `engage_range` is safe by contrast:
 * 450 -> 400 still means "fight anything you see", which is what was asked.
 */
function sanitize(input: unknown): unknown {
  if (typeof input !== "object" || input === null) return input;
  const obj: Record<string, unknown> = { ...(input as Record<string, unknown>) };

  if (typeof obj.acknowledgement === "string" && obj.acknowledgement.length > ACK_MAX_CHARS) {
    obj.acknowledgement = obj.acknowledgement.slice(0, ACK_MAX_CHARS);
  }
  if (typeof obj.engage_range === "number") {
    obj.engage_range = clamp(obj.engage_range, ENGAGE_RANGE_MIN, ENGAGE_RANGE_MAX);
  }
  if (
    typeof obj.retreat_hp === "number" &&
    obj.retreat_hp > RETREAT_HP_FRACTION_MAX &&
    obj.retreat_hp <= RETREAT_HP_PERCENT_MAX
  ) {
    obj.retreat_hp = obj.retreat_hp / RETREAT_HP_PERCENT_MAX;
  }
  return obj;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
