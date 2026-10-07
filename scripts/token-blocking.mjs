/**
 * er-qol 新增能力：Token / Actor 原型「像墙一样阻挡移动 / 视野 / 声音 / 光照」。
 *
 * ## 效果是怎么实现的
 *
 * Foundry v14 的 `canvas.edges`（`Canvas#edges` → 当前 Level 的 `CanvasEdges`，见 core
 * `client/canvas/board.mjs:458-464`）就是碰撞/感知系统取候选边的**唯一来源**：
 * `ClockwiseSweepPolygon#_identifyEdges()`（core `client/canvas/geometry/clockwise-sweep.mjs:228-242`，
 * 第 234 行 `this.level.edges.getEdges(...)`）会把那里的边克隆进来，再按
 * `edge[type] !== CONST.EDGE_SENSE_TYPES.NONE`（同文件 :266）逐通道过滤。
 * 所以"把 Token 的四条边界写进 `canvas.edges`"就等价于"这四条边是一面墙"，
 * 移动/视野/声音/光照四种 sweep 全都会看到它们，不需要包装任何 core 类。
 *
 * **与真正的墙的差别（别把它说成完全等价）**：
 * - 只做 **4 个通道**（move/sight/sound/light）。core 的墙体边还有 `darkness` 与
 *   `threshold`（`common/documents/wall.mjs:159-182`），本功能按需求不涉及；
 * - `Edge` 是 2D 的：`Point2` 只保留 `x/y`，构造时传的 `elevation` 会被 core 丢弃
 *   （`client/canvas/geometry/edges/edge.mjs:23-25`）。因此**同一 Level 内不同高度的
 *   Token 会互相遮挡** —— 这是"把 Token 当成墙"的固有语义，不是 bug。
 *
 * `canvas.edges` 是 `CanvasEdges extends Map`（core `client/canvas/geometry/edges/edges.mjs:9,81-95`），
 * 内部带四叉树与"交点脏标记"（:152 查询时自动 `identifyIntersections()`），
 * 因此反复 `set`/`delete` 不会累积、也不需要手动刷新交点。
 *
 * > `CanvasEdges#set` 要求 `scene.initializedEdges === true`（edges.mjs:82），
 * > 而 `Scene#initializeEdges()` 会 `Hooks.callAll("initializeEdges", scene)`
 * > （core `client/documents/scene.mjs:961-967`）。本模块因此额外挂了这个钩子：
 * > 它既是"最早可以安全写边"的时刻，也是 `Scene#_resetEdges()`（场景尺寸变化后清空
 * > 所有 level.edges 再重建）之后的**唯一恢复点**。
 *
 * ## 配置界面
 *
 * 用户要求"与光照配置项同 tab 级别、放在光照配置项之后"。Token 配置窗口的 tab 是
 * 各自独立的 PARTS 模板（`templates/scene/token/light.hbs:1` 就是一个
 * `<div class="tab scrollable" data-group="{{tab.group}}" data-tab="{{tab.id}}">`），
 * 所以"同级别"= 再插一个同构的 tab div。本模块在渲染钩子里把新 tab 插到光照 tab 之后、
 * 把导航按钮插到光照导航项之后。
 *
 * **两个钩子都要挂**：v14 里场景 Token 的配置页是 `TokenConfig`
 * （core `client/applications/sheets/token/token-config.mjs:11`），而 Actor 配置页的
 * 「原型 Token」用的是**另一个类** `PrototypeTokenConfig`
 * （core `client/applications/sheets/token/prototype-config.mjs:18`、
 * `client/config.mjs:2347` 的 `CONFIG.Token.prototypeSheetClass`、
 * `client/applications/sheets/actor-sheet.mjs:146` 用 `{prototype: actor.prototypeToken}` 打开它），
 * 它**不继承** `TokenConfig`。ApplicationV2 的 render 钩子名由继承链上的类名生成
 * （core `client/applications/api/application.mjs:1724-1731`），渲染时传入的参数是
 * `(app, element, context, options)`（同文件 :591-594），所以两个类分别触发
 * `renderTokenConfig` / `renderPrototypeTokenConfig`。
 *
 * ## 保存是怎么落盘的（为什么不用 libWrapper）
 *
 * 两个配置页的提交路径**不一样**：
 * - `TokenConfig` → `DocumentSheetV2#_prepareSubmitData`（core
 *   `client/applications/api/document-sheet.mjs:486-494`，在 :468 被调用）；
 * - `PrototypeTokenConfig` → 自己的静态 `#onSubmit` → `_processFormData`（core
 *   `client/applications/sheets/token/prototype-config.mjs:335-353`），**不经过**
 *   `_prepareSubmitData`。
 *
 * 所以包一个私有方法覆盖不了两者。本模块改用**纯 DOM 的镜像复选框**：
 * 每个配置项渲染两个 `<input type="checkbox">`——可见的那个**不带 name**（不参与提交），
 * 隐藏的那个带 `name="flags.er-qol.blocking.<key>"`；两者用 `change` 监听保持同步。
 * `FormDataExtended` 对 `input[type=checkbox]` 一律取 `.checked` **布尔值**
 * （core `client/applications/ux/form-data-extended.mjs:187-196`），
 * `expandObject`（同文件之上 `document-sheet.mjs:507-509`）把点号名字展开成
 * `flags["er-qol"].blocking`；`PrototypeToken` 的 schema 本身就含 `flags`
 * （core `common/data/data.mjs:614-616` 的 `included` 集合里有 `"flags"`），
 * 因此 Actor 原型这条路径也能原样落地。
 *
 * 这样做的好处：镜像始终提交 4 个布尔值，因此**取消勾选一定能落盘**（不会残留旧值）。
 *
 * 关于"陷阱"的准确说法（独立复核第十一轮的结论，别照抄旧笔记）：
 * core v14 的 `FormDataExtended` 会显式遍历 `form.elements` 并读 `checkbox.checked`，
 * 所以**未勾选的具名 checkbox 也会提交 `false`** —— 那条"陷阱"在 v14 不成立。
 * 只有**原生 `FormData` 语义**（浏览器规范）才会把未勾选项整个丢掉。
 * 也就是说镜像方案是**面向未来的防御**（core 若改用原生语义就会踩坑），而不是当前必需。
 * 好处是无需依赖 libWrapper（本模组目前也没有该依赖），也不用改 core 的任何 prototype。
 *
 * @module er-qol/scripts/token-blocking
 */

