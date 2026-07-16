import type Phaser from "phaser";
import type { Room } from "@colyseus/sdk";
import {
  ORDER_ACK_MESSAGE,
  ORDER_MESSAGE,
  type MatchState,
  type OrderAckMessage,
  type OrderMessage,
} from "@aub/shared";

const STYLE_ID = "aub-order-console-style";
const CSS = `
.aub-order-root{position:fixed;inset:0;pointer-events:none;z-index:15;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
.aub-order-dock{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);
  width:min(560px,92vw);display:flex;flex-direction:column;gap:6px;pointer-events:auto;}
.aub-order-dock[hidden]{display:none;}
.aub-order-input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;
  border:1px solid rgba(255,255,255,.18);background:rgba(8,10,18,.74);color:#fff;
  font:inherit;font-size:14px;outline:none;}
.aub-order-input:focus{border-color:rgba(255,255,255,.4);}
.aub-order-input:disabled{opacity:.5;}
.aub-order-input::placeholder{color:rgba(255,255,255,.45);}
.aub-order-log{display:flex;flex-direction:column;gap:2px;max-height:150px;
  overflow:hidden;font-size:13px;}
.aub-order-line{background:rgba(12,16,26,.6);border-radius:6px;padding:4px 9px;
  color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6);}
.aub-order-line.fail{color:#ff9a8f;}
.aub-order-line.status{color:#cfd6e6;font-style:italic;opacity:.9;}
`;

/** How long a pending order can go unanswered before the client gives up waiting. */
const PENDING_FAILSAFE_MS = 8_000;
/** Last-N lines kept in the scrollless log. */
const MAX_LOG_LINES = 6;

type LineKind = "ok" | "fail" | "status";
interface Line {
  text: string;
  kind: LineKind;
}

type Mode = "hidden" | "active" | "dead" | "spectating";

/**
 * The order console (SPEC.md §3.2/§8 Phase 4): a bottom-center HTML overlay
 * with a text input ("Enter" sends an order) and a short log of my own orders
 * and my agent's acknowledgements. Deliberately thin (SPEC.md §9 rule 1): it
 * sends raw `{text}` and renders whatever ack comes back — no directive logic
 * lives on the client. Other players' orders can never appear here because the
 * server only ever sends acks to the client that sent the order.
 */
export class OrderConsole {
  private readonly root: HTMLDivElement;
  private readonly dock: HTMLDivElement;
  private readonly inputEl: HTMLInputElement;
  private readonly logEl: HTMLDivElement;

  private room?: Room<MatchState>;
  private mode: Mode = "hidden";
  private lines: Line[] = [];
  private pending = false;
  private pendingOrderText = "";
  private pendingTimeoutHandle?: number;
  /** Last known display name for my own agent — kept across its death so the
   *  final "your agent is gone" ack can still be attributed correctly. */
  private myName?: string;
  /** Was I seated with a living agent at any point during THIS match? Distinguishes
   *  "died" (show fallen message) from "never seated" (show spectating message). */
  private wasSeated = false;

  constructor(scene: Phaser.Scene) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    this.root = el("div", "aub-order-root");
    this.dock = el("div", "aub-order-dock");
    this.dock.hidden = true;

    this.inputEl = document.createElement("input");
    this.inputEl.className = "aub-order-input";
    this.inputEl.type = "text";
    this.inputEl.maxLength = 300;
    this.inputEl.placeholder = "Order your agent… (Enter to send)";

    this.logEl = el("div", "aub-order-log");

    this.dock.append(this.inputEl, this.logEl);
    this.root.append(this.dock);
    document.body.appendChild(this.root);

