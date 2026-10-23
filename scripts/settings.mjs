/**
 * er-qol 模组设置的唯一注册点。
 *
 * 所有 `game.settings.register` / `registerMenu` 调用都集中在这里，
 * 好处是设置键、默认值与本地化键在一个文件里对齐，子模块只读不注册：
 *
 * ```js
 * import { getBoolSetting, getNumberSetting, getStringSetting, SETTINGS } from "./settings.mjs";
 * const enabled = getBoolSetting(SETTINGS.WALL_HINT.ENABLED);
 * ```
 *
 * 必须在 `Hooks.once("init")` 中调用 {@link registerModuleSettings}。
 *
 * ## 墙体提示线的设置形态（2026-10-23 改为"多条线"）
 *
 * - `wallHint` / `wallHintOpacity` / `wallHintScope`：仍然直接显示在模组设置面板里；
 * - `wallHintLines`：一组线定义，`config: false`，通过一个**自定义设置子菜单**
 *   （`WallHintLinesConfig`，见 `wall-hint-config.mjs`）编辑；
 * - 默认 `[]` = 使用内置默认线（统一颜色、所有墙体一律绘制），
 *   这样"默认配置不泄露密门"的保证与旧版一致。
 *
 * @module er-qol/scripts/settings
 */

import {MODULE_ID} from "./region-common.mjs";
import {
  DEFAULT_WALL_HINT_COLOR,
  DEFAULT_WALL_HINT_WIDTH,
  WALL_HINT_BLOCKING_TYPES
} from "./wall-hint-lines.mjs";
import {WALL_HINT_LINES_SETTING, WallHintLinesConfig} from "./wall-hint-config.mjs";

// 便于子模块只 import 一个文件：设置模块同时转发模组 id。
export {MODULE_ID};

/**
 * 全部设置键。
 *
 * 目前只有一段：`WALL_HINT`（"在非墙体图层显示墙体提示线"）。
 * Region 行为自身的配置在 Behavior 的 schema 里，不走 `game.settings`。
 */
export const SETTINGS = Object.freeze({
  /** 墙体提示线：总开关 + 透明度 + 显示范围 + 多条线定义。 */
  WALL_HINT: Object.freeze({
    ENABLED: "wallHint",
    OPACITY: "wallHintOpacity",
    SCOPE: "wallHintScope",
    LINES: WALL_HINT_LINES_SETTING
  })
});

/**
 * 线条件里可用通道的本地化键（顺序与 `WALL_HINT_BLOCKING_TYPES` 一致）。
 *
 * 设置菜单里每行用复选框展示这四项；空 = 所有墙体都满足条件。
 */
export const WALL_HINT_BLOCKING_CHOICES = Object.freeze(
  Object.fromEntries(WALL_HINT_BLOCKING_TYPES.map(key => [key, `ERQOL.SETTINGS.wallHintBlocking.${key}`]))
);

/** 墙体提示线设置菜单的键（`game.settings.registerMenu` 用）。 */
export const WALL_HINT_LINES_MENU = "wallHintLinesMenu";

/**
 * 注册全部模组设置。
 *
 * 必须在 `Hooks.once("init")` 中调用（`init.mjs` 统一调用）。
 *
 * @returns {void}
 */
export function registerModuleSettings() {
  registerWallHintSettings();
}

/**
 * 注册"墙体提示线"相关的设置与设置子菜单。
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

  // 多条线定义：只有一个普通的 JSON 数组，编辑界面由下面的子菜单负责。
  // 不能注册成需要 `_toInput` 的字段（例如带自定义 schema 的 ArrayField）——那会在
  // 设置面板里渲染成空白；`config: false` 让它不出现在主面板，菜单负责编辑。
  //
  // 类型用 `Object` 而不是 `Array`：core 的 `Setting#_castType()` 把 `Array` 当"基础类型"
  // 直接调用 `Array(value)`，对已经是数组的值会套成 `[value]`（多包一层）；
  // `Object(value)` 对数组/对象都原样返回。
  game.settings.register(MODULE_ID, HINT.LINES, {
    name: "ERQOL.SETTINGS.wallHintLines.name",
    hint: "ERQOL.SETTINGS.wallHintLines.hint",
    scope: "client",
    config: false,
    type: Object,
    default: []
  });

  // 设置子菜单：真实 Foundry 一定有 registerMenu；Node 自测环境可能没有，跳过即可。
  if ( typeof game.settings.registerMenu === "function" ) {
    game.settings.registerMenu(MODULE_ID, WALL_HINT_LINES_MENU, {
      name: "ERQOL.SETTINGS.wallHintLines.name",
      label: "ERQOL.SETTINGS.wallHintLines.menu",
      hint: "ERQOL.SETTINGS.wallHintLines.hint",
      icon: "fa-solid fa-pen-ruler",
      type: WallHintLinesConfig,
      restricted: false
    });
  }
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
 * 读取原始设置值（任意类型），读取失败/缺省时回退。
 *
 * 与下面几个 `get*Setting` 的区别：不做类型转换，适合 `wallHintLines` 这种对象数组。
 *
 * @param {string} key 设置键
 * @param {*} [fallback=null] 读取失败时的回退值
 * @returns {*} 设置值
 */
export function getSetting(key, fallback = null) {
  try {
    const value = game.settings.get(MODULE_ID, key);
    return (value === null) || (value === undefined) ? fallback : value;
  } catch ( err ) {
    return fallback;
  }
}

/**
 * 读取字符串数组设置（多选类）。
 *
 * 兼容三种存法：真正的数组、`Set`（字段类型是 SetField 时），以及单值（旧数据）。
 *
 * @param {string} key 设置键
 * @param {string[]} [fallback=[]] 读取失败时的回退值
 * @returns {string[]} 字符串数组
 */
export function getArraySetting(key, fallback = []) {
  const value = getSetting(key, fallback);
  if ( value instanceof Set ) return [...value].map(String);
  if ( Array.isArray(value) ) return value.map(String);
  if ( (value === null) || (value === undefined) || (value === "") ) return [...fallback];
  return [String(value)];
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

/** 默认颜色/宽度（供菜单页脚提示与自测读取，导出自本文件避免拼写漂移）。 */
export const WALL_HINT_DEFAULTS = Object.freeze({
  color: DEFAULT_WALL_HINT_COLOR,
  width: DEFAULT_WALL_HINT_WIDTH
});
