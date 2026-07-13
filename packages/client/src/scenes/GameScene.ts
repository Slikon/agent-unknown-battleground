import Phaser from "phaser";
import { Callbacks, Client, type Room } from "@colyseus/sdk";
import {
  type AgentState,
  BUSH_TILES,
  ISLAND_CENTER,
  ISLAND_RADIUS,
  LAKE,
  LANDMARK_COORDS,
  MatchState,
  OBSTACLE_TILES,
  TILE_SIZE,
  WARRIOR_MAX_HP,
  WATER_ROCK_TILES,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  tileCenterPx,
} from "@aub/shared";
import { warriorAnimKey } from "../assets/warrior";
import { EXPLOSION_ANIM, EXPLOSION_SHEET } from "../assets/explosion";
import {
  BUSHES,
  CASTLE,
  FOAM,
  GOLDS,
  GRASS_TEXTURE,
  ROCKS,
  TREES,
  WATER,
  WATER_ROCKS,
} from "../assets/terrain";
import { SMALLBAR_BASE, SMALLBAR_FILL } from "../assets/ui";
import { MatchOverlay } from "../ui/MatchOverlay";

/**
 * Time constant (ms) of the exponential lerp that chases server positions.
 * Small enough that a unit trails its 20 Hz server position by only a few
 * frames; large enough that discrete ticks render as smooth motion.
 */
const LERP_TAU_MS = 80;

// HP bar geometry, in world px (the whole world is scaled to fit the browser).
const HP_BAR_W = 46;
const HP_BAR_H = 12;
const HP_FILL_W = 40;
const HP_FILL_H = 6;
const HP_BAR_OFFSET = 36; // px above the sprite's center

const BAR_DEPTH = 900_000; // HP bars above all units
const FOG_DEPTH = -500; // zone darkening: above ground, below units
const RING_DEPTH = 2_000_000; // zone boundary: above everything

interface UnitView {
  sprite: Phaser.GameObjects.Sprite;
  barBase: Phaser.GameObjects.Image;
  barFill: Phaser.GameObjects.Image;
}

/**
 * The match view. Deliberately thin (SPEC.md §9 rule 1): it renders whatever the
 * server's state sync says — the island, units, HP, the shrinking zone, death
 * explosions — and nothing more. No movement, combat, pathfinding or match logic
 * runs here; agents are driven entirely by the server's behavior executor.
 *
 * The whole 1920×1920 world is scaled to fit the window (Phaser Scale.FIT), so a
 * spectator sees the entire island at once — ideal for watching a bot match play
 * out. The mini-UI (player count, zone timer, countdown, winner) is a crisp HTML
 * overlay (`MatchOverlay`) on top of the scaled canvas, per SPEC.md §3.2.
 */
export class GameScene extends Phaser.Scene {
  private room?: Room<MatchState>;
  private units = new Map<string, UnitView>();
  private overlay!: MatchOverlay;

  // Zone rendering.
  private zoneFog!: Phaser.GameObjects.Rectangle;
  private zoneMaskShape!: Phaser.GameObjects.Graphics;
  private zoneRing!: Phaser.GameObjects.Graphics;

  constructor() {
    super("GameScene");
  }

  create(): void {
    this.buildIsland();
    this.buildZoneLayers();

    this.overlay = new MatchOverlay();
    this.overlay.setStatus("connecting…");

    void this.connect();

    // Tear the DOM overlay down if the scene ever restarts.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.overlay.destroy());
  }

  // ── Static island ────────────────────────────────────────────────────────────