import {MODULE_ID} from "./settings.mjs";
import {localize} from "./region-common.mjs";

/* -------------------------------------------------------------------------- */
/*  常量                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 承载配置的 flag 键：`flags["er-qol"].blocking`。
 *
 * 与 `TokenDocument` / `PrototypeToken` 的 `flags` 字段同形，四个通道各一个布尔值。
 */
export const TOKEN_BLOCKING_FLAG = "blocking";

/** 四个阻挡通道；**数组顺序即配置界面的显示顺序**。 */
export const TOKEN_BLOCKING_KEYS = Object.freeze(["move", "sight", "sound", "light"]);

/** 默认值（全部不阻挡）。任何缺失/非法数据都回退到它。 */
export const DEFAULT_TOKEN_BLOCKING = Object.freeze({
  move: false,
  sight: false,
  sound: false,
  light: false
});

/** 本模块登记在 `canvas.edges` 里的边 id 前缀（清理时按它扫描）。 */
const EDGE_ID_PREFIX = `${MODULE_ID}.tokenBlocking.`;

/** 边的类型：与 core 墙体一致，`_determineEdgeTypes` 对 "wall" 默认 include（clockwise-sweep.mjs:161）。 */
const EDGE_TYPE_WALL = "wall";

/** 新 tab 的 id（`data-tab`）。 */
const TAB_ID = "erqolBlocking";

/** 新 tab 的图标（FontAwesome 6 free solid）。 */
const TAB_ICON = "fa-solid fa-vector-square";

/** 本地化键前缀（键名由 Lead 在 `lang/*.json` 提供）。 */
const LOC = "ERQOL.TOKEN_BLOCKING";

/** `getTokenBlockingEdges` 生成的 4 条边的语义顺序（索引即 id 后缀）。 */
const EDGE_ORDER = Object.freeze(["top", "right", "bottom", "left"]);

/** 需要联动刷新的画布/文档钩子（core 中均真实存在）。 */
const REFRESH_HOOKS = Object.freeze([
  "canvasReady",      // client/hooks.mjs:228
  "drawToken",        // client/canvas/placeables/placeable-object.mjs:546
  "refreshToken",     // client/canvas/placeables/placeable-object.mjs:440
  "destroyToken",     // client/canvas/placeables/placeable-object.mjs:510
  "updateToken",      // client/data/client-backend.mjs:337
  "updateActor",      // 原型 Token 改了 → 之后新建的 Token 也要算
  "deleteToken"       // 同上，删除路径
]);

/* -------------------------------------------------------------------------- */
/*  模块级状态                                                                   */
/* -------------------------------------------------------------------------- */

/** `installTokenBlocking()` 的幂等守卫。 */
let installed = false;

/** 是否已排入一次批量刷新（`requestAnimationFrame` 节流标记）。 */
let refreshQueued = false;

/** 刷新代次：`canvasTearDown` 时自增，作废拆除前排入的回调。 */
let refreshEpoch = 0;

/** 上一次登记的边界快照（只用于判断"要不要刷感知层"，不影响边的写入）。 */
let lastSnapshot = "";

/** 是否已经提示过"找不到光照 tab"（避免每次渲染刷屏）。 */
let warnedMissingTab = false;

/* -------------------------------------------------------------------------- */
/*  纯函数：读取配置（可独立自测）                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 读取并规范化一个文档的"像墙一样阻挡"配置。
 *
 * 入参可以是 `TokenDocument`，也可以是 `Actor`（此时读它的 `prototypeToken`——
 * Actor 配置页的「原型 Token」与场景 Token 共用同一套 flag 形状）。
 *
 * 严格只接受布尔值：`true` 才算勾选，其它类型（`1` / `"true"` / 对象…）一律按 false，
 * 避免旧数据或手改数据把通道意外打开。
 *
 * @param {TokenDocument|PrototypeToken|Actor|null|undefined} doc 文档或 Actor
 * @returns {{move: boolean, sight: boolean, sound: boolean, light: boolean}} **新对象**，只含 4 个键
 */
