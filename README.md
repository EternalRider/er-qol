# EternalRider's QoL (er-qol)

A Foundry VTT **Region quality-of-life** module for Foundry **V14**: it bundles the former
`region-lighting` and `region-walls` behaviors into one package and adds more Region tools plus a
wall-outline overlay.

> This module **supersedes** `region-lighting` and `region-walls`. Those two were never released —
> they only ever existed as local builds — so `er-qol` does **not** carry their behavior-type keys
> over. Everything uses the `er-qol.*` namespace (see [Compatibility](#compatibility)).
> **Disable or remove `region-lighting` / `region-walls` when you enable `er-qol`.**
> One exception: the local `swpt` module gates its `buildRegionLightingData()` /
> `buildRegionWallData()` helpers on `game.modules.get("region-lighting")?.active`, so if you rely on
> those helpers keep the old modules enabled too — but note that Region behaviors created with their
> old type keys will then be driven by the old modules, not by `er-qol`.

## Features

### 1. Region Lighting *(from region-lighting)*

A Region Behavior that emits **light or darkness using the Region's own shape and elevation range**,
instead of a point light with a radius. Supports the full Foundry light configuration
(alpha, bright/dim, color, coloration, attenuation, luminosity, saturation, contrast, shadows,
animations, darkness min/max) plus a **priority** value that lets a Region light/darkness override
lower-priority sources.

### 2. Region Walls *(from region-walls)*

A Region Behavior that turns the Region boundary into a **wall-like blocker**, per channel:

| Channel | Meaning |
| --- | --- |
| Move | tokens cannot cross the boundary |
| Sight | line of sight / visibility cannot cross |
| Light | light cannot project through |
| Sound | sound cannot project through |
| Darkness | darkness cannot project through |
| Direction | both ways, inside→outside only, or outside→inside only |

### 3. Region Announce *(new)*

Post a **UI notification or chat message** when a token enters or leaves the Region.

- separate entry/exit toggles, with `{token}` and `{region}` placeholders in the message;
- visibility: everyone / GM + token owner / GM only;
- optional sound effect with volume.

### 4. Wall Outlines On Other Layers *(new)*

Client-side setting that draws a thin line for **every wall even when the Walls layer is not
active**, so everyone can see where the real wall lines are while moving tokens around.

- one **uniform configurable color** (with a color picker) — deliberately *not* the Walls-layer
  colors. Every wall is drawn the same way, **secret doors included**: because the lines are
  indistinguishable, nothing stands out, whereas skipping a wall would mark its position by absence;
- configurable width and opacity;
- scope: only on other layers (hidden while the Walls layer is active) or always;
- **filter by what the wall blocks** (multi-select): block movement / sight / sound / light. Leave all
  options unchecked — the default — to draw every wall. Checked options are combined with **OR**, so
  checking *movement + sight* draws walls that block movement, sight, or both.

### 5. Token Blocking *(new)*

Give a token the same kind of presence as a wall: **the space it occupies blocks movement, sight,
sound and/or light**. Configure it in the Token configuration window — there is a **Blocking** tab
right after **Light** — and the values are stored on the **prototype token**, so tokens created
afterwards inherit them.

- four independent channels: Blocks Movement / Sight / Sound / Light;
- the blocking outline is the token's own footprint (its grid square(s)), so a door-sized token can
  act as a door, a pillar token can block line of sight, etc.;
- it participates in the same edge/sweep pipeline as walls, so sight, light, sound and movement
  polygon checks all see it.

> Scope notes: only these four channels are covered (walls additionally block darkness, and carry a
> light threshold). `Edge` is 2D, so tokens at different elevations **on the same Level** block each
> other — that is the intended "a token acts as a wall" semantics.

> Removed features (do not re-add):
> - **Region Teleport** — core and several other modules already cover teleportation, and a teleport
>   without an animation is of limited use.
> - **Hover Highlight / Region Info** — never worked reliably here; the author did not need them.

## Compatibility

- Foundry **V14** (`minimum: 14`, `verified: 14.368`). The two merged modules targeted V14 as well.
- **er-qol namespaced behavior types only.** All three Region behaviors use `er-qol.*` type keys
  (`er-qol.regionLighting`, `er-qol.regionWall`, `er-qol.regionAnnounce`).
  The pre-release `region-lighting` / `region-walls` type keys are **not** carried over, so Region
  behaviors created with those keys stop working unless the old module is still enabled (in which
  case the old module keeps driving them).
- The local `swpt` module gates its `buildRegionLightingData()` / `buildRegionWallData()` helpers on
  `game.modules.get("region-lighting")?.active` (and the same for `region-walls`). If you use those
  helpers, keep the two old modules enabled — the behaviors they create will then be handled by the
  old modules.
- No system dependency: works on any game system, tested against the core Region API.

## Installation

Manifest URL:

```
https://github.com/EternalRider/er-qol/releases/latest/download/module.json
```

Or drop the folder into `FoundryVTT/Data/modules/er-qol` and enable it.

## Migrating from region-lighting / region-walls

Those modules were never released, so there is no published data to migrate:

1. Install and enable `er-qol`.
2. Disable (or uninstall) `region-lighting` and `region-walls`.
3. Re-create any Region behaviors that used the old type keys — pick the matching
   `er-qol.*` behavior from the type dropdown and re-enter its settings. (The schema fields are
   identical to the old ones, so the values carry over by hand.)
4. Exception: if you use `swpt`'s Region helpers, keep the two old modules enabled (see
   [Compatibility](#compatibility)).

## License

Code: **MIT** — see [LICENSE](LICENSE).

The original `region-lighting` and `region-walls` code was released by the same author under the MIT
license and is merged here in its entirety.
