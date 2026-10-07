/**
 * er-qol 初始化模块。
 *
 * 所有 Behavior 类型都在这里统一注册，好处是注册点集中、便于自检，
 * 也避免每个子模块各写一个 `init` 钩子。模组设置由 `settings.mjs` 统一注册。
 *
 * 命名约定：er-qol 是全新模组，Region Behavior 的 type 键一律用 `er-qol.*`，
 * **不保留**旧 region-lighting / region-walls 的兼容别名（那两个模组从未发布）。
 *
 * @module er-qol/scripts/init
 */

import {
  MODULE_ID,
  LIGHTING_TYPE,
  WALL_TYPE,
  BEHAVIOR_SUBTYPES,
  erqol
} from "./region-common.mjs";
import {registerModuleSettings} from "./settings.mjs";
import {registerLightingBehaviorTypes, installLighting} from "./region-lighting.mjs";
import {registerWallBehaviorTypes, installWalls} from "./region-walls.mjs";
import {registerFeatureTypes, registerHoverFeatures, ANNOUNCE_TYPE} from "./features.mjs";
import {installWallHint} from "./wall-hint.mjs";

/** 子类型 → er-qol 的 type 键。 */
const TYPE_BY_SUBTYPE = Object.freeze({
  regionLighting: LIGHTING_TYPE,
  regionWall: WALL_TYPE,
  regionAnnounce: ANNOUNCE_TYPE
});

/**
 * 给行为类型下拉框补本地化标题与图标。
 *
 * 这里的 `??=` 只是兜底：同样的键在 `region-*.mjs` / `features.mjs` 的注册函数里已经写过。
 *
 * @returns {void}
 */
function registerTypeLocalization() {
  const types = [
    [LIGHTING_TYPE, "ERQOL.REGION_LIGHTING.label", "ERQOL.REGION_LIGHTING.hint", "fa-solid fa-lightbulb"],
    [WALL_TYPE, "ERQOL.REGION_WALLS.label", "ERQOL.REGION_WALLS.hint", "fa-solid fa-bars"],
    [ANNOUNCE_TYPE, "ERQOL.REGION_ANNOUNCE.label", "ERQOL.REGION_ANNOUNCE.hint", "fa-solid fa-bullhorn"]
  ];

  for ( const [type, label, hint, icon] of types ) {
    CONFIG.RegionBehavior.typeLabels[type] ??= label;
    CONFIG.RegionBehavior.typeHints[type] ??= hint;
    CONFIG.RegionBehavior.typeIcons[type] ??= icon;
  }
}

/**
 * 自检 3 个 Behavior type 的 dataModel 是否都已注册，缺失时打印可定位的错误。
 *
 * @returns {string[]} 缺失的 type 键
 */
function auditBehaviorTypes() {
  const missing = BEHAVIOR_SUBTYPES
    .map(subtype => TYPE_BY_SUBTYPE[subtype])
    .filter(type => !CONFIG.RegionBehavior.dataModels[type]);

  if ( missing.length ) {
    console.error(`er-qol | Region Behavior 类型注册缺失：${missing.join(", ")}`);
  } else {
    console.log(`er-qol | Region Behavior 类型注册完成（${BEHAVIOR_SUBTYPES.join(", ")}）`);
  }

  erqol.registeredTypes = {canonical: {...TYPE_BY_SUBTYPE}, missing};
  return missing;
}

Hooks.once("init", () => {
  registerModuleSettings();
  registerLightingBehaviorTypes();
  registerWallBehaviorTypes();
  registerFeatureTypes();
  registerTypeLocalization();
  auditBehaviorTypes();
});

Hooks.once("ready", () => {
  // 画布交互（悬停高亮 / 区域信息）只在有画布时需要。
  registerHoverFeatures();

  // 光照/黑暗源需要挂在画布上；重复调用是幂等的。
  installLighting();

  // 墙体提示线：纯客户端可视化，幂等安装。
  installWallHint();

  console.log(`er-qol | 就绪（module id: ${MODULE_ID}）。`);
});

Hooks.on("canvasInit", () => {
  // 墙体行为需要包装 PolygonBackend，必须在画布初始化时安装。
  installWalls();
});