export function getTokenBlocking(doc) {
  const blocking = {...DEFAULT_TOKEN_BLOCKING};
  const raw = getModuleFlags(doc)?.[TOKEN_BLOCKING_FLAG];
  if ( !raw || (typeof raw !== "object") ) return blocking;

  for ( const key of TOKEN_BLOCKING_KEYS ) {
    if ( raw[key] === true ) blocking[key] = true;
  }
  return blocking;
}

/**
 * 判断一份配置是否"什么都没挡"（全 false 或缺失）。
 *
 * @param {object|null|undefined} blocking 配置对象
 * @returns {boolean} 全 false / 缺失 → true
 */
export function isEmptyTokenBlocking(blocking) {
  if ( !blocking || (typeof blocking !== "object") ) return true;
  return TOKEN_BLOCKING_KEYS.every(key => blocking[key] !== true);
}

/* -------------------------------------------------------------------------- */
/*  纯函数：几何（可独立自测）                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 生成某个文档的边界线段数组（矩形四条边），交给调用方注入 `Edge` 类。
 *
 * 本函数**不注册、不改任何状态**，纯粹按配置算几何，便于在 Node 里自测。
 *
 * 坐标约定：`doc.x` / `doc.y` 是**左上角**（像素），尺寸也按像素；
 * 因此矩形是 `[x, y] - [x + width, y + height]`，四条边按
 * 上 → 右 → 下 → 左 排列，id 后缀 0..3。
 *
 * @param {TokenDocument|PrototypeToken|Actor|null|undefined} doc 文档或 Actor
 * @param {object} [options] 选项
 * @param {Function} [options.EdgeClass] `foundry.canvas.geometry.edges.Edge`（**必填**，缺失则返回空数组）
 * @param {number} [options.width] 像素宽度（给了就是权威值，非正 → 空数组）；缺省时取 `doc.object.w` → `doc.getSize().width` → 网格尺寸 × `doc.width`
 * @param {number} [options.height] 像素高度（同上）；缺省时取 `doc.object.h` → `doc.getSize().height` → 网格尺寸 × `doc.height`
 * @param {number} [options.padding=0] 四周外扩的像素数（可为负，结果非正时返回空数组）
 * @param {number} [options.elevation] 覆盖边端点高度；缺省取 `doc.elevation`
 * @returns {Array<object>} `Edge` 实例数组；配置为空 / 缺 EdgeClass / 几何非法 → `[]`
 */
export function getTokenBlockingEdges(doc, options = {}) {
  const {EdgeClass, width, height, padding = 0, elevation} = options;
  if ( !doc || (typeof EdgeClass !== "function") ) return [];

  const blocking = getTokenBlocking(doc);
  if ( isEmptyTokenBlocking(blocking) ) return [];

  const rect = getBlockingRectangle(doc, {width, height, padding});
  if ( !rect ) return [];

  // 三个高度一起取，保持 3D 语义（不写死 0；core 的 Edge 是 2D 的，高度信息留在端点上）。
  const z = resolveElevation(doc, elevation);
  const corners = [
    {x: rect.left, y: rect.top, elevation: z},
    {x: rect.right, y: rect.top, elevation: z},
    {x: rect.right, y: rect.bottom, elevation: z},
    {x: rect.left, y: rect.bottom, elevation: z}
  ];

  const sense = getSenseTypes();
  const direction = getDirectionBoth();
  const baseId = `${EDGE_ID_PREFIX}${doc.id ?? doc.uuid ?? "unknown"}`;

  const edges = [];
  for ( let index = 0; index < EDGE_ORDER.length; index += 1 ) {
    const a = corners[index];
    const b = corners[(index + 1) % corners.length];
    edges.push(new EdgeClass(a, b, {
      id: `${baseId}.${index}`,
      type: EDGE_TYPE_WALL,
      direction,
      move: blocking.move ? sense.normal : sense.none,
      sight: blocking.sight ? sense.normal : sense.none,
      sound: blocking.sound ? sense.normal : sense.none,
      light: blocking.light ? sense.normal : sense.none
    }));
  }
  return edges;
}

/* -------------------------------------------------------------------------- */
/*  边界登记：写进 canvas.edges                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 重建本模组在 `canvas.edges` 里登记的 Token 边界。
 *
 * 行为：先按 id 前缀清掉上一次登记的边，再把当前场景里所有"有阻挡配置"的 Token
 * 边界写回去（`CanvasEdges#set` 内部会维护四叉树与交点脏标记）。
 * 只有"边集合真的变了"时才触发一次感知刷新与移动路径重算，避免每帧空刷。
 *
 * 画布未就绪 / `canvas.edges` 不存在 / 场景的边还没初始化（`initializedEdges === false`）
 * 时**直接返回**，不抛错——`initializeEdges` 钩子随后会再调一次。
 *
 * @returns {void}
 */