  private buildIsland(): void {
    // Sea across the whole world.
    this.add.tileSprite(0, 0, WORLD_WIDTH, WORLD_HEIGHT, WATER.key).setOrigin(0).setDepth(-1000);

    // Animated foam lapping at the coast, half-hidden under the beach rim.
    // Per-sprite size/radius/rotation wobble keeps the ring from reading as a
    // regular dashed border.
    const foamStep = 1.75 * TILE_SIZE;
    const foamCount = Math.ceil((2 * Math.PI * ISLAND_RADIUS) / foamStep);
    for (let i = 0; i < foamCount; i++) {
      const a = (i / foamCount) * Math.PI * 2;
      const h = (((i + 1) * 2654435761) >>> 0) / 4294967296; // cheap per-index hash
      const size = (2.7 + 0.9 * h) * TILE_SIZE;
      // Center the splash body inside the coast so the beach rim hides it and
      // only the animated foam edge laps beyond the shoreline.
      const r = ISLAND_RADIUS - 20 + (h - 0.5) * 16;
      this.add
        .sprite(ISLAND_CENTER.x + Math.cos(a) * r, ISLAND_CENTER.y + Math.sin(a) * r, FOAM.key)
        .setDisplaySize(size, size)
        .setRotation((Math.floor(h * 4) * Math.PI) / 2)
        .setDepth(-960)
        .play({ key: FOAM.anim, startFrame: i % FOAM.frames });
    }

    // Sandy beach rim just under the grass.
    this.add.circle(ISLAND_CENTER.x, ISLAND_CENTER.y, ISLAND_RADIUS + 7, 0xd8c48f).setDepth(-950);

    // Grass landmass — a tiled texture masked to the island circle.
    const grass = this.add
      .tileSprite(0, 0, WORLD_WIDTH, WORLD_HEIGHT, GRASS_TEXTURE)
      .setOrigin(0)
      .setDepth(-900);
    const islandMask = this.make.graphics({}, false);
    islandMask.fillStyle(0xffffff);
    islandMask.fillCircle(ISLAND_CENTER.x, ISLAND_CENTER.y, ISLAND_RADIUS);
    grass.setMask(islandMask.createGeometryMask());

    // The lake (a water pool on the grass), with its own foam ring clipped to
    // the lake circle so no foam spills onto the grass.
    this.add.circle(LAKE.x, LAKE.y, LAKE.radius, 0x3f7a9c).setDepth(-850);
    this.add.circle(LAKE.x, LAKE.y, LAKE.radius - 6, 0x5aa0c4).setDepth(-849);
    const lakeMaskShape = this.make.graphics({}, false);
    lakeMaskShape.fillStyle(0xffffff);
    lakeMaskShape.fillCircle(LAKE.x, LAKE.y, LAKE.radius - 2);
    const lakeMask = lakeMaskShape.createGeometryMask();
    const lakeFoamCount = Math.ceil((2 * Math.PI * LAKE.radius) / foamStep);
    for (let i = 0; i < lakeFoamCount; i++) {
      const a = (i / lakeFoamCount) * Math.PI * 2;
      const h = (((i + 7) * 2654435761) >>> 0) / 4294967296;
      const size = (2.2 + 0.8 * h) * TILE_SIZE;
      // Center the splash just outside the lake so only its inner edge shows
      // through the mask as a thin shore ring.
      const lr = LAKE.radius + 10;
      this.add
        .sprite(LAKE.x + Math.cos(a) * lr, LAKE.y + Math.sin(a) * lr, FOAM.key)
        .setDisplaySize(size, size)
        .setRotation((Math.floor(h * 4) * Math.PI) / 2)
        .setDepth(-848)
        .setMask(lakeMask)
        .play({ key: FOAM.anim, startFrame: (i * 3) % FOAM.frames });
    }

    // Bobbing rock clusters out at sea / in the lake.
    for (const d of WATER_ROCK_TILES) {
      const { x, y } = tileCenterPx(d.col, d.row);
      const wr = WATER_ROCKS[d.variant];
      this.add
        .sprite(x + d.jitterX, y + d.jitterY, wr.key)
        .setDisplaySize(1.6 * TILE_SIZE * d.sizeMul, 1.6 * TILE_SIZE * d.sizeMul)
        .setDepth(-940)
        .play({ key: wr.anim, startFrame: (d.col + d.row) % wr.frames });
    }

    // Landmark cover: the castle building.
    const castle = LANDMARK_COORDS.castle;
    this.add
      .image(castle.x, castle.y, CASTLE.key)
      .setDisplaySize(3.6 * TILE_SIZE, 3.6 * TILE_SIZE * (256 / 320))
      .setOrigin(0.5, 0.78)
      .setDepth(castle.y);

    // Bushes — walkable decor scattered over open grass.
    for (const d of BUSH_TILES) {
      const { x, y } = tileCenterPx(d.col, d.row);
      this.add
        .sprite(x + d.jitterX, y + d.jitterY, BUSHES[d.variant].key, 0)
        .setDisplaySize(1.6 * TILE_SIZE * d.sizeMul, 1.6 * TILE_SIZE * d.sizeMul)
        .setOrigin(0.5, 0.65)
        .setDepth(y);
    }

    // Obstacle decorations (impassable) — trees, rocks, gold stones. Variant,
    // jitter and size come from map.ts so the look is deterministic.
    for (const o of OBSTACLE_TILES) {
      const { x, y } = tileCenterPx(o.col, o.row);
      const px = x + o.jitterX;
      const py = y + o.jitterY;
      if (o.kind === "tree") {
        this.add
          .sprite(px, py, TREES[o.variant].key, 0)
          .setDisplaySize(2.4 * TILE_SIZE * o.sizeMul, 2.4 * TILE_SIZE * o.sizeMul)
          .setOrigin(0.5, 0.72)
          .setDepth(py);
      } else if (o.kind === "rock") {
        this.add
          .image(px, py, ROCKS[o.variant].key)
          .setDisplaySize(1.4 * TILE_SIZE * o.sizeMul, 1.4 * TILE_SIZE * o.sizeMul)
          .setOrigin(0.5, 0.6)
          .setDepth(py);
      } else {
        this.add
          .image(px, py, GOLDS[o.variant].key)
          .setDisplaySize(1.7 * TILE_SIZE * o.sizeMul, 1.7 * TILE_SIZE * o.sizeMul)
          .setOrigin(0.5, 0.6)
          .setDepth(py);
      }
    }
  }

