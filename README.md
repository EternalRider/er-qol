# EternalRider's QoL（er-qol）

> A lightweight quality-of-life module for **Foundry Virtual Tabletop V14** — Region lighting, wall-like
> Region boundaries, region announcements, wall outlines on other layers, and token blocking.
>
> [中文](#中文) · [English](#english)

---

## 中文

**er-qol（EternalRider's QoL）** 是一个面向 Foundry Virtual Tabletop **V14** 的轻量 QoL 模组，
把几个常用但零散的小功能集中到一起：用 Region 做光照/墙体/播报，在其他图层也画出墙线，
以及让 Token 像墙一样阻挡移动与感知。全部功能都是客户端/Region 行为级别，**不依赖任何游戏系统**。

### 功能

#### 1. 区域光照（Region Lighting）

一个 **Region Behavior**：用 Region 的完整形状与高度范围发出**光照或黑暗**，而不是只能放一个点光源。

- 支持 Foundry 光照的全部常用设置（亮度、颜色、衰减、阴影、动画等）；
- 支持 **priority（优先级）**，可覆盖更低优先级的光源/黑暗源；
- 适合做"这片走廊是暗的""这个房间有烛光"这类与地形完全贴合的光照。

#### 2. 区域墙体（Region Walls）

一个 **Region Behavior**：把 Region 边界变成"墙"，可按通道分别阻挡：

| 通道 | 含义 |
| --- | --- |
| 移动 | Token 不能穿过 Region 边界 |
| 视野 | 视线与可见性不能穿过 |
| 光照 | 光照不能穿过 |
| 声音 | 声音不能穿过 |
| 黑暗 | 黑暗不能穿过 |
| 方向 | 双向 / 仅从内到外 / 仅从外到内 |

并且支持**高度范围**：只有 Region 的高度区间与穿行高度重叠时才生效。

#### 3. 区域播报（Region Announce）

一个 **Region Behavior**：Token 进入/离开 Region 时发送提示。

- 进入、离开分别开关，消息支持 `{token}` / `{region}` 占位符；
- 输出方式：UI 通知或聊天消息；
- 可见范围：所有人 / GM 与 Token 所有者 / 仅 GM；
- 可选音效与音量。

#### 4. 其他图层墙线提示（Wall Outlines On Other Layers）

客户端设置：即使当前不在"墙体"图层，也把每面墙的真实位置画出来，方便玩家移动 Token。

- **默认是一条统一颜色的线、所有类型的墙体（包括密门）都照常绘制**——每根线看起来一样，
  不会把密门单独标出来；
- **可配置多条线**：打开设置里的「配置墙体线样式」，可以添加多条线，每条线单独配置：
  - **线型**：实线 / 虚线 / 点线 / 点划线 / 双点划线；
  - **颜色**、**宽度**；
  - **条件**：只画"至少阻挡了某一项感知"的墙体（空 = 所有墙体）；
  - **优先级**：同一面墙命中多条线时，画优先级最高的那条（同优先级取顺序靠前的）。
- 另有全局透明度，以及显示范围：仅其他图层 / 始终显示。
- 线的条件只按"墙阻挡了哪些感知"判断，**不会按墙体类型上色或跳过**，因此不会泄露密门。

#### 5. Token 阻挡（Token Blocking）

让一个 Token（以及 Actor 的原型 Token）像墙一样阻挡移动与感知。

- 配置入口：Token 配置窗口里、**紧跟「光照」之后的「阻挡」tab**；
- 配置保存在 **原型 Token** 上，之后新放置的 Token 自动继承；
- 四个通道可独立勾选：**阻挡移动 / 阻挡视野 / 阻挡声音 / 阻挡光照**；
- **不会挡住自己**：Token 自己的移动、视野、光照、声音不受自己范围影响；
  其他 Token 进不去它的范围，并且**能看见它、但看不穿它**（类似单向墙）；
- **阻挡形状**可配置：
  - **矩形**（默认）：Token 占用的格子；
  - **椭圆 / 圆形**：格子内切椭圆；
  - **图片边缘（实验性）**：按 Token 图片的不透明像素生成轮廓，**忽略透明部分**；
    无法读取图片（跨域、图集、加载失败等）时会自动回退成矩形。
- 只覆盖上述 4 个通道（墙另外还能挡黑暗、带光照阈值）；`Edge` 是 2D 的，同一 Level 内不同高度的
  Token 会互相遮挡——这是"把 Token 当墙"的固有语义。

### 兼容性

- **Foundry VTT V14**（`minimum: 14`，`verified: 14.369`）；
- **不依赖任何游戏系统**，所有功能都可跨系统使用；
- Region Behavior 类型统一使用 `er-qol.*` 命名空间。

### 安装

在 Foundry 的「附加模块 → 安装模块」里粘贴 Manifest URL：

```
https://github.com/EternalRider/er-qol/releases/latest/download/module.json
```

或者手动把发布包解压到 `FoundryVTT/Data/modules/er-qol`，然后在模块管理里启用。

### 语言

内置 **English / 简体中文** 本地化；在 Foundry 的「设置 → 语言」里切换即可。

### 反馈与问题

- 问题反馈：<https://github.com/EternalRider/er-qol/issues>
- 源码：<https://github.com/EternalRider/er-qol>

### 许可

**MIT** — 见 [LICENSE](LICENSE)。

---

## English

**er-qol (EternalRider's QoL)** is a lightweight quality-of-life module for **Foundry Virtual Tabletop V14**.
It bundles a few small, commonly needed tools: Region-based lighting, wall-like Region boundaries,
region announcements, wall outlines on other layers, and token blocking. Everything works at the
client / Region-behavior level and **does not depend on any game system**.

### Features

#### 1. Region Lighting

A **Region Behavior** that emits **light or darkness using the Region's full shape and elevation range**,
instead of a point light with a radius.

- Supports the usual Foundry light configuration (bright/dim, color, attenuation, shadows, animations, …);
- Supports **priority**, so Region lights/darkness can override lower-priority sources;
- Great for "this corridor is dark" or "this room is lit by candles" with lighting that follows the terrain exactly.

#### 2. Region Walls

A **Region Behavior** that turns the Region boundary into a **wall**, per channel:

| Channel | Meaning |
| --- | --- |
| Movement | tokens cannot cross the Region boundary |
| Sight | line of sight / visibility cannot cross |
| Light | light cannot project through |
| Sound | sound cannot project through |
| Darkness | darkness cannot project through |
| Direction | both ways / inside→outside only / outside→inside only |

It also supports **elevation ranges**: the boundary only applies when the Region's elevation range
overlaps the moving/sensing height.

#### 3. Region Announce

A **Region Behavior** that posts a message when a token enters or leaves the Region.

- Separate entry/exit toggles, with `{token}` and `{region}` placeholders;
- Output: UI notification or chat message;
- Visibility: everyone / GM and token owner / GM only;
- Optional sound effect with volume.

#### 4. Wall Outlines On Other Layers

A client-side setting that draws **every wall even when the Walls layer is not active**, so players can
see where the real wall lines are while moving tokens.

- **By default: one uniform color, and every wall type (secret doors included) is drawn** — all lines look
  the same, so secret doors are not revealed;
- **Multiple configurable styles**: open *Configure Wall Outline Styles* in the module settings and add
  one or more lines. Each line configures:
  - **Line style**: solid / dashed / dotted / dash-dot / dash-dot-dot;
  - **Color** and **width**;
  - **Condition**: draw only walls that block at least one selected sense (empty = every wall);
  - **Priority**: when a wall matches several lines, the highest-priority line is drawn
    (ties use the row order).
- Global opacity and scope: only on other layers / always;
- Conditions are matched only against **what the wall blocks**, never against the wall type, so secret
  doors stay indistinguishable.

#### 5. Token Blocking

Make a token (or an Actor's prototype token) block movement and senses like a wall.

- Configure it in the Token configuration window — the **Blocking** tab comes **right after Light**;
- Stored on the **prototype token**, so newly placed tokens inherit it;
- Four independent channels: **Blocks Movement / Sight / Sound / Light**;
- **The token never blocks itself**: its own movement, vision, light and sound are unaffected by its own
  space. Other tokens cannot enter its space, and they **can see the token but cannot see through it**
  (like a one-way wall);
- **Blocking shape** is configurable:
  - **Rectangle** (default): the token's grid space;
  - **Ellipse / Circle**: an oval inside the grid space;
  - **Image Edge (experimental)**: follows the opaque pixels of the token image and **ignores transparent
    parts**; if the image cannot be read (cross-origin, atlas, load failure, …) it falls back to a rectangle.
- Only these four channels are covered (walls additionally block darkness and carry light thresholds);
  `Edge` is 2D, so tokens at different elevations on the same Level block each other — that is the intended
  "a token acts as a wall" semantics.

### Compatibility

- **Foundry VTT V14** (`minimum: 14`, `verified: 14.369`);
- **No game-system dependency** — works on any system;
- Region Behavior types use the `er-qol.*` namespace.

### Installation

In Foundry's *Add-on Modules → Install Module*, paste the manifest URL:

```
https://github.com/EternalRider/er-qol/releases/latest/download/module.json
```

Or unzip the release into `FoundryVTT/Data/modules/er-qol` and enable it in *Manage Modules*.

### Languages

Ships with **English / Simplified Chinese** localization; switch it in *Settings → Language*.

### Feedback & Issues

- Issues: <https://github.com/EternalRider/er-qol/issues>
- Source: <https://github.com/EternalRider/er-qol>

### License

**MIT** — see [LICENSE](LICENSE).