export function refreshTokenBlockingEdges() {
  const edges = globalThis.canvas?.edges;
  if ( !edges || (typeof edges.set !== "function") || (typeof edges.delete !== "function") ) return;

  const scene = globalThis.canvas?.scene;
  if ( scene && (scene.initializedEdges === false) ) return;

  const removed = removeRegisteredEdges(edges);
  const built = collectTokenBlockingEdges();

  let added = 0;
  for ( const edge of built ) {
    try {
      edges.set(edge.id, edge);
      added += 1;
    } catch ( err ) {
      console.warn(`${MODULE_ID} | 登记 Token 边界失败（${edge.id}）`, err);
    }
  }

  const snapshot = JSON.stringify(built.map(edgeSnapshot));
  if ( (snapshot !== lastSnapshot) || (removed !== added) ) {
    lastSnapshot = snapshot;
    notifyCanvasUpdate();
  }
}

/* -------------------------------------------------------------------------- */
/*  钩子安装                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 安装本功能（幂等）。
 *
 * 由 `init.mjs` 在 `Hooks.once("ready")` 中调用；本模块**不**自己注册 init/ready 钩子，
 * 保证钩子安装点唯一。重复调用不会重复挂钩子。
 *
 * 挂两类钩子：
 * 1. 边界联动：Token 增删改 / 画布就绪与拆除 / `initializeEdges`（写边的安全时刻）；
 * 2. 配置界面：`renderTokenConfig`（场景 Token）与 `renderPrototypeTokenConfig`（Actor 原型 Token）。
 *
 * @returns {void}
 */
export function installTokenBlocking() {
  if ( installed ) return;
  installed = true;

  for ( const hook of REFRESH_HOOKS ) Hooks.on(hook, scheduleTokenBlockingRefresh);

  // 场景（重新）初始化边界：这是唯一可以安全写入 canvas.edges 的时刻，必须同步执行。
  Hooks.on("initializeEdges", onInitializeEdges);
  Hooks.on("canvasTearDown", onCanvasTearDown);

  // 配置界面：两个配置页是两个不同的类，必须分别挂钩子（见文件头说明）。
  Hooks.on("renderTokenConfig", onRenderTokenConfig);
  Hooks.on("renderPrototypeTokenConfig", onRenderTokenConfig);

  // ready 之后画布可能已经就绪（installTokenBlocking 就是在 ready 里被调用的）。
  if ( globalThis.canvas?.ready ) scheduleTokenBlockingRefresh();
}

/* -------------------------------------------------------------------------- */
/*  内部：配置读取辅助                                                            */
/* -------------------------------------------------------------------------- */

/**
 * 取承载本模组 flag 的那个命名空间，即 `flags["er-qol"]`。
 *
 * - `Actor`（有 `prototypeToken`）→ 读原型的 `flags`；
 * - `TokenDocument` / `PrototypeToken` → 读自身的 `flags`。
 *
 * @param {object|null|undefined} doc 文档
 * @returns {object|null} `flags["er-qol"]` 对象，取不到时为 null
 */
function getModuleFlags(doc) {
  if ( !doc || (typeof doc !== "object") ) return null;

  const prototype = doc.prototypeToken;
  if ( prototype && (typeof prototype === "object") ) return asObject(asObject(prototype.flags)?.[MODULE_ID]);
  return asObject(asObject(doc.flags)?.[MODULE_ID]);
}

/**
 * 把候选值收窄成"普通对象"，否则返回 null。
 *
 * @param {*} value 候选值
 * @returns {object|null} 普通对象或 null
 */
function asObject(value) {
  return (value && (typeof value === "object")) ? value : null;
}

/* -------------------------------------------------------------------------- */
/*  内部：几何辅助                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 算出 Token 的矩形边界（左上角 + 右下角，像素）。
 *
 * @param {object} doc 文档
 * @param {object} options 选项
 * @param {number} [options.width] 像素宽度
 * @param {number} [options.height] 像素高度
 * @param {number} [options.padding] 外扩像素
 * @returns {{left: number, top: number, right: number, bottom: number}|null} 矩形，非法时为 null
 */
function getBlockingRectangle(doc, {width, height, padding = 0} = {}) {
  const object = doc.object ?? null;
  const size = (typeof doc.getSize === "function") ? doc.getSize() : null;
  const gridSize = resolveGridSize();

  // 显式传入的尺寸是权威值：给了但非法（<= 0 / 非有限）就判定为"尺寸非正"→ 不生成边，
  // 而不是悄悄回退到别的来源（否则"传 0"会变成"用网格尺寸"，与调用方意图不符）。
  const pixelWidth = resolvePixelSize(width, [
    object?.w,
    size?.width,
    (gridSize === null) ? null : gridSize * Number(doc.width)
  ]);
  const pixelHeight = resolvePixelSize(height, [
    object?.h,
    size?.height,
    (gridSize === null) ? null : gridSize * Number(doc.height)
  ]);
  if ( (pixelWidth === null) || (pixelHeight === null) ) return null;

  const x = toFiniteNumber(doc.x);
  const y = toFiniteNumber(doc.y);
  if ( (x === null) || (y === null) ) return null;

  const pad = toFiniteNumber(padding) ?? 0;
  const left = x - pad;
  const top = y - pad;
  const right = x + pixelWidth + pad;
  const bottom = y + pixelHeight + pad;
  if ( !(right > left) || !(bottom > top) ) return null;

  return {left, top, right, bottom};
}

