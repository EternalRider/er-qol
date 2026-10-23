/**
 * er-qol（EternalRider's QoL）入口模块。
 *
 * 本模组把原先的 `region-lighting` 与 `region-walls` 合并为一个模组并追加更多 QoL 功能：
 * 1. **Region Lighting**：用 Region 的完整形状与高度范围发出光照或黑暗；
 * 2. **Region Walls**：把 Region 边界变成"墙"，阻挡移动/视觉/光照/声音/黑暗；
 * 3. **Region Announce**：Token 进入/离开 Region 时发提示或聊天消息；
 * 4. **墙体提示线**：可在设置中开启，在其他图层上也画出墙体线；默认统一颜色、
 *    所有类型墙体一律绘制，也可在设置子菜单里配置多条线（线型/颜色/宽度/条件/优先级）；
 * 5. **Token 阻挡**：让 Token（以及 Actor 的原型 Token）像单向墙一样阻挡移动/视野/声音/光照，
 *    但不挡自己。
 *
 * 命名：Region Behavior 一律使用 `er-qol.*` 的 type 键，
 * **不保留**旧 region-lighting / region-walls 的 type 键别名（那两个模组从未发布过）。
 *
 * @module er-qol/scripts/main
 */

import "./init.mjs";

export * from "./region-common.mjs";
export * from "./settings.mjs";
