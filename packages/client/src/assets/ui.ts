/**
 * HP bar sprites — the Tiny Swords SmallBar from SPEC.md §7 (this replaces the
 * plain Graphics rectangles used through Phase 2).
 *
 * The source PNGs carry a lot of transparent padding and the base is a 3-piece
 * framed bar, so we register a tight sub-frame over just the drawable art on
 * each (measured from the pixels): the base's bar occupies x∈[49,270], y∈[22,40];
 * the fill's red band is the full width at y∈[30,32]. Rendering from those
 * frames lets `setDisplaySize` scale the bar cleanly, and the fill's colour is
 * driven by `setTintFill` per health. See BootScene for where the frames are cut.
 */
export const SMALLBAR_BASE = {
  key: "smallbar-base",
  url: "/assets/UI Elements/UI Elements/Bars/SmallBar_Base.png",
  frame: "bar",
  cut: { x: 49, y: 22, width: 222, height: 19 },
} as const;

export const SMALLBAR_FILL = {
  key: "smallbar-fill",
  url: "/assets/UI Elements/UI Elements/Bars/SmallBar_Fill.png",
  frame: "bar",
  cut: { x: 0, y: 30, width: 64, height: 3 },
} as const;