    // Keep Phaser's global keyboard capture from swallowing keystrokes meant
    // for this input (a stray "g" from typing "go" must not do anything
    // in-game). Belt-and-suspenders: stop propagation AND toggle Phaser's
    // global capture while the input is focused.
    this.inputEl.addEventListener("focus", () => scene.input.keyboard?.disableGlobalCapture());
    this.inputEl.addEventListener("blur", () => scene.input.keyboard?.enableGlobalCapture());
    for (const evt of ["keydown", "keyup", "keypress"] as const) {
      this.inputEl.addEventListener(evt, (e) => e.stopPropagation());
    }
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.trySend();
    });
  }

  /** Wire up the connected room once `GameScene.connect()` resolves. */
  attachRoom(room: Room<MatchState>): void {
    this.room = room;
    room.onMessage(ORDER_ACK_MESSAGE, (ack: OrderAckMessage) => this.onAck(ack));
  }

  /** Call once per frame (mirrors `MatchOverlay.update`), driven by the same state poll. */
  update(state: MatchState, mySessionId: string | undefined): void {
    const me = mySessionId ? state.agents.get(mySessionId) : undefined;
    if (me) this.myName = me.name.replace(" (bot)", "");

    if (state.phase === "lobby") {
      // A fresh match cycle is starting — forget last match's seating/log.
      this.wasSeated = false;
      this.lines = [];
    }

    const live = state.phase === "countdown" || state.phase === "live";
    let nextMode: Mode;
    if (!live) {
      nextMode = "hidden";
    } else if (me && !me.bot && me.hp > 0) {
      this.wasSeated = true;
      nextMode = "active";
    } else if (this.wasSeated) {
      nextMode = "dead";
    } else {
      nextMode = "spectating";
    }

    if (nextMode === this.mode) return; // no transition — don't touch the DOM every frame
    this.mode = nextMode;
    this.applyMode();
  }

  destroy(): void {
    if (this.pendingTimeoutHandle !== undefined) window.clearTimeout(this.pendingTimeoutHandle);
    this.root.remove();
  }

  // ── Mode transitions ─────────────────────────────────────────────────────────

  private applyMode(): void {
    switch (this.mode) {
      case "hidden":
        this.dock.hidden = true;
        break;
      case "active":
        this.dock.hidden = false;
        this.inputEl.hidden = false;
        this.renderLog();
        break;
      case "dead":
        this.dock.hidden = false;
        this.inputEl.hidden = true;
        this.setStatusOnly("☠ Your agent has fallen — spectating.");
        break;
      case "spectating":
        this.dock.hidden = false;
        this.inputEl.hidden = true;
        this.setStatusOnly("Spectating — you'll be seated next match.");
        break;
    }
  }

  private setStatusOnly(text: string): void {
    this.lines = [{ text, kind: "status" }];
    this.renderLog();
  }

  // ── Sending orders ───────────────────────────────────────────────────────────

  private trySend(): void {
    if (this.pending || !this.room || this.mode !== "active") return;
    const text = this.inputEl.value.trim();
    if (!text) return;

    this.room.send(ORDER_MESSAGE, { text } satisfies OrderMessage);
    this.inputEl.value = "";
    this.pendingOrderText = text;
    this.setPending(true);
    this.pushLine({ text: "⏳ interpreting order…", kind: "status" });
  }

  private onAck(ack: OrderAckMessage): void {
    this.clearPendingTimeout();
    this.setPending(false);

    // Replace the trailing "interpreting" placeholder if it's still there.
    const last = this.lines[this.lines.length - 1];
    if (last?.kind === "status" && last.text.startsWith("⏳")) this.lines.pop();

    const who = this.myName ?? "Agent";
    this.pushLine({ text: `🗣 You: ${this.pendingOrderText}`, kind: ack.ok ? "ok" : "fail" });
    this.pushLine({ text: `💭 ${who}: "${ack.text}"`, kind: ack.ok ? "ok" : "fail" });
  }

  private setPending(pending: boolean): void {
    this.pending = pending;
    this.inputEl.disabled = pending;
    this.clearPendingTimeout();
    if (pending) {
      // Client-side failsafe: if the ack never arrives (dropped socket mid-order),
      // re-enable the input after longer than the server's own 6 s timeout.
      this.pendingTimeoutHandle = window.setTimeout(() => {
        this.pending = false;
        this.inputEl.disabled = false;
        const last = this.lines[this.lines.length - 1];
        if (last?.kind === "status" && last.text.startsWith("⏳")) {
          this.lines[this.lines.length - 1] = { text: "⚠ no response — try again.", kind: "fail" };
          this.renderLog();
        }
      }, PENDING_FAILSAFE_MS);
    }
  }

  private clearPendingTimeout(): void {
    if (this.pendingTimeoutHandle !== undefined) {
      window.clearTimeout(this.pendingTimeoutHandle);
      this.pendingTimeoutHandle = undefined;
    }
  }

  // ── Log rendering ────────────────────────────────────────────────────────────

  private pushLine(line: Line): void {
    this.lines.push(line);
    if (this.lines.length > MAX_LOG_LINES) this.lines = this.lines.slice(-MAX_LOG_LINES);
    this.renderLog();
  }

  private renderLog(): void {
    this.logEl.replaceChildren(
      ...this.lines.map((line) => {
        const div = document.createElement("div");
        div.className = `aub-order-line ${line.kind === "fail" ? "fail" : line.kind === "status" ? "status" : ""}`.trim();
        div.textContent = line.text; // never innerHTML — LLM/ack text is untrusted
        return div;
      }),
    );
  }
}

function el(tag: string, className: string): HTMLDivElement {
  const node = document.createElement(tag) as HTMLDivElement;
  node.className = className;
  return node;
}
