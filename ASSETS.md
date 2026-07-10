# Assets — Tiny Swords pack

The game art (Tiny Swords by **Pixel Frog**) is **not committed to this repo**
(see `.gitignore`). Each developer drops their own copy in locally. Nothing in
Phase 0 loads these files yet — the placeholder scene just shows a title — but
put them in place now so later phases can reference them without churn.

## Where to get it

Tiny Swords — https://pixelfrog-assets.itch.io/tiny-swords (free, "Name your
own price"). Download the latest pack and unzip it.

## Where to drop it

Everything goes under:

```
packages/client/public/assets/
```

Anything in a Vite `public/` folder is served from the web root as-is, so a file
at `packages/client/public/assets/Terrain/Ground/Tilemap_color.png` is reachable
in the client at `/assets/Terrain/Ground/Tilemap_color.png`.

Keep the pack's original folder structure. The result should look roughly like:

```
packages/client/public/assets/
├── Terrain/
│   └── Tileset/            Tilemap_color*.png, Water Background color.png, Water Foam.png
├── Decorations/           Rocks, Bushes, Trees
├── Buildings/             <Color>/Tower.png, House*.png
├── Factions/  (or Units/) <Color> Units/Warrior/Warrior_Idle.png, Warrior_Run.png, Warrior_Attack1.png
│                          <Color> Units/Archer/Archer_Idle.png, Archer_Run.png, Archer_Shoot.png, Arrow.png
├── Particle FX/           Explosion_01.png   (used for death — the pack has no death sprite)
└── UI Elements/           Bars/SmallBar_*.png, Buttons/BigBlueButton_*.png, Human Avatars/, Cursors/
```

> Folder names differ slightly between Tiny Swords releases (e.g. `Factions/`
> vs `Units/`). Don't rename anything — instead, point the atlas configs at the
> real paths when we wire up asset loading. The exact element → file mapping we
> target lives in **SPEC.md §7**.

## Before slicing spritesheets

Tiny Swords spritesheets are horizontal strips of equal-width frames (commonly
**192×192 px per frame**, but this varies by unit and by pack version).
**Verify the real frame size against the actual PNG** before configuring
`this.load.spritesheet(key, path, { frameWidth, frameHeight })` — guessing wrong
shears every animation frame.

Per SPEC.md §8.8, each spritesheet gets **one declarative atlas config**
(name, frameWidth, animations) rather than magic numbers scattered through the
rendering code.

## License

The Tiny Swords license (Pixel Frog) permits commercial use, but **re-check the
current license text on the pack's itch.io page before shipping** (e.g. to
Steam).
