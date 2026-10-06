/**
 * er-qol 初始化模块。
 *
 * 所有 Behavior 类型（含旧模组 type 键的兼容别名）都在这里统一注册，
 * 好处是注册点集中、便于校验"别名是否都注册成功"，也避免每个子模块各写一个 `init` 钩子。
 *
 * @module er-qol/scripts/init
 */

import {
  LEGACY_TYPE_GROUPS,
  LIGHTING_TYPE,
  WALL_TYPE,
  erqol
} from "./region-common.mjs";
import {registerLightingBehaviorTypes, installLighting} from "./region-lighting.mjs";
import {registerWallBehaviorTypes, installWalls} from "./region-walls.mjs";
import {registerFeatureTypes, registerHoverFeatures, ANNOUNCE_TYPE, TELEPORT_TYPE} from "./features.mjs";

/** 需要注册的 Behavior 子类型 → 规范化 type 键。 */
const REGISTERED_TYPES = Object.freeze({
  regionLighting: LIGHTING_TYPE,
  regionWall: WALL_TYPE,
  regionAnnounce: ANNOUNCE_TYPE,
  regionTeleport: TELEPORT_TYPE
});

/**
 * 给行为类型下拉框补本地化标题（只给规范化键，别名键进了会重复）。
 * @returns {void}
 */
function registerTypeLocalization() {
  const types = [
    [LIGHTING_TYPE, "ERQOL.REGION_LIGHTING.label", "ERQOL.REGION_LIGHTING.hint", "fa-solid fa-lightbulb"],
    [WALL_TYPE, "ERQOL.REGION_WALLS.label", "ERQOL.REGION_WALLS.hint", "fa-solid fa-bars"],
    [ANNOUNCE_TYPE, "ERQOL.REGION_ANNOUNCE.label", "ERQOL.REGION_ANNOUNCE.hint", "fa-solid fa-bullhorn"],
    [TELEPORT_TYPE, "ERQOL.REGION_TELEPORT.label", "ERQOL.REGION_TELEPORT.hint", "fa-solid fa-door-open"]
  ];

  for ( const [type, label, hint, icon] of types ) {
    CONFIG.RegionBehavior.typeLabels[type] ??= label;
    CONFIG.RegionBehavior.typeHints[type] ??= hint;
    CONFIG.RegionBehavior.typeIcons[type] ??= icon;
  }
}

/**
 * 自检出所有旧 type 别名是否都已注册，缺失时打印可定位的警告。
 * @returns {string[]} 缺失的 type 键
 */
function auditTypeAliases() {
  const missing = [];
  for ( const [subtype, canonical] of Object.entries(REGISTERED_TYPES) ) {
    const aliases = subtype in LEGACY_TYPE_GROUPS ? LEGACY_TYPE_GROUPS[subtype] : [canonical];
    for ( const type of aliases ) {
      if ( !CONFIG.RegionBehavior.dataModels[type] ) missing.push(type);
    }
  }

  if ( missing.length ) {
    console.error(`er-qol | Region Behavior 类型注册缺失（老世界的 Region 行为可能失效）：${missing.join(", ")}`);
  } else {
    console.log("er-qol | Region Behavior 类型注册完成（含 region-lighting / region-walls 兼容别名）");
  }

  erqol.registeredTypes = {canonical: {...REGISTERED_TYPES}, missing};
  return missing;
}

Hooks.once("init", () => {
  registerLightingBehaviorTypes();
  registerWallBehaviorTypes();
  registerFeatureTypes();
  registerTypeLocalization();
  auditTypeAliases();
});

Hooks.once("ready", () => {
  // 画布交互（悬停高亮 / 区域信息）只在有画布时需要。
  registerHoverFeatures();

  // 光照/黑暗源需要挂在画布上；重复调用是幂等的。
  installLighting();
});

Hooks.on("canvasInit", () => {
  // 墙体行为需要包装 PolygonBackend，必须在画布初始化时安装。
  installWalls();
});
