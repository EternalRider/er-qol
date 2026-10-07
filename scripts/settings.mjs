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
 * 目前只有一段：`WALL_HINT`（"在非墙体图层显示墙体提示线"）。
 * Region 行为自身的配置在 Behavior 的 schema 里，不走 `game.settings`。
 */
export const SETTINGS = Object.freeze({
  /** 墙体提示线：总开关。 */
  WALL_HINT: Object.freeze({
    ENABLED: "wallHint",
    COLOR: "wallHintColor",
    WIDTH: "wallHintWidth",
    OPACITY: "wallHintOpacity",
    SCOPE: "wallHintScope",
    /** 多选：按墙体阻挡类型过滤；空集合 = 任何墙体都画。 */
    BLOCKING: "wallHintBlocking"
  })
});

/**
 * 墙体提示线的"按阻挡类型过滤"可选项。
 *
 * 空集合表示不过滤；否则是**或**关系（勾了"移动"就画所有阻挡移动的墙，
 * 勾了"移动 + 视野"就画阻挡任一项的墙）。
 */
export const WALL_HINT_BLOCKING_CHOICES = Object.freeze({
  move: "ERQOL.SETTINGS.wallHintBlocking.move",
  sight: "ERQOL.SETTINGS.wallHintBlocking.sight",
  sound: "ERQOL.SETTINGS.wallHintBlocking.sound",
  light: "ERQOL.SETTINGS.wallHintBlocking.light"
});

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
    // 用 DataField 实例注册，核心配置面板才会渲染成取色器
    // （`type: String` 会被包成普通 StringField，只给一个文本框；见 core 的 settings/config.mjs）。
    // ColorField 是 StringField 的子类，读写仍然是 `#rrggbb` 字符串，与 getStringSetting 兼容；
    // 万一该字段不可用则退回普通字符串输入。
    type: getColorFieldType(),
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

  game.settings.register(MODULE_ID, HINT.BLOCKING, {
    name: "ERQOL.SETTINGS.wallHintBlocking.name",
    hint: "ERQOL.SETTINGS.wallHintBlocking.hint",
    scope: "client",
    config: true,
    // 多选：必须是实现了 `_toInput` 的字段实例（见 getBlockingFieldType 的说明），
    // 而且 choices 要挂在**字段**上，core 不会把 setting.choices 传进 DataField。
    // 这里的 setting.choices 只服务退化分支（`type: Array`）——那时 core 会把它包成
    // `StringField(choices)`（单选下拉），至少让选项可见；正常环境走字段分支时该属性被忽略。
    // 空集合 = 不过滤，任何墙体都画。
    type: getBlockingFieldType(),
    choices: {...WALL_HINT_BLOCKING_CHOICES},
    default: []
  });
}

/**
 * 取用于"按阻挡类型过滤"设置的字段类型。
 *
 * **必须用 `SetField`（它实现了 `_toInput` → 多选控件）**：
 * - `ArrayField` 没有 `_toInput`，基类会抛错、`formGroup` 捕到后渲染成**空字符串**，
 *   于是设置面板里这一项**根本不显示**；
 * - `choices` 也**必须挂在字段实例上**：core 对 DataField 类型只做 `data.field = setting.type`，
 *   不会把 `setting.choices` 传进字段（`applications/settings/config.mjs`）。
 *
 * 渲染结果是 `<multi-select>`：从下拉里选一项即添加（该项随即 disabled），
 * 点已选标签上的 ✕ 移除——**不需要按 Ctrl/Cmd**。
 * `SetField#clean()` 仍写数组、`initialize()` 返回 `Set`，两者都被 `getArraySetting()` 兼容。
 *
 * 拿不到 `foundry.data.fields` 时退回 `Array`；core 会把它包成
 * `ArrayField(StringField + setting.choices)`（单选，仅在退化环境下发生）。
 *
 * @returns {Function|object} 字段构造函数或字段实例
 */
function getBlockingFieldType() {
  const fields = globalThis.foundry?.data?.fields;
  if ( typeof fields?.SetField !== "function" || typeof fields?.StringField !== "function" ) return Array;
  try {
    return new fields.SetField(
      new fields.StringField({required: true, blank: false, choices: {...WALL_HINT_BLOCKING_CHOICES}}),
      {required: true, nullable: false, initial: []}
    );
  } catch ( err ) {
    return Array;
  }
}

/**
 * 取用于颜色设置的字段类型：优先 `foundry.data.fields.ColorField`（配置面板渲染成取色器），
 * 该字段不可用时退回 `String`（退化为文本框，功能不受影响）。
 *
 * 每次读取都新建一个字段实例——`game.settings.register` 要求 `type` 是字段**实例**
 * 才会走 DataField 分支（core 的 `applications/settings/config.mjs`）。
 *
 * @returns {Function|object} 字段构造函数或字段实例
 */
function getColorFieldType() {
  const ColorField = globalThis.foundry?.data?.fields?.ColorField;
  if ( typeof ColorField !== "function" ) return String;
  try {
    return new ColorField({required: true, nullable: false, initial: "#00e5ff"});
  } catch ( err ) {
    return String;
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
 * 读取字符串数组设置（多选类）。
 *
 * 兼容三种存法：真正的数组、`Set`（字段类型是 SetField 时），以及单值（旧数据）。
 *
 * @param {string} key 设置键
 * @param {string[]} [fallback=[]] 读取失败时的回退值
 * @returns {string[]} 字符串数组
 */
export function getArraySetting(key, fallback = []) {
  let value;
  try {
    value = game.settings.get(MODULE_ID, key);
  } catch ( err ) {
    return [...fallback];
  }
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
