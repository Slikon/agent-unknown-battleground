/**
 * Death FX config (SPEC.md §7: the Tiny Swords pack has no death sprite, so a
 * one-shot Explosion_01 + fade stands in for it). One declarative config, no
 * magic numbers in rendering code (SPEC.md §9 rule 8).
 *
 * Frame size verified against the PNG: Explosion_01.png is 1536×192 = 8 frames
 * of 192×192.
 */
export const EXPLOSION_SHEET = {
  key: "explosion",
  url: "/assets/Particle FX/Explosion_01.png",
  frameWidth: 192,
  frameHeight: 192,
  frames: 8,
  frameRate: 16,
} as const;

/** Phaser animation key for the one-shot explosion. */
export const EXPLOSION_ANIM = "explosion-fx";
