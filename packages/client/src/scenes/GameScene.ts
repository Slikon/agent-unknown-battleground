import Phaser from "phaser";
import { Callbacks, Client, type Room } from "@colyseus/sdk";
import { type AgentState, MSG_MOVE, MatchState } from "@aub/shared";
import { warriorAnimKey } from "../assets/warrior";

/**
 * Time constant (ms) of the exponential lerp that chases server positions.
 * Small enough that a unit trails its 20 Hz server position by only a few
 * frames; large enough that discrete ticks render as smooth motion.
 */
const LERP_TAU_MS = 80;

/**
 * The match view. Deliberately thin (SPEC.md §9 rule 1): it renders whatever
 * the server's state sync says and sends a move order on click — no movement
 * logic, no prediction, no game rules on the client.
 */
export class GameScene extends Phaser.Scene {
  private room?: Room<MatchState>;
  private sprites = new Map<string, Phaser.GameObjects.Sprite>();
  private statusText!: Phaser.GameObjects.Text;

  constructor() {
    super("GameScene");
  }

  create(): void {
    const { width, height } = this.scale;
    this.statusText = this.add
      .text(width / 2, height / 2, "connecting…", {
        fontFamily: "monospace",
        fontSize: "24px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setDepth(10_000);

    this.input.on(
      Phaser.Input.Events.POINTER_DOWN,
      (pointer: Phaser.Input.Pointer) => {
        this.room?.send(MSG_MOVE, { x: pointer.worldX, y: pointer.worldY });
      },
    );

    void this.connect();
  }

  private async connect(): Promise<void> {
    // Same hostname the page was served from, so a LAN client that opened
    // http://192.168.x.x:5173 reaches the server on that machine (SPEC.md §10).
    const endpoint = `ws://${window.location.hostname}:2567`;

    try {
      const room = await new Client(endpoint).joinOrCreate(
        "match",
        {},
        MatchState,
      );
      this.room = room;
      this.statusText.setVisible(false);

      const callbacks = Callbacks.get(room);
      callbacks.onAdd("agents", (agent, sessionId) => {
        this.addAgent(agent, sessionId);
      });
      callbacks.onRemove("agents", (_agent, sessionId) => {
        this.sprites.get(sessionId)?.destroy();
        this.sprites.delete(sessionId);
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

  private addAgent(agent: AgentState, sessionId: string): void {
    const sprite = this.add.sprite(agent.x, agent.y, warriorAnimKey(agent.color, agent.anim));
    sprite.play(warriorAnimKey(agent.color, agent.anim));
    this.sprites.set(sessionId, sprite);
  }

  override update(_time: number, deltaMs: number): void {
    const room = this.room;
    if (!room) return;

    // Render-side interpolation (SPEC.md §3.2): every frame, close a fixed
    // fraction of the gap to the latest server position instead of snapping,
    // so 20 Hz state updates draw as smooth 60 fps motion.
    const alpha = 1 - Math.exp(-deltaMs / LERP_TAU_MS);

    room.state.agents.forEach((agent, sessionId) => {
      const sprite = this.sprites.get(sessionId);
      if (!sprite) return;

      sprite.x += (agent.x - sprite.x) * alpha;
      sprite.y += (agent.y - sprite.y) * alpha;
      sprite.setFlipX(agent.dir === "left");
      sprite.setDepth(sprite.y);

      const animKey = warriorAnimKey(agent.color, agent.anim);
      if (sprite.anims.currentAnim?.key !== animKey) {
        sprite.play(animKey);
      }
    });
  }
}
