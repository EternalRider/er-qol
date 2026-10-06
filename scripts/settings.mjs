/**
 * er-qol 模组设置的唯一注册点。
 *
 * 所有 `game.settings.register(MODULE_ID, ...)` 调用都集中在这里，
 * 好处是设置键、默认值与本地化键在一个文件里对齐，子模块只读不注册：
 *
 * ```js
 * import { getBoolSetting, getNumberSetting, getStringSetting, SETTINGS } from "./settings.mjs";
 * const enabled = getBoolSetting(SETTINGS.WALL_HINT.ENABLED);
 * ```
 *
 * 必须在 `Hooks.once("init")` 中调用 {@link registerModuleSettings}。
 *
 * @module er-qol/scripts/settings
 */

import {MODULE_ID} from "./region-common.mjs";

// 便于子模块只 import 一个文件：设置模块同时转发模组 id。
export {MODULE_ID};

/**
 * 全部设置键。
 *
 * 分三段：`REGION_*` 是 Region 行为/悬停相关的通用设置，
 * `TELEPORT_*` 是区域传送，`WALL_HINT` 是"在非墙体图层显示墙体提示线"。
 */
export const SETTINGS = Object.freeze({
  /** 悬停 Region 时高亮其轮廓（客户端）。 */
  HOVER_HIGHLIGHT: "hoverHighlight",
  /** 悬停 Region 时显示简要信息（客户端）。 */
  HOVER_INFO: "hoverInfo",
  /** 被传送后的冷却毫秒数（世界级）。 */
  TELEPORT_COOLDOWN: "teleportCooldown",
  /** 墙体提示线：总开关。 */
  WALL_HINT: Object.freeze({
    ENABLED: "wallHint",
    COLOR: "wallHintColor",
    WIDTH: "wallHintWidth",
    OPACITY: "wallHintOpacity",
    SCOPE: "wallHintScope",
    SHOW_SECRET: "wallHintShowSecret"
  })
});

/**
 * 注册全部模组设置。
 *
 * 必须在 `Hooks.once("init")` 中调用（`init.mjs` 统一调用）。
 *
 * @returns {void}
 */
export function registerModuleSettings() {
  const {SCOPE} = SETTINGS.WALL_HINT;

  game.settings.register(MODULE_ID, SETTINGS.HOVER_HIGHLIGHT, {
    name: "ERQOL.SETTINGS.hoverHighlight.name",
    hint: "ERQOL.SETTINGS.hoverHighlight.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.HOVER_INFO, {
    name: "ERQOL.SETTINGS.hoverInfo.name",
    hint: "ERQOL.SETTINGS.hoverInfo.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.TELEPORT_COOLDOWN, {
    name: "ERQOL.SETTINGS.teleportCooldown.name",
    hint: "ERQOL.SETTINGS.teleportCooldown.hint",
    scope: "world",
    config: true,
    type: Number,
    range: {min: 0, max: 10000, step: 100},
    default: 1000
  });

  registerWallHintSettings();
}

/**
 * 注册"墙体提示线"相关的 6 个客户端设置。
 *
 * 单独拆出来是为了让 `wall-hint.mjs` 的接线清晰：该模块只读这些键，不重复注册。
 *
 * @returns {void}
 */
export function registerWallHintSettings() {
  const HINT = SETTINGS.WALL_HINT;

  game.settings.register(MODULE_ID, HINT.ENABLED, {
    name: "ERQOL.SETTINGS.wallHint.name",
    hint: "ERQOL.SETTINGS.wallHint.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, HINT.COLOR, {
    name: "ERQOL.SETTINGS.wallHintColor.name",
    hint: "ERQOL.SETTINGS.wallHintColor.hint",
    scope: "client",
    config: true,
    type: String,
    // Foundry 14 会用取色器渲染 `#rrggbb` 形式的字符串设置。
    default: "#00e5ff"
  });

  game.settings.register(MODULE_ID, HINT.WIDTH, {
    name: "ERQOL.SETTINGS.wallHintWidth.name",
    hint: "ERQOL.SETTINGS.wallHintWidth.hint",
    scope: "client",
    config: true,
    type: Number,
    range: {min: 1, max: 10, step: 0.5},
    default: 2
  });

  game.settings.register(MODULE_ID, HINT.OPACITY, {
    name: "ERQOL.SETTINGS.wallHintOpacity.name",
    hint: "ERQOL.SETTINGS.wallHintOpacity.hint",
    scope: "client",
    config: true,
    type: Number,
    range: {min: 0.1, max: 1, step: 0.05},
    default: 1
  });

  game.settings.register(MODULE_ID, HINT.SCOPE, {
    name: "ERQOL.SETTINGS.wallHintScope.name",
    hint: "ERQOL.SETTINGS.wallHintScope.hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      otherLayers: "ERQOL.SETTINGS.wallHintScope.otherLayers",
      always: "ERQOL.SETTINGS.wallHintScope.always"
    },
    default: "otherLayers"
  });

  game.settings.register(MODULE_ID, HINT.SHOW_SECRET, {
    name: "ERQOL.SETTINGS.wallHintShowSecret.name",
    hint: "ERQOL.SETTINGS.wallHintShowSecret.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });
}

/**
 * 判断某个设置键是否属于本模组的"墙体提示线"设置。
 *
 * @param {string} key `game.settings` 的完整键（形如 `er-qol.wallHint`）
 * @returns {boolean} 属于墙体提示线设置时返回 true
 */
export function isWallHintSettingKey(key) {
  const prefix = `${MODULE_ID}.`;
  if ( !String(key ?? "").startsWith(prefix) ) return false;
  const localKey = String(key).slice(prefix.length);
  return Object.values(SETTINGS.WALL_HINT).includes(localKey);
}

/**
 * 读取布尔设置（在 `ready` 之前调用也不会抛错）。
 *
 * @param {string} key 设置键
 * @param {boolean} [fallback=true] 读取失败时的回退值
 * @returns {boolean} 设置值
 */
export function getBoolSetting(key, fallback = true) {
  try {
    return !!game.settings.get(MODULE_ID, key);
  } catch ( err ) {
    return fallback;
  }
}

/**
 * 读取数字设置（非有限数时回退）。
 *
 * @param {string} key 设置键
 * @param {number} [fallback=0] 读取失败时的回退值
 * @returns {number} 设置值
 */
export function getNumberSetting(key, fallback = 0) {
  try {
    const value = Number(game.settings.get(MODULE_ID, key));
    return Number.isFinite(value) ? value : fallback;
  } catch ( err ) {
    return fallback;
  }
}

/**
 * 读取字符串设置。
 *
 * @param {string} key 设置键
 * @param {string} [fallback=""] 读取失败/空值时的回退值
 * @returns {string} 设置值
 */
export function getStringSetting(key, fallback = "") {
  try {
    const value = game.settings.get(MODULE_ID, key);
    return (value === null) || (value === undefined) ? fallback : String(value);
  } catch ( err ) {
    return fallback;
  }
}
