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
  getRegistrableTypes,
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
 * 被本模组取代、但仍**必须保持启用**的旧模组。
 *
 * 原因：`swpt`（已冻结、不再维护）把它的 Region 辅助 API 门禁在这两个模组的 `active` 上
 * （`modules/swpt/scripts/api.js` 的 `buildRegionLightingData` / `buildRegionWallData`），
 * 一旦用户按"合并了就该禁用旧模组"的直觉把它们关掉，swpt 的这两个 API 会**静默返回 `{}`**。
 *
 * 由于 er-qol 注册了旧 type 键的别名，swpt 生成的数据在 er-qol 下依然可用，
 * 因此两个旧模组可以与 er-qol 同时启用；`reportLegacyModules()` 会把这个状态打到控制台。
 *
 * @type {readonly string[]}
 */
const LEGACY_MODULES = Object.freeze(["region-lighting", "region-walls"]);

/**
 * 检查被取代的旧模组是否仍然启用，并说明并存时的取舍。
 *
 * 为什么关心：`swpt`（已冻结、不再维护）把它的 Region 辅助 API 门禁在这两个模组的 `active` 上
 * （`modules/swpt/scripts/api.js` 的 `buildRegionLightingData` / `buildRegionWallData`），
 * 一旦用户按"合并了就该禁用旧模组"的直觉把它们关掉，这两个 API 会**静默返回 `{}`**。
 * 所以 README 明确写了"用 swpt 就必须保留这两个模组"，这里只在控制台提示一次现状。
 *
 * 并存的代价与规避：旧模组启用时，er-qol **按设计不注册旧 type 别名、也不处理旧键**
 * （见 `getRegistrableTypes()` / `isActiveBehaviorType()`），因此 swpt 写的
 * `region-lighting.regionLighting` / `region-walls.regionWall` 只由旧模组结算一次，
 * 不会出现"墙体边界收两遍、光照源建两个"。
 *
 * @returns {void}
 */
function reportLegacyModules() {
  const activeLegacy = LEGACY_MODULES.filter(id => game.modules?.get?.(id)?.active);
  if ( !activeLegacy.length ) {
    console.log("er-qol | 旧模组 region-lighting / region-walls 未启用：Region 边界与光照由 er-qol 独立负责（含旧 type 别名）。");
    return;
  }
  console.log(`er-qol | 旧模组仍启用（${activeLegacy.join(", ")}）：`
    + "swpt 的 Region API 依赖它们，请保持启用；对应子类型的旧 type 键已让位给旧模组处理，"
    + "er-qol 只处理 er-qol.* 键与新功能，不会重复收集。");
}

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
 * 自检出所有该注册的 type 键是否都已注册，缺失时打印可定位的警告。
 *
 * 注意与"跳过"的区别：当取代某子类型的旧模组仍然启用时，er-qol 会**刻意**不注册该子类型的
 * 旧别名键（避免与旧模组重复收集同一条 Region 行为），这属于预期行为，不算缺失。
 *
 * @returns {string[]} 缺失的 type 键
 */
function auditTypeAliases() {
  const missing = [];

  for ( const [subtype, canonical] of Object.entries(REGISTERED_TYPES) ) {
    const wanted = getRegistrableTypes(subtype);
    for ( const type of wanted ) {
      if ( !CONFIG.RegionBehavior.dataModels[type] ) missing.push(type);
    }
    // 规范化键永远在期望列表里，这里兜底防回归。
    if ( !CONFIG.RegionBehavior.dataModels[canonical] ) missing.push(canonical);

    const skipped = (LEGACY_TYPE_GROUPS[subtype] ?? []).filter(type => !wanted.includes(type));
    if ( skipped.length ) {
      console.log(`er-qol | ${subtype}: 旧模组仍在启用，按设计跳过旧 type 键的注册（${skipped.join(", ")}），`
        + "由旧模组负责这些行为，避免重复收集。");
    }
  }

  if ( missing.length ) {
    console.error(`er-qol | Region Behavior 类型注册缺失（老世界的 Region 行为可能失效）：${[...new Set(missing)].join(", ")}`);
  } else {
    console.log("er-qol | Region Behavior 类型注册完成（含未启用旧模组时的 region-lighting / region-walls 兼容别名）");
  }

  erqol.registeredTypes = {canonical: {...REGISTERED_TYPES}, missing: [...new Set(missing)]};
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

  reportLegacyModules();
});

Hooks.on("canvasInit", () => {
  // 墙体行为需要包装 PolygonBackend，必须在画布初始化时安装；
  // 与旧 region-walls 并存时不会重复收集（见 reportLegacyModules 注释）。
  installWalls();
});
