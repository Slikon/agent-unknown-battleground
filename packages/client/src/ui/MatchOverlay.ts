import type { AgentColor, MatchState } from "@aub/shared";

/** Faction color → CSS color for the winner banner. */
const FACTION_CSS: Record<AgentColor, string> = {
  blue: "#4aa3ff",
  red: "#ff5a5a",
  purple: "#b96bff",
  yellow: "#ffd23f",
  black: "#9aa3b2",
};

const STYLE_ID = "aub-overlay-style";
const CSS = `
.aub-overlay{position:fixed;inset:0;pointer-events:none;z-index:10;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;
  text-shadow:0 2px 4px rgba(0,0,0,.6);}
.aub-topbar{position:absolute;top:0;left:0;right:0;display:flex;
  justify-content:space-between;padding:14px 18px;}
.aub-chip{background:rgba(12,16,26,.62);border:1px solid rgba(255,255,255,.14);
  border-radius:10px;padding:8px 14px;font-size:15px;font-weight:600;
  letter-spacing:.04em;}
.aub-chip[hidden]{display:none;}
.aub-chip .warn{color:#ff7676;}
.aub-center{position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;text-align:center;gap:10px;}
.aub-center[hidden]{display:none;}
.aub-title{font-size:34px;font-weight:800;letter-spacing:.06em;}
.aub-sub{font-size:18px;opacity:.85;}
.aub-count{font-size:96px;font-weight:800;line-height:1;}
.aub-winner-card{background:rgba(12,16,26,.72);border:1px solid rgba(255,255,255,.16);
  border-radius:18px;padding:28px 46px;display:flex;flex-direction:column;
  align-items:center;gap:8px;}
.aub-winner-label{font-size:20px;letter-spacing:.28em;opacity:.8;}
.aub-winner-name{font-size:52px;font-weight:800;}
`;

/**
 * Crisp HTML mini-UI drawn over the scaled Phaser canvas (SPEC.md §3.2). Reads
 * synced match state each frame and shows the live-player count, the zone timer,
 * the lobby/countdown banner, and the winner screen (SPEC.md §8 Phase 3). It is
 * render-only — it never sends anything (the order input arrives in Phase 4).
 */
export class MatchOverlay {
  private readonly root: HTMLDivElement;
  private readonly aliveChip: HTMLDivElement;
  private readonly zoneChip: HTMLDivElement;
  private readonly center: HTMLDivElement;
  private status: string | null = null;

  constructor() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    this.root = el("div", "aub-overlay");
    const topbar = el("div", "aub-topbar");
    this.aliveChip = el("div", "aub-chip");
    this.zoneChip = el("div", "aub-chip");
    topbar.append(this.aliveChip, this.zoneChip);
    this.center = el("div", "aub-center");
    this.root.append(topbar, this.center);
    document.body.appendChild(this.root);
  }

  /** Show a plain status message (connecting/disconnected) that overrides phase UI. */
  setStatus(message: string | null): void {
    this.status = message;
  }

  update(state: MatchState): void {
    if (this.status) {
      this.aliveChip.hidden = true;
      this.zoneChip.hidden = true;
      this.showCenter(`<div class="aub-title">${escapeHtml(this.status)}</div>`);
      return;
    }

    const live = state.phase === "live";

    // Alive counter.
    this.aliveChip.hidden = !live;
    if (live) this.aliveChip.textContent = `ALIVE  ${state.agents.size}`;

    // Zone timer.
    this.zoneChip.hidden = !live;
    if (live) {
      this.zoneChip.innerHTML = state.zone.shrinking
        ? `<span class="warn">⚠ ZONE CLOSING</span>`
        : `NEXT SHRINK  ${state.zone.nextShrinkSec}s`;
    }

    // Center banner by phase.
    switch (state.phase) {
      case "lobby":
        this.showCenter(
          `<div class="aub-title">WAITING</div>` +
            `<div class="aub-sub">match starts in ${state.phaseTimer}s</div>`,
        );
        break;
      case "countdown":
        this.showCenter(
          `<div class="aub-sub">GET READY</div>` +
            `<div class="aub-count">${state.phaseTimer}</div>`,
        );
        break;
      case "live":
        this.hideCenter();
        break;
      case "finished": {
        const color = state.winnerColor
          ? FACTION_CSS[state.winnerColor as AgentColor] ?? "#fff"
          : "#fff";
        const name = state.winnerName || "Nobody";
        this.showCenter(
          `<div class="aub-winner-card">` +
            `<div class="aub-winner-label">WINNER</div>` +
            `<div class="aub-winner-name" style="color:${color}">${escapeHtml(name)}</div>` +
            `<div class="aub-sub">next match in ${state.phaseTimer}s</div>` +
            `</div>`,
        );
        break;
      }
    }
  }

  private showCenter(html: string): void {
    this.center.hidden = false;
    this.center.innerHTML = html;
  }

  private hideCenter(): void {
    this.center.hidden = true;
    this.center.innerHTML = "";
  }

  destroy(): void {
    this.root.remove();
  }
}

function el(tag: string, className: string): HTMLDivElement {
  const node = document.createElement(tag) as HTMLDivElement;
  node.className = className;
  return node;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}
