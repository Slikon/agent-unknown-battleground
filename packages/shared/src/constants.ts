/**
 * Named zones on the map (defined in Tiled as objects in later phases).
 * They give the LLM a fixed vocabulary of places and let the player speak
 * naturally ("hold by the lake"). See SPEC.md §4.
 */
export const LANDMARK_NAMES = [
  "castle",
  "forest_north",
  "forest_south",
  "lake",
  "gold_mine",
  "center",
] as const;

export type LandmarkName = (typeof LANDMARK_NAMES)[number];