/**
 * 解析边端点的 elevation：`options.elevation ?? doc.elevation ?? 0`（非有限数回退 0）。
 *
 * @param {object} doc 文档
 * @param {number|undefined} override 显式覆盖值
 * @returns {number} 合法的高度
 */
function resolveElevation(doc, override) {
  const raw = ((override === undefined) || (override === null)) ? doc?.elevation : override;
  const value = toFiniteNumber(raw);
  return (value === null) ? 0 : value;
}

/**
 * 当前的网格像素尺寸（`canvas.grid.sizeX`，退到 `canvas.grid.size`）。
 *
 * @returns {number|null} 正数尺寸或 null
 */
function resolveGridSize() {
  const grid = globalThis.canvas?.grid ?? null;
  const value = toFiniteNumber(grid?.sizeX ?? grid?.size);
  return ((value === null) || (value <= 0)) ? null : value;
}

/**
 * 取第一个为正的有限数（用于"我优先用哪个尺寸来源"）。
 *
 * @param {...*} candidates 候选值，按优先级排列
 * @returns {number|null} 正数或 null
 */
function firstPositive(...candidates) {
  for ( const candidate of candidates ) {
    const value = toFiniteNumber(candidate);
    if ( (value !== null) && (value > 0) ) return value;
  }
  return null;
}

/**
 * 解析像素尺寸：显式值优先且必须合法，否则按回退顺序取第一个正数。
 *
 * @param {*} explicit 调用方显式传入的像素尺寸（`options.width` / `options.height`）
 * @param {Array<*>} fallbacks 回退来源，按优先级排列
 * @returns {number|null} 正数或 null（null 表示"尺寸非正/未知"）
 */
function resolvePixelSize(explicit, fallbacks) {
  if ( (explicit !== undefined) && (explicit !== null) && (explicit !== "") ) {
    const value = toFiniteNumber(explicit);
    return ((value !== null) && (value > 0)) ? value : null;
  }
  return firstPositive(...fallbacks);
}

/**
 * 转成有限数。
 *
 * @param {*} value 候选值
 * @returns {number|null} 有限数或 null
 */
