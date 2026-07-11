import Phaser from "phaser";
import { Callbacks, Client, type Room } from "@colyseus/sdk";
import {
  type AgentState,
  MatchState,
  OBSTACLE_TILES,
  TILE_SIZE,
  WARRIOR_MAX_HP,
  tileCenterPx,
} from "@aub/shared";
import { warriorAnimKey } from "../assets/warrior";
import { EXPLOSION_ANIM, EXPLOSION_SHEET } from "../assets/explosion";

/**
 * Time constant (ms) of the exponential lerp that chases server positions.
 * Small enough that a unit trails its 20 Hz server position by only a few
 * frames; large enough that discrete ticks render as smooth motion.
 */
const LERP_TAU_MS = 80;

const HP_BAR_W = 34;
const HP_BAR_H = 5;
const HP_BAR_OFFSET = 30; // px above the sprite's center
const UI_DEPTH = 100_000; // HP bars always draw over every unit

interface UnitView {
  sprite: Phaser.GameObjects.Sprite;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFill: Phaser.GameObjects.Rectangle;
}

/**
 * The match view. Deliberately thin (SPEC.md §9 rule 1): it renders whatever the
 * server's state sync says — units, HP, the impassable tiles, death explosions.
 * No movement, combat, or pathfinding runs here; Phase 2 units are driven
 * entirely by the server's behavior executor, so there is no click-to-move.
 */
export class GameScene extends Phaser.Scene {
  private room?: Room<MatchState>;
  private units = new Map<string, UnitView>();
  private statusText!: Phaser.GameObjects.Text;

  constructor() {
    super("GameScene");
  }

  create(): void {
    this.drawObstacles();

    const { width, height } = this.scale;
    this.statusText = this.add
      .text(width / 2, height / 2, "connecting…", {
        fontFamily: "monospace",
        fontSize: "24px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setDepth(UI_DEPTH + 1);

    void this.connect();
  }

  /** Render the shared collision map's impassable tiles (SPEC.md §3.1). */
  private drawObstacles(): void {
    for (const tile of OBSTACLE_TILES) {
      const { x, y } = tileCenterPx(tile.col, tile.row);
      this.add
        .rectangle(x, y, TILE_SIZE, TILE_SIZE, 0x555a63)
        .setStrokeStyle(1, 0x2b2f36);
    }
  }

  private async connect(): Promise<void> {
    // Same hostname the page was served from, so a LAN client that opened
    // http://192.168.x.x:5173 reaches the server on that machine (SPEC.md §10).
    const endpoint = `ws://${window.location.hostname}:2567`;

    try {
      const room = await new Client(endpoint).joinOrCreate("match", {}, MatchState);
      this.room = room;
      this.statusText.setVisible(false);

      const callbacks = Callbacks.get(room);
      callbacks.onAdd("agents", (agent, sessionId) => {
        this.addUnit(agent, sessionId);
      });
      callbacks.onRemove("agents", (_agent, sessionId) => {
        this.killUnit(sessionId);
      });

      room.onLeave(() => {
        this.statusText.setText("disconnected").setVisible(true);
      });
    } catch (err) {
      this.statusText.setText(
        `connection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private addUnit(agent: AgentState, sessionId: string): void {
    const key = warriorAnimKey(agent.color, agent.anim);
    const sprite = this.add.sprite(agent.x, agent.y, key).play(key);

    const hpBg = this.add
      .rectangle(agent.x, agent.y - HP_BAR_OFFSET, HP_BAR_W + 2, HP_BAR_H + 2, 0x000000, 0.55)
      .setDepth(UI_DEPTH);
    const hpFill = this.add
      .rectangle(agent.x - HP_BAR_W / 2, agent.y - HP_BAR_OFFSET, HP_BAR_W, HP_BAR_H, 0x4caf50)
      .setOrigin(0, 0.5)
      .setDepth(UI_DEPTH);

    this.units.set(sessionId, { sprite, hpBg, hpFill });
  }

  /** A unit died (removed from state): explode at its spot, then clean up. */
  private killUnit(sessionId: string): void {
    const view = this.units.get(sessionId);
    if (!view) return;

    const boom = this.add
      .sprite(view.sprite.x, view.sprite.y, EXPLOSION_SHEET.key)
      .setDepth(view.sprite.y + 5000)
      .play(EXPLOSION_ANIM);
    boom.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => boom.destroy());

    view.sprite.destroy();
    view.hpBg.destroy();
    view.hpFill.destroy();
    this.units.delete(sessionId);
  }

  override update(_time: number, deltaMs: number): void {
    const room = this.room;
    if (!room) return;

    // Render-side interpolation (SPEC.md §3.2): every frame, close a fixed
    // fraction of the gap to the latest server position instead of snapping,
    // so 20 Hz state updates draw as smooth 60 fps motion.
    const alpha = 1 - Math.exp(-deltaMs / LERP_TAU_MS);

    room.state.agents.forEach((agent, sessionId) => {
      const view = this.units.get(sessionId);
      if (!view) return;
      const { sprite, hpBg, hpFill } = view;

      sprite.x += (agent.x - sprite.x) * alpha;
      sprite.y += (agent.y - sprite.y) * alpha;
      sprite.setFlipX(agent.dir === "left");
      sprite.setDepth(sprite.y);

      const animKey = warriorAnimKey(agent.color, agent.anim);
      if (sprite.anims.currentAnim?.key !== animKey) sprite.play(animKey);

      const barY = sprite.y - HP_BAR_OFFSET;
      hpBg.setPosition(sprite.x, barY);
      hpFill.setPosition(sprite.x - HP_BAR_W / 2, barY);
      const frac = Phaser.Math.Clamp(agent.hp / WARRIOR_MAX_HP, 0, 1);
      hpFill.scaleX = frac;
      hpFill.setFillStyle(hpColor(frac));
    });
  }
}

function hpColor(frac: number): number {
  if (frac > 0.5) return 0x4caf50; // green
  if (frac > 0.25) return 0xffb300; // amber
  return 0xe53935; // red
}
