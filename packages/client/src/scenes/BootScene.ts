import Phaser from "phaser";
import { AGENT_COLORS } from "@aub/shared";
import {
  WARRIOR_ANIMS,
  WARRIOR_SHEET,
  warriorAnimKey,
  warriorSheetUrl,
} from "../assets/warrior";
import { EXPLOSION_ANIM, EXPLOSION_SHEET } from "../assets/explosion";

/**
 * Loads every faction's warrior strips plus the death explosion, registers all
 * animations, then hands off to GameScene (SPEC.md §3.2 — Lobby/Result scenes
 * come later).
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
        fontSize: "24px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    for (const color of AGENT_COLORS) {
      for (const anim of WARRIOR_ANIMS) {
        const { file } = WARRIOR_SHEET.animations[anim];
        this.load.spritesheet(
          warriorAnimKey(color, anim),
          warriorSheetUrl(color, file),
          {
            frameWidth: WARRIOR_SHEET.frameWidth,
            frameHeight: WARRIOR_SHEET.frameHeight,
          },
        );
      }
    }

    this.load.spritesheet(EXPLOSION_SHEET.key, EXPLOSION_SHEET.url, {
      frameWidth: EXPLOSION_SHEET.frameWidth,
      frameHeight: EXPLOSION_SHEET.frameHeight,
    });
  }

  create(): void {
    for (const color of AGENT_COLORS) {
      for (const anim of WARRIOR_ANIMS) {
        const key = warriorAnimKey(color, anim);
        const { frames, frameRate, repeat } = WARRIOR_SHEET.animations[anim];
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(key, {
            start: 0,
            end: frames - 1,
          }),
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

    this.scene.start("GameScene");
  }
}
