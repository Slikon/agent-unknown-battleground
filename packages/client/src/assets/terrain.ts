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

/** Tree (impassable) — an animated sway strip; frame 0 is a static tree. */
export const TREE = {
  key: "tree",
  url: "/assets/Terrain/Resources/Wood/Trees/Tree1.png",
  frameWidth: 256,
  frameHeight: 256,
} as const;

/** Rock boulder (impassable). */
export const ROCK = {
  key: "rock",
  url: "/assets/Terrain/Decorations/Rocks/Rock3.png",
} as const;

/** Gold stone (impassable) — marks the gold mine. */
export const GOLD = {
  key: "gold",
  url: "/assets/Terrain/Resources/Gold/Gold Stones/Gold Stone 3.png",
} as const;

/** Castle building — cover at the castle landmark. */
export const CASTLE = {
  key: "castle",
  url: "/assets/Buildings/Blue Buildings/Castle.png",
} as const;