function toFiniteNumber(value) {
  if ( (value === null) || (value === undefined) || (value === "") ) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * 取 `CONST.EDGE_SENSE_TYPES` 的两个取值。
 *
 * `NONE` 取不到时回退 0（任务约定；本机 core 也是 0，
 * 见 `common/constants.mjs` 的 `EDGE_SENSE_TYPES`）。
 *
 * @returns {{normal: number, none: number}} 通道取值
 */
function getSenseTypes() {
  const types = globalThis.CONST?.EDGE_SENSE_TYPES ?? null;
  return {normal: types?.NORMAL, none: types?.NONE ?? 0};
}

/**
 * 取 `CONST.EDGE_DIRECTIONS.BOTH`（两个方向都挡）。
 *
 * @returns {number} `BOTH` 的数值；常量缺失时回退 0
 */
function getDirectionBoth() {
  return globalThis.CONST?.EDGE_DIRECTIONS?.BOTH ?? 0;
}

/* -------------------------------------------------------------------------- */
/*  内部：边界收集                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 收集当前场景里所有需要登记的边界边。
 *
 * @returns {Array<object>} `Edge` 实例数组
 */
function collectTokenBlockingEdges() {
  const EdgeClass = getEdgeClass();
  if ( !EdgeClass ) return [];

  const edges = [];
  for ( const doc of collectBlockingDocuments() ) {
    for ( const edge of getTokenBlockingEdges(doc, {EdgeClass}) ) edges.push(edge);
  }
  return edges;
}

/**
 * 收集需要参与碰撞的文档：当前场景的 Token，按当前 Level 过滤。
 *
 * 用 `canvas.edges`（= 当前 Level 的边集合）就必须同时按 Level 过滤，
 * 否则别的楼层的 Token 会挡到本层——所以走 `TokenDocument#includedInLevel`
 * （core `client/documents/token.mjs:399-408`）。
 *
 * @returns {Array<TokenDocument>} 文档数组
 */
function collectBlockingDocuments() {
  const tokens = globalThis.canvas?.scene?.tokens;
  if ( !tokens ) return [];

  const level = globalThis.canvas?.level ?? null;
  return toArray(tokens).filter(doc => {
    if ( !doc ) return false;
    if ( !level || (typeof doc.includedInLevel !== "function") ) return true;
    return doc.includedInLevel(level);
  });
}

/**
 * 把数组 / `Collection` / 类数组统一成数组。
 *
 * Foundry 的 `Collection` 是 Map 子类但迭代**值**（core `common/utils/collection.mjs`）。
 *
 * @param {*} value 候选集合
 * @returns {Array<*>} 数组
 */
function toArray(value) {
  if ( !value ) return [];
  if ( Array.isArray(value) ) return value;
  if ( typeof value[Symbol.iterator] === "function" ) return [...value];
  if ( typeof value === "object" ) return Object.values(value);
  return [];
}

/**
 * 取 `Edge` 类：`foundry.canvas.geometry.edges.Edge`（与 core 自己的边来源同一取法，
 * 见 `client/canvas/sources/point-effect-source.mjs:214`）。
 *
 * @returns {Function|null} `Edge` 类或 null
 */
function getEdgeClass() {
  return globalThis.foundry?.canvas?.geometry?.edges?.Edge ?? null;
}

/**
 * 删除上一次由本模组登记的边（按 id 前缀扫描）。
 *
 * 前缀扫描比记一份 id 列表更稳：`Scene#_resetEdges()` 会清空 `level.edges`，
 * 之后 `initializeEdges` 钩子重跑时不存在"过期 id 列表"的问题。
 *
 * @param {Map} edges `canvas.edges`
 * @returns {number} 实际删掉的条数
 */
function removeRegisteredEdges(edges) {
  if ( typeof edges.keys !== "function" ) return 0;

  let removed = 0;
  const ids = [...edges.keys()].filter(id => String(id).startsWith(EDGE_ID_PREFIX));
  for ( const id of ids ) {
    if ( edges.delete(id) ) removed += 1;
  }
  return removed;
}

/**
 * 生成一条边的比较快照（判断"变没变"用，不影响边的写入）。
 *
 * @param {object} edge `Edge` 实例
 * @returns {Array<*>} 快照
 */
function edgeSnapshot(edge) {
  return [
    edge.id,
    edge.a?.x, edge.a?.y, edge.b?.x, edge.b?.y,
    edge.move, edge.sight, edge.sound, edge.light, edge.direction
  ];
}

/**
 * 触发一次感知刷新与移动路径重算（只在边界确有变化时调用）。
 *
 * 注意这里比任务书给出的 4 个键多了一个 `refreshSounds`：声音也是本功能的 4 个通道之一，
 * 而 core 的墙体声音遮挡正是靠 `refreshSounds` 重新计算
 * （对照 `region-walls.mjs` 的 `#refreshCanvas()` 也传了 `refreshSounds`）。
 * 不带它的话"只勾声音"的改动不会立刻生效。
 *
 * @returns {void}
 */
function notifyCanvasUpdate() {
  const canvas = globalThis.canvas;
  if ( !canvas ) return;

  if ( canvas.ready && canvas.perception?.update ) {
    try {
      canvas.perception.update({
        initializeLighting: true,
        initializeVision: true,
        refreshLighting: true,
        refreshVision: true,
        refreshSounds: true
      });
    } catch ( err ) {
      console.warn(`${MODULE_ID} | 刷新感知层失败`, err);
    }
  }

  try {
    canvas.tokens?.recalculatePlannedMovementPaths?.();
  } catch ( err ) {
    console.warn(`${MODULE_ID} | 重算计划移动路径失败`, err);
  }
}

/* -------------------------------------------------------------------------- */
/*  内部：节流与钩子回调                                                          */
/* -------------------------------------------------------------------------- */

/**
 * 排入一次批量刷新（节流）。
 *
 * `drawToken` / `refreshToken` 会对每个 Token 各触发一次；Token 多的场景逐次全量重刷
 * 会卡顿，因此这里合并成"一帧一次"。无 `requestAnimationFrame` 的环境同步执行（便于自测）。
 *
 * @returns {void}
 */
function scheduleTokenBlockingRefresh() {
  if ( refreshQueued ) return;
  refreshQueued = true;

  const epoch = refreshEpoch;
  const run = () => {
    refreshQueued = false;
    // 排入后画布被拆掉（epoch 变化）时丢弃这次刷新。
    if ( epoch !== refreshEpoch ) return;
    refreshTokenBlockingEdges();
  };

  if ( typeof requestAnimationFrame === "function" ) {
    requestAnimationFrame(run);
    return;
  }
  run();
}

/**
 * `initializeEdges` 钩子：场景（重新）初始化边时同步登记。
 *
 * 这里必须**同步**执行：它是最早可以安全写 `canvas.edges` 的时刻，
 * 也是 `Scene#_resetEdges()` 之后的恢复点（core `client/documents/scene.mjs:949-967`）。
 *
 * @param {Scene} scene 正在初始化边的场景
 * @returns {void}
 */
function onInitializeEdges(scene) {
  const current = globalThis.canvas?.scene ?? null;
  if ( current && (scene !== current) ) return;
  refreshTokenBlockingEdges();
}

/**
 * `canvasTearDown` 钩子：作废排入中的刷新并清空快照。
 *
 * `canvas.edges` 在拆除后已不存在，这里不需要（也无法）逐条删除。
 *
 * @returns {void}
 */
function onCanvasTearDown() {
  refreshEpoch += 1;
  refreshQueued = false;
  lastSnapshot = "";
}

/* -------------------------------------------------------------------------- */
/*  内部：配置界面                                                               */
/* -------------------------------------------------------------------------- */

/**
 * render 钩子：Token 配置页 / Actor 原型 Token 配置页渲染后插入「阻挡」tab。
 *
 * 钩子签名来自 core：`Hooks.callAll("render" + ClassName, app, element, context, options)`
 * （core `client/applications/api/application.mjs:591-594` 与 :1724-1731），
 * 其中 `element` 就是这个 ApplicationV2 的最外层元素；Token 配置页的 `tag` 是 `"form"`
 * （core `client/applications/api/document-sheet.mjs:49`、
 * `client/applications/sheets/token/prototype-config.mjs:30`），
 * 所以第二个参数就是 `<form>` 本体（不是 v11 的 jQuery 对象）。
 *
 * @param {object} app ApplicationV2 实例（`TokenConfig` 或 `PrototypeTokenConfig`）
 * @param {HTMLElement} html 应用最外层元素（Token 配置页即为 `<form>`）
 * @param {object} context 渲染上下文
 * @param {object} options 渲染选项（`parts` 用来区分整页重绘与局部重绘）
 * @returns {void}
 */
function onRenderTokenConfig(app, html, context, options) {
  try {
    injectTokenBlockingTab(app, html, options);
  } catch ( err ) {
    console.error(`${MODULE_ID} | 在 Token 配置页插入「阻挡」tab 失败`, err);
  }
}

/**
 * 把「阻挡」tab 插到光照 tab 之后，并同步补上导航按钮。
 *
 * 幂等策略：
 * - 整页重绘（`options.parts` 含 `"tabs"`，或拿不到 `options`）→ 用文档当前值**重建** tab，
 *   与刚重建的表单保持一致；
 * - 局部重绘（只换了光照/外观等 part）→ 保留已经插好的 tab，避免把用户刚勾的状态冲掉。
 *
 * @param {object} app ApplicationV2 实例
 * @param {HTMLElement} html 应用最外层元素
 * @param {object} [options] 渲染选项
 * @returns {void}
 */
function injectTokenBlockingTab(app, html, options) {
  const root = html?.querySelector ? html : null;
  if ( !root ) return;

  const anchor = findTabAnchor(root);
  if ( !anchor ) {
    warnMissingTab();
    return;
  }

  // data-group 从真实 DOM 读，绝不写死（core 的 token 配置页当前是 "sheet"）。
  const group = anchor.getAttribute?.("data-group") || "sheet";
  const rebuild = !Array.isArray(options?.parts) || options.parts.includes("tabs");

  const existing = root.querySelector(`.tab[data-tab="${TAB_ID}"]`);
  if ( existing && !rebuild ) return;
  existing?.remove?.();

  const blocking = getTokenBlocking(resolveConfigDocument(app));
  const rootId = String(app?.id ?? "erqol-token-blocking");
  anchor.insertAdjacentHTML("afterend", renderBlockingTab(group, blocking, rootId));
  bindBlockingCheckboxes(root.querySelector(`.tab[data-tab="${TAB_ID}"]`));

  const nav = root.querySelector(".tabs");
  if ( !nav || nav.querySelector(`[data-tab="${TAB_ID}"]`) ) return;
  const lightNav = nav.querySelector('[data-tab="light"]');
  const markup = renderBlockingTabButton(group);
  if ( lightNav ) lightNav.insertAdjacentHTML("afterend", markup);
  else nav.insertAdjacentHTML("beforeend", markup);
}

/**
 * 找插入锚点：优先光照 tab；找不到时退化到最后一个 tab（绝不整块不生效）。
 *
 * @param {HTMLElement} root 应用最外层元素
 * @returns {HTMLElement|null} 锚点元素
 */
function findTabAnchor(root) {
  const light = root.querySelector('.tab[data-tab="light"]');
  if ( light ) return light;

  const tabs = root.querySelectorAll?.(".tab[data-group]");
  if ( tabs?.length ) return tabs[tabs.length - 1];
  return null;
}

/**
 * 取配置界面正在编辑的文档。
 *
 * `app.token` 对两个类都可用（`TokenConfig` → `_preview ?? document`，
 * `PrototypeTokenConfig` → `_preview ?? prototype`），且 `_preview` 正是表单渲染所用的数据源，
 * 所以它比 `app.document` 更贴合界面上显示的值。
 *
 * @param {object} app ApplicationV2 实例
 * @returns {object|null} 文档
 */
function resolveConfigDocument(app) {
  if ( !app ) return null;
  try {
    return app.token ?? app.document ?? app.actor?.prototypeToken ?? null;
  } catch ( err ) {
    return app.document ?? null;
  }
}

/**
 * 生成「阻挡」tab 的内容 HTML（4 个配置项 + 4 个隐藏镜像 checkbox）。
 *
 * 每个配置项渲染两个 checkbox：
 * - 可见的那个**不带 name**，只负责界面（`data-erqol-blocking="<key>"` 供同步定位）；
 * - 隐藏的那个带 `name="flags.er-qol.blocking.<key>"`，是**唯一**参与提交的字段。
 *
 * 这样即使 4 项全部取消勾选，提交数据里依然有 4 个 `false`。
 *
 * 注意（独立复核第十一轮的准确结论）：core v14 的 `FormDataExtended` 会显式读
 * `checkbox.checked`，**未勾选的具名 checkbox 也会提交 `false`** —— 所以"只挂可见 checkbox
 * 就会提交不上去"在当前版本**并不成立**；只有原生 `FormData` 语义才会丢字段。
 * 镜像方案因此是**面向未来的防御**（并且对两种语义都安全）。
 *
 * @param {string} group tab 组名（从 DOM 读出）
 * @param {object} blocking 当前配置
 * @param {string} rootId 应用 id，用于给 label/input 生成唯一 id
 * @returns {string} HTML 字符串
 */
function renderBlockingTab(group, blocking, rootId) {
  const rows = TOKEN_BLOCKING_KEYS.map(key => {
    const fieldId = `${rootId}-erqol-blocking-${key}`;
    const checked = blocking[key] ? " checked" : "";
    return `
        <div class="form-group">
          <label for="${escapeHtml(fieldId)}">${escapeHtml(localize(`${LOC}.${key}.label`))}</label>
          <div class="form-fields">
            <input type="checkbox" id="${escapeHtml(fieldId)}" data-erqol-blocking="${key}"${checked}>
            <input type="checkbox" name="${escapeHtml(hiddenFieldName(key))}" hidden${checked}>
          </div>
          <p class="hint">${escapeHtml(localize(`${LOC}.${key}.hint`))}</p>
        </div>`;
  }).join("");

  return `<div class="tab scrollable" data-group="${escapeHtml(group)}" data-tab="${TAB_ID}">
      <fieldset>
        <legend>${escapeHtml(localize(`${LOC}.legend`))}</legend>
        <p class="hint">${escapeHtml(localize(`${LOC}.hint`))}</p>${rows}
      </fieldset>
    </div>`;
}

/**
 * 生成 tab 导航按钮 HTML。
 *
 * 结构与 core 的 `templates/generic/tab-navigation.hbs:4-9` 一致：`data-action="tab"` +
 * `data-group` + `data-tab` + `<i inert>` + `<span>`。多出来的 `class="item"` 只是沿用
 * v13 的命名习惯（v14 的样式是属性选择器 `body.game .app .tabs.sheet-tabs [data-tab]`，
 * 不依赖这个类，加上无害）。
 *
 * 内层 `<span>` 也带上 `data-action/data-group/data-tab`：core 的 `_onClickTab`
 * 直接读 `event.target.dataset`（core `application.mjs:1974-1976`，没走
 * `closest("[data-action]")` 得到的那个节点），不给内层加就会出现"点标签文字没反应"。
 *
 * @param {string} group tab 组名
 * @returns {string} HTML 字符串
 */
function renderBlockingTabButton(group) {
  const attrs = `data-action="tab" data-group="${escapeHtml(group)}" data-tab="${TAB_ID}"`;
  return `<a class="item" ${attrs}><i class="${TAB_ICON}" inert></i>`
    + `<span ${attrs}>${escapeHtml(localize(`${LOC}.tab`))}</span></a>`;
}

/**
 * 让可见 checkbox 与隐藏镜像 checkbox 保持同步。
 *
 * 用户交互路径由 `change` 事件保证（`hidden.checked = visible.checked`），
 * 因此无论 core 在哪一刻读表单，提交值都是当前界面状态。
 *
 * @param {HTMLElement} tabElement 刚插入的 tab 元素
 * @returns {void}
 */
function bindBlockingCheckboxes(tabElement) {
  if ( !tabElement?.querySelector ) return;

  for ( const key of TOKEN_BLOCKING_KEYS ) {
    const visible = tabElement.querySelector(`[data-erqol-blocking="${key}"]`);
    const mirror = tabElement.querySelector(`input[name="${hiddenFieldName(key)}"]`);
    if ( !visible || !mirror ) continue;

    const sync = () => {
      mirror.checked = visible.checked;
    };
    visible.addEventListener?.("change", sync);
    sync();
  }
}

/**
 * 隐藏镜像字段的 name（展开后即 `flags["er-qol"].blocking.<key>`）。
 *
 * @param {string} key 通道名
 * @returns {string} 表单字段名
 */
function hiddenFieldName(key) {
  return `flags.${MODULE_ID}.${TOKEN_BLOCKING_FLAG}.${key}`;
}

/**
 * 提示一次"找不到可插入的 tab"（避免每次渲染刷屏）。
 *
 * @returns {void}
 */
function warnMissingTab() {
  if ( warnedMissingTab ) return;
  warnedMissingTab = true;
  console.warn(`${MODULE_ID} | Token 配置页里找不到可插入的 tab（预期有 data-tab="light" 的 tab），`
    + "「阻挡」配置项本轮没有插入。");
}

/**
 * HTML 转义。
 *
 * @param {*} value 原始值
 * @returns {string} 转义后的文本
 */
function escapeHtml(value) {
  const text = String(value ?? "");
  const escape = globalThis.foundry?.utils?.escapeHTML;
  if ( typeof escape === "function" ) return escape(text);

  const map = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"};
  return text.replace(/[&<>"']/g, ch => map[ch]);
}
