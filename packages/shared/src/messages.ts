import { z } from "zod";

/**
 * Client → server messages. Anything a client sends is untrusted input and
 * must be Zod-validated on the server before it touches game state — the same
 * posture as LLM output (SPEC.md §9 rule 4).
 */

/** Message type for a move order. */
export const MSG_MOVE = "move";

/**
 * "Send my agent here" — the only order a client can give in Phase 1.
 * Zod 4's z.number() already rejects NaN and ±Infinity; the server clamps the
 * point to world bounds on top of this.
 */
export const MoveMessageSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export type MoveMessage = z.infer<typeof MoveMessageSchema>;
