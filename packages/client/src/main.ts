import Phaser from "phaser";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@aub/shared";
import { BootScene } from "./scenes/BootScene";
import { GameScene } from "./scenes/GameScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  // Canvas = world size while the world is one screen (Phase 1); a camera
  // over a larger tilemap replaces this coupling later.
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
  backgroundColor: "#1d2b34",
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, GameScene],
};

const game = new Phaser.Game(config);

// Dev-only debug handle for automated/manual inspection in the browser
// console. Stripped from production builds (import.meta.env.DEV is false there).
if (import.meta.env.DEV) {
  (window as unknown as { game: Phaser.Game }).game = game;
}
