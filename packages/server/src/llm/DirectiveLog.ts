import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentSnapshot, Directive } from "@aub/shared";

/** One line of the JSONL log — the exact shape SPEC.md §5/§9 rule 6 asks for. */
export interface DirectiveLogEntry {
  ts: string;
  agentId: string;
  playerText: string;
  promptState: AgentSnapshot;
  /** Raw `message.content` from Ollama, or the failure reason string. */
  rawResponse: string;
  /** The post-sanitize, Zod-validated directive, or null on any failure. */
  parsedDirective: Directive | null;
  latencyMs: number;
  ok: boolean;
}

/**
 * Appends one JSONL line per LLM call to `packages/server/logs/directives.jsonl`
 * — the prompt-iteration dataset (SPEC.md §5/§9 rule 6). The path is resolved
 * relative to the server package root, not `process.cwd()`, so `pnpm dev` run
 * from the repo root and `tsx scripts/test-llm.ts` run from anywhere agree on
 * the same file. `logs/` is already gitignored.
 */
export class DirectiveLog {
  private readonly filePath: string;
  private dirEnsured: Promise<void> | null = null;

  constructor() {
    // This file lives at packages/server/src/llm/DirectiveLog.ts — "../.." from
    // here is the server package root (src/llm → src → server).
    const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
    this.filePath = path.join(packageRoot, "logs", "directives.jsonl");
  }

  async append(entry: DirectiveLogEntry): Promise<void> {
    try {
      await this.ensureDir();
      await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
    } catch (err) {
      // Logging is a side effect, never a dependency of the game loop (SPEC.md
      // §9 rule 5) — a disk failure here is a warning, not a crash.
      console.warn(
        `[DirectiveLog] failed to append: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private ensureDir(): Promise<void> {
    if (!this.dirEnsured) {
      this.dirEnsured = mkdir(path.dirname(this.filePath), { recursive: true }).then(() => undefined);
    }
    return this.dirEnsured;
  }
}