  private buildZoneLayers(): void {
    // Darken everything outside the safe circle (inverted geometry mask).
    this.zoneFog = this.add
      .rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0x0a0e24, 0.5)
      .setOrigin(0)
      .setDepth(FOG_DEPTH);
    this.zoneMaskShape = this.make.graphics({}, false);
    const fogMask = this.zoneMaskShape.createGeometryMask();
    fogMask.invertAlpha = true; // show the fog OUTSIDE the drawn circle
    this.zoneFog.setMask(fogMask);

    this.zoneRing = this.add.graphics().setDepth(RING_DEPTH);
  }

  // ── Networking ───────────────────────────────────────────────────────────────

  private async connect(): Promise<void> {
    // Same hostname the page was served from, so a LAN client that opened
    // http://192.168.x.x:5173 reaches the server on that machine (SPEC.md §10).
    const endpoint = `ws://${window.location.hostname}:2567`;

    try {
      const room = await new Client(endpoint).joinOrCreate("match", {}, MatchState);
      this.room = room;
      this.overlay.setStatus(null);

      const callbacks = Callbacks.get(room);
      callbacks.onAdd("agents", (agent, sessionId) => this.addUnit(agent, sessionId));
      callbacks.onRemove("agents", (_agent, sessionId) => this.killUnit(sessionId));

      room.onLeave(() => this.overlay.setStatus("disconnected"));
    } catch (err) {
      this.overlay.setStatus(
        `connection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private addUnit(agent: AgentState, sessionId: string): void {
    const key = warriorAnimKey(agent.color, agent.anim);
    const sprite = this.add.sprite(agent.x, agent.y, key).play(key);

    const barBase = this.add
      .image(agent.x, agent.y - HP_BAR_OFFSET, SMALLBAR_BASE.key, SMALLBAR_BASE.frame)
      .setDisplaySize(HP_BAR_W, HP_BAR_H)
      .setDepth(BAR_DEPTH);
    const barFill = this.add
      .image(
        agent.x - HP_FILL_W / 2,
        agent.y - HP_BAR_OFFSET,
        SMALLBAR_FILL.key,
        SMALLBAR_FILL.frame,
      )
      .setOrigin(0, 0.5)
      .setDepth(BAR_DEPTH + 1);

    this.units.set(sessionId, { sprite, barBase, barFill });
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
    view.barBase.destroy();
    view.barFill.destroy();
    this.units.delete(sessionId);
  }

  // ── Per-frame render ─────────────────────────────────────────────────────────

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
      const { sprite, barBase, barFill } = view;

      sprite.x += (agent.x - sprite.x) * alpha;
      sprite.y += (agent.y - sprite.y) * alpha;
      sprite.setFlipX(agent.dir === "left");
      sprite.setDepth(sprite.y);

      const animKey = warriorAnimKey(agent.color, agent.anim);
      if (sprite.anims.currentAnim?.key !== animKey) sprite.play(animKey);

      const barY = sprite.y - HP_BAR_OFFSET;
      barBase.setPosition(sprite.x, barY);
      barFill.setPosition(sprite.x - HP_FILL_W / 2, barY);
      const frac = Phaser.Math.Clamp(agent.hp / WARRIOR_MAX_HP, 0, 1);
      barFill.setDisplaySize(Math.max(0.001, HP_FILL_W * frac), HP_FILL_H);
      barFill.setTintFill(hpColor(frac));
      barFill.setVisible(frac > 0);
    });

    this.renderZone();
    this.overlay.update(room.state);
  }

  private renderZone(): void {
    const room = this.room;
    if (!room) return;
    const zone = room.state.zone;
    const r = Math.max(0, zone.radius);

    this.zoneMaskShape.clear();
    this.zoneMaskShape.fillStyle(0xffffff);
    this.zoneMaskShape.fillCircle(zone.x, zone.y, r);

    this.zoneRing.clear();
    this.zoneRing.lineStyle(4, zone.shrinking ? 0xff5252 : 0x66e0ff, 0.9);
    this.zoneRing.strokeCircle(zone.x, zone.y, r);
  }
}

function hpColor(frac: number): number {
  if (frac > 0.5) return 0x4caf50; // green
  if (frac > 0.25) return 0xffb300; // amber
  return 0xe53935; // red
}
