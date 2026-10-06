# EternalRider's QoL (er-qol)

A Foundry VTT **Region quality-of-life** module for Foundry **V14**: it bundles the former
`region-lighting` and `region-walls` modules into one package and adds a few more Region tools.

> This module **supersedes** [`region-lighting`](https://github.com/EternalRider/region-lighting) and
> [`region-walls`](https://github.com/EternalRider/region-walls): it contains both behaviors plus
> extra tools. Whether you may disable the two old modules depends on one thing:
>
> - **You do *not* use `swpt`** → install `er-qol`, then disable (or uninstall) the two old modules.
>   `er-qol` takes over their behavior-type keys as aliases.
> - **You *do* use `swpt`** → install `er-qol` and **keep `region-lighting` and `region-walls`
>   enabled**. `swpt` gates its Region helpers on those modules being active, so disabling them
>   silently breaks `swpt`'s `buildRegionLightingData()` / `buildRegionWallData()`.
>   Coexistence is supported: `er-qol` then deliberately leaves the legacy type keys to the old
>   modules (see [Compatibility](#compatibility)), so nothing is processed twice.
>
> Not sure? Keep the two old modules enabled — that combination is always correct and `er-qol`
> prints the detected state to the console at `ready`.

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

### 4. Region Teleport *(new)*

Teleport a token that enters the Region to **another coordinate or another scene**.

- destination scene id + x/y/elevation;
- optional **arrival Region name** — while a teleported token stands inside a Region with that name
  on the destination scene, its cooldown is cleared so it does not bounce straight back;
- world-level cooldown setting (default 1000 ms, `0` disables);
- optional notification with placeholders.

> Same-scene teleports are applied by the client that owns the token (or the GM), so players can walk
> through doorways and portals themselves. **Scene-to-scene** teleport needs the GM: creating a
> `Token` requires the `TOKEN_CREATE` permission, which players do not have by default — non-GM
> clients get an explicit "requires the GM" notice instead of a silent failure.

### 5. Hover Highlight & Region Info *(new)*

Client-side settings in **Configure Settings → EternalRider's QoL**:

- **Hover Highlight** – draw the hovered Region's outline on top of the canvas;
- **Hover Info** – show a small notice with the Region's behaviors and elevation range.

## Compatibility

- Foundry **V14** (`minimum: 14`, `verified: 14.368`). The two merged modules targeted V14 as well.
- **Backward compatible behavior types.** If the corresponding old module is **not** active,
  `er-qol` registers its behavior types under the legacy keys
  (`region-lighting.regionLighting`, `region-walls.regionWall`, and the bare subtypes
  `regionLighting` / `regionWall`) as well as its own `er-qol.*` keys — so existing worlds need no
  migration.
- **Coexistence with the old modules.** When `region-lighting` / `region-walls` **are** active,
  `er-qol` deliberately does *not* register their legacy keys and does *not* process behavior
  documents of those types. The old module handles them exactly once, so a single Region never gets
  two light sources or two sets of collision edges. `er-qol` still handles its own `er-qol.*` keys
  and all of its new features.
  Consequence: with the old module active, legacy-type behaviors are handled by it (not by
  `er-qol`), which is exactly what `swpt` needs — `swpt` writes those legacy keys.
- The `swpt` module writes those legacy type keys through its API, so it keeps working **as long as
  `region-lighting` and `region-walls` stay enabled**.
- No system dependency: works on any game system, tested against the core Region API.

## Installation

Manifest URL:

```
https://github.com/EternalRider/er-qol/releases/latest/download/module.json
```

Or drop the folder into `FoundryVTT/Data/modules/er-qol` and enable it.

## Migrating from region-lighting / region-walls

1. Install and enable `er-qol`. Existing Regions keep their behavior settings — with the old modules
   disabled, `er-qol` answers to their legacy type keys.
2. **If you do not use `swpt`,** disable (or uninstall) `region-lighting` and `region-walls`.
3. **If you do use `swpt`, keep `region-lighting` and `region-walls` enabled.**
   `swpt` gates its `buildRegionLightingData()` / `buildRegionWallData()` helpers on
   `game.modules.get("region-lighting")?.active` (and the same for `region-walls`), so disabling
   them silently turns those helpers into no-ops.
   Running `er-qol` alongside the two legacy modules is **supported**: `er-qol` steps aside for the
   legacy type keys (see [Compatibility](#compatibility)), so each Region behavior is processed
   exactly once. `er-qol` prints the detected state to the console at `ready`.

## License

Code: **MIT** — see [LICENSE](LICENSE).

The original `region-lighting` and `region-walls` code was released by the same author under the MIT
license and is merged here in its entirety.
