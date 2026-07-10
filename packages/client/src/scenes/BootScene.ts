import Phaser from "phaser";

/**
 * Phase 0 placeholder scene. It exists only to prove the Phaser + Vite
 * pipeline renders. Asset loading, the tilemap, and the walking warrior
 * (Phase 0's "done" criterion in SPEC.md §8) are built out in this scene
 * next — for now it just shows the title so the toolchain is verifiable.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  create(): void {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, height / 2, "AUB — Phase 0", {
        fontFamily: "monospace",
        fontSize: "36px",
        color: "#ffffff",
      })
      .setOrigin(0.5);
  }
}
