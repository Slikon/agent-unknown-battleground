import type { AgentAnim, AgentColor } from "@aub/shared";

/**
 * Declarative atlas config for the Tiny Swords Warrior — one sprite, one
 * config, no magic numbers in rendering code (SPEC.md §9 rule 8).
 *
 * Frame size verified against the real PNGs: horizontal strips of 192×192
 * frames (Warrior_Idle.png is 1536×192 = 8 frames, Warrior_Run.png is
 * 1152×192 = 6 frames; identical across all five color factions).
 */
export const WARRIOR_SHEET = {
  frameWidth: 192,
  frameHeight: 192,
  animations: {
    idle: { file: "Warrior_Idle.png", frames: 8, frameRate: 8, repeat: -1 },
    run: { file: "Warrior_Run.png", frames: 6, frameRate: 10, repeat: -1 },
  },
} as const satisfies {
  frameWidth: number;
  frameHeight: number;
  animations: Record<
    AgentAnim,
    { file: string; frames: number; frameRate: number; repeat: number }
  >;
};

/** Animation names in WARRIOR_SHEET, typed for iteration. */
export const WARRIOR_ANIMS = ["idle", "run"] as const satisfies readonly AgentAnim[];

/** URL of a color faction's strip, under Vite's public/ web root. */
export function warriorSheetUrl(color: AgentColor, file: string): string {
  const faction = color.charAt(0).toUpperCase() + color.slice(1);
  return `/assets/Units/${faction} Units/Warrior/${file}`;
}

/** Phaser texture + animation key for one (color, animation) pair. */
export function warriorAnimKey(color: AgentColor, anim: AgentAnim): string {
  return `warrior-${color}-${anim}`;
}
