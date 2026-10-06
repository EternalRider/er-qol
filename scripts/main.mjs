/**
 * er-qol（EternalRider's QoL）入口模块。
 *
 * 本模组把原先的 `region-lighting` 与 `region-walls` 合并为一个模组并追加更多 QoL 功能：
 * 1. **Region Lighting**：用 Region 的完整形状与高度范围发出光照或黑暗；
 * 2. **Region Walls**：把 Region 边界变成"墙"，阻挡移动/视觉/光照/声音/黑暗；
 * 3. **Region Announce**：Token 进入/离开 Region 时发提示或聊天消息；
 * 4. **Region Teleport**：Token 进入 Region 时传送到指定场景坐标（可带到达站点）；
 * 5. **悬停高亮 / 区域信息**：鼠标悬停 Region 时高亮轮廓并显示基础信息。
 *
 * 兼容性：保留 `region-lighting.regionLighting`、`region-walls.regionWall` 以及
 * 裸子类型名 `regionLighting` / `regionWall` 作为行为 type 的别名，
 * 老世界里已有的 Region 行为无需迁移即可继续工作。
 *
 * @module er-qol/scripts/main
 */

import "./init.mjs";

export * from "./region-common.mjs";
