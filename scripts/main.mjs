/**
 * er-qol（EternalRider's QoL）入口模块。
 *
 * 本模组把原先的 `region-lighting` 与 `region-walls` 合并为一个模组并追加更多 QoL 功能：
 * 1. **Region Lighting**：用 Region 的完整形状与高度范围发出光照或黑暗；
 * 2. **Region Walls**：把 Region 边界变成"墙"，阻挡移动/视觉/光照/声音/黑暗；
 * 3. **Region Announce**：Token 进入/离开 Region 时发提示或聊天消息；
 * 4. **Region Teleport**：Token 进入 Region 时传送到指定场景坐标（可带到达站点）；
 * 5. **悬停高亮 / 区域信息**：鼠标悬停 Region 时高亮轮廓并显示基础信息；
 * 6. **墙体提示线**：可在设置中开启，在其他图层上也画出墙体线（统一可配置颜色）。
 *
 * 命名：Region Behavior 一律使用 `er-qol.*` 的 type 键，
 * **不保留**旧 region-lighting / region-walls 的 type 键别名（那两个模组从未发布过）。
 *
 * @module er-qol/scripts/main
 */

import "./init.mjs";

export * from "./region-common.mjs";
export * from "./settings.mjs";
