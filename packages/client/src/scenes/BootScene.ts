import Phaser from "phaser";
import { AGENT_COLORS } from "@aub/shared";
import {
  WARRIOR_ANIMS,
  WARRIOR_SHEET,
  warriorAnimKey,
  warriorSheetUrl,
} from "../assets/warrior";
import { EXPLOSION_ANIM, EXPLOSION_SHEET } from "../assets/explosion";
import {
  BUSHES,
  CASTLE,
  FOAM,
  GOLDS,
  GRASS_TEXTURE,
  ROCKS,
  TILESET,
  TREES,
  WATER,
  WATER_ROCKS,
} from "../assets/terrain";
import { SMALLBAR_BASE, SMALLBAR_FILL } from "../assets/ui";

/**
 * Loads every faction's warrior strips, the death explosion, the island terrain
 * art and the HP-bar sprites, registers all animations and derived textures,
 * then hands off to GameScene (SPEC.md §3.2 — Lobby/Result scenes come later).
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload(): void {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, "loading…", {
        fontFamily: "monospace",
        fontSize: "48px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    for (const color of AGENT_COLORS) {
      for (const anim of WARRIOR_ANIMS) {
        const { file } = WARRIOR_SHEET.animations[anim];
        this.load.spritesheet(warriorAnimKey(color, anim), warriorSheetUrl(color, file), {
          frameWidth: WARRIOR_SHEET.frameWidth,
          frameHeight: WARRIOR_SHEET.frameHeight,
        });
      }
    }

    this.load.spritesheet(EXPLOSION_SHEET.key, EXPLOSION_SHEET.url, {
      frameWidth: EXPLOSION_SHEET.frameWidth,
      frameHeight: EXPLOSION_SHEET.frameHeight,
    });

    // Terrain.
    this.load.image(TILESET.key, TILESET.url);
    this.load.image(WATER.key, WATER.url);
    for (const tree of TREES) {
      this.load.spritesheet(tree.key, tree.url, {
        frameWidth: tree.frameWidth,
        frameHeight: tree.frameHeight,
      });
    }
    for (const rock of ROCKS) this.load.image(rock.key, rock.url);
    for (const gold of GOLDS) this.load.image(gold.key, gold.url);
    for (const bush of BUSHES) {
      this.load.spritesheet(bush.key, bush.url, {
        frameWidth: bush.frameWidth,
        frameHeight: bush.frameHeight,
      });
    }
    // Foam frames are cut by hand in create() (offset grid) — load whole image.
    this.load.image(FOAM.key, FOAM.url);
    for (const wr of WATER_ROCKS) {
      this.load.spritesheet(wr.key, wr.url, {
        frameWidth: wr.frameWidth,
        frameHeight: wr.frameHeight,
      });
    }
    this.load.image(CASTLE.key, CASTLE.url);

    // HP bars.
    this.load.image(SMALLBAR_BASE.key, SMALLBAR_BASE.url);
    this.load.image(SMALLBAR_FILL.key, SMALLBAR_FILL.url);
  }

  create(): void {
    for (const color of AGENT_COLORS) {
      for (const anim of WARRIOR_ANIMS) {
        const key = warriorAnimKey(color, anim);
        const { frames, frameRate, repeat } = WARRIOR_SHEET.animations[anim];
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(key, { start: 0, end: frames - 1 }),
          frameRate,
          repeat,
        });
      }
    }

    this.anims.create({
      key: EXPLOSION_ANIM,
      frames: this.anims.generateFrameNumbers(EXPLOSION_SHEET.key, {
        start: 0,
        end: EXPLOSION_SHEET.frames - 1,
      }),
      frameRate: EXPLOSION_SHEET.frameRate,
      repeat: 0,
    });

    // Cut the foam's frames on the half-frame-offset grid (see FOAM docs).
    const foamTex = this.textures.get(FOAM.key);
    const foamFrames: { key: string; frame: string }[] = [];
    for (let i = 0; i < FOAM.frames; i++) {
      const name = `splash-${i}`;
      foamTex.add(
        name,
        0,
        FOAM.frameOffsetX + i * FOAM.frameWidth,
        0,
        FOAM.frameWidth,
        FOAM.frameHeight,
      );
      foamFrames.push({ key: FOAM.key, frame: name });
    }
    this.anims.create({
      key: FOAM.anim,
      frames: foamFrames,
      frameRate: FOAM.frameRate,
      repeat: -1,
    });
    for (const wr of WATER_ROCKS) {
      this.anims.create({
        key: wr.anim,
        frames: this.anims.generateFrameNumbers(wr.key, { start: 0, end: wr.frames - 1 }),
        frameRate: wr.frameRate,
        repeat: -1,
      });
    }

    // Crop one solid grass tile out of the autotile sheet into its own 64×64
    // texture so it tiles seamlessly across the island. A plain Canvas drawImage
    // is used (not a sheet sub-frame, which bleeds when tiled).
    const { x, y, size } = TILESET.grassTile;
    const src = this.textures.get(TILESET.key).getSourceImage() as CanvasImageSource;
    const grass = this.textures.createCanvas(GRASS_TEXTURE, size, size);
    grass?.context.drawImage(src, x, y, size, size, 0, 0, size, size);
    grass?.refresh();

    // Tight sub-frames over just the drawable art of each HP-bar sprite.
    this.textures
      .get(SMALLBAR_BASE.key)
      .add(
        SMALLBAR_BASE.frame,
        0,
        SMALLBAR_BASE.cut.x,
        SMALLBAR_BASE.cut.y,
        SMALLBAR_BASE.cut.width,
        SMALLBAR_BASE.cut.height,
      );
    this.textures
      .get(SMALLBAR_FILL.key)
      .add(
        SMALLBAR_FILL.frame,
        0,
        SMALLBAR_FILL.cut.x,
        SMALLBAR_FILL.cut.y,
        SMALLBAR_FILL.cut.width,
        SMALLBAR_FILL.cut.height,
      );

    this.scene.start("GameScene");
  }
}
