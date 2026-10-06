# EternalRider's QoL (er-qol)

A Foundry VTT **Region quality-of-life** module for Foundry **V14**: it bundles the former
`region-lighting` and `region-walls` modules into one package and adds a few more Region tools.

> This module **supersedes** [`region-lighting`](https://github.com/EternalRider/region-lighting) and
> [`region-walls`](https://github.com/EternalRider/region-walls). You do **not** need both anymore —
> install `er-qol` and disable the two old modules.

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
- optional destination Region name — the target scene name must match, and standing inside a Region
  with that name clears the cooldown (prevents teleport ping-pong);
- world-level cooldown setting (default 1000 ms, `0` disables);
- optional notification with placeholders.

> Movement is applied from the client that owns the token (or the GM), so players can walk through
> doorways/portals themselves.

### 5. Hover Highlight & Region Info *(new)*

Client-side settings in **Configure Settings → EternalRider's QoL**:

- **Hover Highlight** – draw the hovered Region's outline on top of the canvas;
- **Hover Info** – show a small notice with the Region's behaviors and elevation range.

## Compatibility

- Foundry **V14** (`minimum: 14`, `verified: 14.361`). The two merged modules targeted V14 as well.
- **Backward compatible behavior types.** Regions that already use the old modules keep working:
  `er-qol` registers the legacy type keys
  `region-lighting.regionLighting`, `region-walls.regionWall` (and the bare subtypes
  `regionLighting` / `regionWall`) as aliases of its own behavior types. Existing worlds need no
  migration.
- The `swpt` module writes those legacy type keys through its API, so it keeps working unchanged.
- No system dependency: works on any game system, tested against the core Region API.

## Installation

Manifest URL:

```
https://github.com/EternalRider/er-qol/releases/latest/download/module.json
```

Or drop the folder into `FoundryVTT/Data/modules/er-qol` and enable it.

## Migrating from region-lighting / region-walls

1. Install and enable `er-qol`.
2. Disable (or uninstall) `region-lighting` and `region-walls`.
3. Existing Regions keep their behavior settings — the module registers the old type keys as aliases.

## License

Code: **MIT** — see [LICENSE](LICENSE).

The original `region-lighting` and `region-walls` code was released by the same author under the MIT
license and is merged here in its entirety.
