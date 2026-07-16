/**
 * Declarative configs for the island's terrain art (SPEC.md §7 asset mapping,
 * §9 rule 8: one sprite = one config, no magic numbers in scene code). The
 * geography itself (what is land/water, where obstacles and landmarks sit) lives
 * in `@aub/shared`'s map.ts; this file only says which PNG draws each thing.
 */

/**
 * The Tiny Swords grass autotile sheet. We don't commit any derived art (the
 * pack is gitignored), so at boot we crop one solid interior grass tile out of
 * this sheet into a standalone 64×64 texture that tiles seamlessly across the
 * island. `grassTile` is the source rect of that clean interior tile
 * (col 1/row 1 of the 9×6, 64-px sheet). See BootScene for the crop.
 */
export const TILESET = {
  key: "tileset-src",
  url: "/assets/Terrain/Tileset/Tilemap_color1.png",
  grassTile: { x: 64, y: 64, size: 64 },
} as const;

/** Key of the standalone grass texture cropped from TILESET at boot. */
export const GRASS_TEXTURE = "grass";

/** Solid water tile, repeated over the whole world as the sea. */
export const WATER = {
  key: "water",
  url: "/assets/Terrain/Tileset/Water Background color.png",
} as const;

/**
 * Trees (impassable) — animated sway strips; frame 0 is a static tree. Four
 * variants; an obstacle's `variant` from map.ts picks which one it draws.
 * Tree1/2 are 256-px frames, Tree3/4 are 192-px.
 */
export const TREES = [1, 2, 3, 4].map((n) => ({
  key: `tree-${n}`,
  url: `/assets/Terrain/Resources/Wood/Trees/Tree${n}.png`,
  frameWidth: n <= 2 ? 256 : 192,
  frameHeight: n <= 2 ? 256 : 192,
}));

/** Rock boulders (impassable), four variants. */
export const ROCKS = [1, 2, 3, 4].map((n) => ({
  key: `rock-${n}`,
  url: `/assets/Terrain/Decorations/Rocks/Rock${n}.png`,
}));

/** Gold stones (impassable) — mark the gold mine. Four variants. */
export const GOLDS = [1, 2, 3, 4].map((n) => ({
  key: `gold-${n}`,
  url: `/assets/Terrain/Resources/Gold/Gold Stones/Gold Stone ${n}.png`,
}));

/** Bushes — walkable, render-only grass decor. Frame 0 of a 128-px strip. */
export const BUSHES = [1, 2, 3, 4].map((n) => ({
  key: `bush-${n}`,
  url: `/assets/Terrain/Decorations/Bushes/Bushe${n}.png`,
  frameWidth: 128,
  frameHeight: 128,
}));

/**
 * Animated water foam patch, looped under the island's coast (and masked into
 * the lake rim) to give the landmass a live shoreline. The strip's splashes
 * are centered on the 192-px frame *boundaries* (a naive spritesheet cut
 * yields two half-splashes per frame), so BootScene cuts custom frames offset
 * by half a frame — 15 whole splashes.
 */
export const FOAM = {
  key: "foam",
  url: "/assets/Terrain/Tileset/Water Foam.png",
  frameWidth: 192,
  frameHeight: 192,
  frameOffsetX: 96,
  frames: 15,
  frameRate: 10,
  anim: "foam-loop",
} as const;

/** Bobbing rock clusters decorating the sea/lake. 16-frame idle loops. */
export const WATER_ROCKS = [1, 2, 3, 4].map((n) => ({
  key: `water-rock-${n}`,
  url: `/assets/Terrain/Decorations/Rocks in the Water/Water Rocks_0${n}.png`,
  frameWidth: 64,
  frameHeight: 64,
  frames: 16,
  frameRate: 6,
  anim: `water-rock-loop-${n}`,
}));

/** Castle building — cover at the castle landmark. */
export const CASTLE = {
  key: "castle",
  url: "/assets/Buildings/Blue Buildings/Castle.png",
} as const;
