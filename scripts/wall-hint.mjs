/**
 * er-qol 新增功能：墙体提示线（Wall Hint）。
 *
 * 目的：墙体只在"墙体"图层绘制，玩家在 Token / 光照 / 地形等图层上看不到真实墙线。
 * 本模块把每面墙的线段**再画一遍**，挂到 `canvas.interface`（InterfaceCanvasGroup：
 * 在所有图层之上、随世界变换），从而在任何图层上都能提示墙的真实位置。
 *
 * ## 为什么必须用"统一颜色"（本功能最关键的一点）
 *
 * Foundry 的墙体颜色由 `Wall#_getWallColor()` 按墙的类别决定，其中**密门（`secret`）**
 * 的类别色是 `0xA612D4`（紫色），普通门/墙各自有别的颜色。如果这里复用核心的颜色逻辑，
 * 画出来的提示线就会**按类别上色**——密门那根线会变成紫色，等于当着玩家的面把密门标出来。
 * 因此本模块**只**使用自己的单一可配置颜色（`wallHintColor`），颜色与墙体类别完全无关。
 *
 * 另外：**所有类型的墙都照常画**，密门也不例外——正因为它和其他墙长得一模一样，
 * 才不会被认出来；反过来把密门排除掉，缺一根线的位置反而暴露了它。
 *
 * ## 结构
 *
 * - 纯函数（颜色解析 / 端点提取 / 过滤 / 显示判定）单独导出，便于在 Node 里自测；
 * - 钩子与重绘走 `installWallHint()`（幂等，由 `init.mjs` 在 `ready` 时调用一次）；
 * - 本文件**不注册**任何模组设置（设置统一在 `scripts/settings.mjs`），只读设置。
 *
 * @module er-qol/scripts/wall-hint
 */

// `MODULE_ID` 与设置读取都从 settings.mjs 取：该文件统一注册设置，并 re-export 模组 id，
// 因此本模块只需要一个 import 点就能拿到全部依赖。
import {
  MODULE_ID,
  getBoolSetting,
  getNumberSetting,
  getStringSetting,
  getArraySetting
} from "./settings.mjs";

/* -------------------------------------------------------------------------- */
/*  常量                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 本功能使用的设置键。
 *
 * 与 `scripts/settings.mjs` 中 `SETTINGS.WALL_HINT` 的键名一一对应；
 * 这里再导出一次是为了让本模块的读键点在代码里可定位（并把常量交给自测断言）。
 */
export const WALL_HINT_SETTINGS = Object.freeze({
  ENABLED: "wallHint",
  COLOR: "wallHintColor",
  WIDTH: "wallHintWidth",
  OPACITY: "wallHintOpacity",
  SCOPE: "wallHintScope",
  BLOCKING: "wallHintBlocking"
});

/** `wallHintScope` 的取值。 */
export const WALL_HINT_SCOPES = Object.freeze({
  /** 只在非墙体图层显示（切到墙体图层时隐藏）。 */
  OTHER_LAYERS: "otherLayers",
  /** 任何图层都显示。 */
  ALWAYS: "always"
});

/**
 * 密门（secret door）的类别色，即 Foundry `Wall.CATEGORY_COLORS.secret`。
 *
 * **仅作为"绝不能画成这个颜色"的对照常量导出给自测使用**，本模块的绘制路径
 * 不会读取它，也不会把它作为颜色回退值。
 */
export const SECRET_DOOR_CATEGORY_COLOR = 0xA612D4;

/** 颜色 / 线宽 / 透明度 / 显示范围的默认回退值（与 settings.mjs 的 default 对齐）。 */
const DEFAULT_COLOR = "#00e5ff";
const DEFAULT_WIDTH = 2;
const DEFAULT_OPACITY = 1;
const DEFAULT_SCOPE = WALL_HINT_SCOPES.OTHER_LAYERS;

/** 提示线容器名（挂在 `canvas.interface` 下，便于定位与自测）。 */
const LAYER_NAME = "erqolWallHint";

/* -------------------------------------------------------------------------- */
/*  模块级状态                                                                   */
/* -------------------------------------------------------------------------- */

/** 钩子是否已安装（`installWallHint()` 的幂等守卫）。 */
let installed = false;

/** 提示线容器，`null` 表示尚未创建（或画布已拆除）。 */
let hintLayer = null;

/** 是否已排入一次批量重绘（节流标记）。 */
let redrawQueued = false;

/** 重绘代次：`canvasTearDown` 时自增，使拆除前排入的 `requestAnimationFrame` 回调失效。 */
let redrawEpoch = 0;

/* -------------------------------------------------------------------------- */
/*  纯函数：颜色、样式、端点、过滤、显示判定（可独立自测）                          */
/* -------------------------------------------------------------------------- */

/**
 * 把颜色设置解析成 PIXI `lineStyle()` 需要的 0xRRGGBB 数字。
 *
 * 支持 `#rgb` / `#rrggbb` / `#rrggbbaa`（8 位时丢弃 alpha，只保留 RGB）以及裸数字；
 * 无法解析时返回 `null`，由调用方回退到默认色——**绝不**把带 `#` 的字符串直接交给 PIXI。
 *
 * @param {string|number} value 颜色设置值
 * @returns {number|null} 0xRRGGBB 数字，无法解析时为 null
 */
export function parseHintColor(value) {
  if ( typeof value === "number" ) {
    return Number.isFinite(value) ? (value & 0xffffff) : null;
  }

  const text = String(value ?? "").trim();
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
  if ( !match ) return null;

  let hex = match[1];
  if ( hex.length === 3 ) hex = hex.replace(/./g, ch => ch + ch);
  if ( hex.length === 8 ) hex = hex.slice(0, 6);
  return Number.parseInt(hex, 16);
}

/**
 * 规范化绘制样式：颜色无法解析时回退默认色，线宽/透明度收敛到合法区间。
 *
 * @param {object} [style] 原始样式
 * @param {string|number} [style.color] 颜色设置值
 * @param {number} [style.width] 线宽（设置范围 1~10）
 * @param {number} [style.opacity] 透明度（设置范围 0.1~1）
 * @returns {{color: number, width: number, opacity: number}} 规范化后的样式
 */
export function normalizeHintStyle({color, width, opacity} = {}) {
  const parsedColor = parseHintColor(color);
  const numericWidth = Number(width);
  const numericOpacity = Number(opacity);

  return {
    color: parsedColor ?? parseHintColor(DEFAULT_COLOR),
    width: Number.isFinite(numericWidth) ? Math.max(1, numericWidth) : DEFAULT_WIDTH,
    opacity: Number.isFinite(numericOpacity) ? Math.min(1, Math.max(0, numericOpacity)) : DEFAULT_OPACITY
  };
}

/**
 * 规范化 `wallHintScope`：未知值一律按"只在非墙体图层显示"处理（更保守，不会常驻挡视线）。
 *
 * @param {string} scope 原始 scope 值
 * @returns {string} `otherLayers` 或 `always`
 */
export function normalizeWallHintScope(scope) {
  return (scope === WALL_HINT_SCOPES.ALWAYS) ? WALL_HINT_SCOPES.ALWAYS : WALL_HINT_SCOPES.OTHER_LAYERS;
}

/**
 * 取出墙体文档的两个端点。
 *
 * **注意 `WallDocument#c` 是扁平数组 `[x0, y0, x1, y1]`**（核心 schema 是
 * `ArrayField(NumberField)` 且校验长度为 4，见 core `common/documents/wall.mjs`），
 * 不是 `{x, y}[]`——按对象取点会让每面墙都解析失败、整个功能静默不画。
 * 本函数同时兼容两种写法，避免上游或其它数据源换表示时再次静默失效：
 *
 * 1. 扁平数组 `[x0, y0, x1, y1]`（真实 `WallDocument`）；
 * 2. 对象数组 `[{x, y}, {x, y}]`（画布对象 `Wall#a` / `Wall#b` 那种形状）；
 * 3. 都拿不到时退回 `wallObject.b` 作为第二端点；
 * 4. 仍不全则返回 `null`（调用方跳过这面墙，而不是画一条错线）。
 *
 * @param {WallDocument} doc 墙体文档
 * @param {Wall|null} [wallObject] 对应的画布对象（`canvas.walls.placeables` 里的元素）
 * @returns {{a: {x: number, y: number}, b: {x: number, y: number}}|null} 端点，缺失时为 null
 */
export function getWallSegment(doc, wallObject = null) {
  const {a, b} = getWallEndpoints(doc?.c);
  const fallbackB = b ?? objectPoint(wallObject?.b);
  if ( !a || !fallbackB ) return null;
  return {a, b: fallbackB};
}

/**
 * 从 `WallDocument#c` 解析两端点，兼容扁平数组与对象数组。
 *
 * @param {Array<number>|Array<{x: number, y: number}>|null|undefined} coords 原始坐标
 * @returns {{a: {x: number, y: number}|null, b: {x: number, y: number}|null}} 两端点
 */
function getWallEndpoints(coords) {
  if ( !Array.isArray(coords) ) return {a: null, b: null};

  // 形态一：扁平数组 [x0, y0, x1, y1]
  if ( typeof coords[0] === "number" ) {
    return {
      a: finitePoint(coords[0], coords[1]),
      b: finitePoint(coords[2], coords[3])
    };
  }

  // 形态二：对象数组 [{x, y}, {x, y}]
  return {
    a: objectPoint(coords[0]),
    b: objectPoint(coords[1])
  };
}

/**
 * 把 `{x, y}` 形状的点转成有限数点。
 *
 * @param {{x: number, y: number}|null|undefined} point 候选点
 * @returns {{x: number, y: number}|null} 合法的点，或 null
 */
function objectPoint(point) {
  if ( !point ) return null;
  return finitePoint(point.x, point.y);
}

/**
 * 用两个分量构造一个有限数点。
 *
 * @param {number} x X 坐标
 * @param {number} y Y 坐标
 * @returns {{x: number, y: number}|null} 合法的点，或 null
 */
function finitePoint(x, y) {
  const px = Number(x);
  const py = Number(y);
  if ( !Number.isFinite(px) || !Number.isFinite(py) ) return null;
  return {x: px, y: py};
}

/**
 * 判断一面墙是否应该画提示线。
 *
 * **不做任何类别判别**：密门、隐形墙、虚体墙都用**同一个颜色**照常画。
 * 原因是"统一颜色"本身就足够——每根线长得一模一样，玩家无法据此分辨哪根是密门；
 * 反过来若把密门排除掉，缺了一根线的位置反而等于把密门标了出来。
 *
 * 唯一的过滤来自设置：`wallHintBlocking`（多选，空集合 = 不过滤）。
 * 勾选了若干"阻挡类型"时，只画**至少阻挡其中一项**的墙（或关系）。
 *
 * @param {WallDocument} doc 墙体文档
 * @param {string[]} [blocking=[]] 需要命中的阻挡类型（`move` / `sight` / `sound` / `light`）
 * @returns {boolean} 应该绘制时返回 true
 */
export function isWallHintEligible(doc, blocking = []) {
  if ( !doc ) return false;
  const wanted = normalizeBlockingTypes(blocking);
  if ( !wanted.length ) return true;
  return wanted.some(type => wallBlocks(doc, type));
}

/** 允许用于过滤的阻挡类型（对应 `WallDocument` 上真实存在的四个通道）。 */
export const WALL_HINT_BLOCKING_TYPES = Object.freeze(["move", "sight", "sound", "light"]);

/**
 * 规范化阻挡类型过滤值：去重、丢掉不认识的值、保持稳定顺序。
 *
 * @param {Iterable<string>|string|undefined} blocking 原始设置值
 * @returns {string[]} 规范化后的类型数组
 */
export function normalizeBlockingTypes(blocking) {
  const values = (blocking === null) || (blocking === undefined)
    ? []
    : (typeof blocking === "string" ? [blocking] : [...blocking]);
  const picked = new Set(values.map(String));
  return WALL_HINT_BLOCKING_TYPES.filter(type => picked.has(type));
}

/**
 * 判断一面墙是否在某个通道上"有阻挡效果"。
 *
 * 判据是"该通道的值不是 `NONE`"（即 `NORMAL` / `LIMITED` / 距离衰减等都算阻挡）。
 *
 * @param {WallDocument} doc 墙体文档
 * @param {string} type 通道名（`move` / `sight` / `sound` / `light`）
 * @returns {boolean} 该通道有阻挡效果时返回 true
 */
export function wallBlocks(doc, type) {
  if ( !doc || !WALL_HINT_BLOCKING_TYPES.includes(type) ) return false;
  return Number(doc[type]) !== getSenseNone();
}

/**
 * 判断当前是否应该因为"正在墙体图层"而隐藏提示线。
 *
 * @param {string} scope `wallHintScope` 设置值
 * @param {boolean} [wallsActive] 墙体图层是否激活；省略时读 `canvas.walls.active`
 * @returns {boolean} 需要隐藏时返回 true
 */
export function shouldHideHintOnWallsLayer(scope, wallsActive) {
  if ( normalizeWallHintScope(scope) === WALL_HINT_SCOPES.ALWAYS ) return false;
  return (typeof wallsActive === "boolean") ? wallsActive : isWallsLayerActive();
}

/* -------------------------------------------------------------------------- */
/*  内部辅助                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 取 `CONST.EDGE_SENSE_TYPES.NONE`（表示该墙在该通道上完全不生效，本机为 0）。
 *
 * @returns {number} `NONE` 的数值；常量缺失时回退 0
 */
function getSenseNone() {
  return globalThis.CONST?.EDGE_SENSE_TYPES?.NONE ?? 0;
}

/**
 * 墙体图层当前是否激活。
 *
 * @returns {boolean} 激活时返回 true
 */
function isWallsLayerActive() {
  try {
    return canvas?.walls?.active === true;
  } catch ( err ) {
    return false;
  }
}

/**
 * 取得（必要时创建）提示线容器。
 *
 * 父容器必须是 `canvas.interface`：它是 InterfaceCanvasGroup，位于所有图层之上且随世界变换，
 * 而 `canvas.walls` 是 InteractionLayer——切到别的图层时整层隐藏，画在那里等于没画。
 * 容器设 `eventMode = "none"` 且 `interactiveChildren = false`，保证不抢鼠标事件。
 *
 * @returns {PIXI.Container|null} 容器，画布不可用时为 null
 */
function getHintLayer() {
  if ( hintLayer && !hintLayer.destroyed ) return hintLayer;

  const parent = canvas?.interface ?? null;
  if ( !parent ) return null;

  const layer = new PIXI.Container();
  layer.name = LAYER_NAME;
  layer.eventMode = "none";
  layer.interactiveChildren = false;
  layer.zIndex = 9999;
  parent.addChild(layer);
  hintLayer = layer;
  return layer;
}

/**
 * 清空容器里的全部线段。
 *
 * @param {PIXI.Container} layer 提示线容器
 * @returns {void}
 */
function clearHintLayer(layer) {
  if ( !layer || layer.destroyed ) return;
  for ( const child of layer.removeChildren() ) child.destroy?.({children: true});
}

/**
 * 销毁提示线容器（画布拆除时调用）。
 *
 * @returns {void}
 */
function destroyHintLayer() {
  const layer = hintLayer;
  hintLayer = null;
  if ( !layer || layer.destroyed ) return;

  try {
    layer.destroy({children: true});
  } catch ( err ) {
    // 不同 PIXI 版本的 destroy 签名有差异；画布已经在拆，销毁失败不影响切场景流程。
    console.warn(`${MODULE_ID} | wall hint layer destroy failed`, err);
  }
}

/**
 * 收集要画的墙体来源。
 *
 * 优先 `canvas.walls.placeables`（离开墙体图层后**不会**被清空，因此最可靠），
 * 退化到 `canvas.scene.walls`（无画布对象时仍能画）。
 *
 * @returns {Array<Wall|WallDocument>} 墙体的画布对象或文档
 */
function collectWallEntries() {
  const placeables = canvas?.walls?.placeables;
  if ( Array.isArray(placeables) && placeables.length ) return placeables;

  const docs = canvas?.scene?.walls;
  if ( !docs ) return [];
  if ( Array.isArray(docs) ) return docs;
  return (typeof docs[Symbol.iterator] === "function") ? [...docs] : [];
}

/**
 * 读取当前设置并解析出绘制样式。
 *
 * @returns {{color: number, width: number, opacity: number}} 绘制样式
 */
function resolveWallHintStyle() {
  return normalizeHintStyle({
    color: getStringSetting(WALL_HINT_SETTINGS.COLOR, DEFAULT_COLOR),
    width: getNumberSetting(WALL_HINT_SETTINGS.WIDTH, DEFAULT_WIDTH),
    opacity: getNumberSetting(WALL_HINT_SETTINGS.OPACITY, DEFAULT_OPACITY)
  });
}

/**
 * 按 scope 设置更新容器可见性。
 *
 * @param {boolean} [wallsActive] 墙体图层是否激活；省略时读 `canvas.walls.active`
 * @returns {void}
 */
function applyScopeVisibility(wallsActive) {
  if ( !hintLayer || hintLayer.destroyed ) return;
  const scope = getStringSetting(WALL_HINT_SETTINGS.SCOPE, DEFAULT_SCOPE);
  hintLayer.visible = !shouldHideHintOnWallsLayer(scope, wallsActive);
}

/**
 * 判断 `updateSetting` 的 key 是否属于本功能的 6 个设置。
 *
 * @param {string} key 完整设置键（形如 `er-qol.wallHint`）
 * @returns {boolean} 属于本功能时返回 true
 */
function isWallHintSettingKey(key) {
  const prefix = `${MODULE_ID}.`;
  const text = String(key ?? "");
  if ( !text.startsWith(prefix) ) return false;
  return Object.values(WALL_HINT_SETTINGS).includes(text.slice(prefix.length));
}

/**
 * 排入一次批量重绘（节流）。
 *
 * `drawWall` / `refreshWall` 会对每面墙各触发一次；400 面墙的场景若逐次全量重绘会卡顿，
 * 因此这里合并成"一帧一次"。优先 `requestAnimationFrame`（无 rAF 的环境同步执行，便于自测）。
 *
 * @returns {void}
 */
function scheduleRedraw() {
  if ( redrawQueued ) return;
  redrawQueued = true;

  const epoch = redrawEpoch;
  const run = () => {
    redrawQueued = false;
    // 排入后画布被拆掉（epoch 变化）时丢弃这次重绘，避免在已销毁的父容器上重建图层。
    if ( epoch !== redrawEpoch ) return;
    refreshWallHint();
  };

  if ( typeof requestAnimationFrame === "function" ) {
    requestAnimationFrame(run);
    return;
  }
  run();
}

/**
 * `updateSetting` 钩子：本功能的设置变化后自动重绘。
 *
 * @param {object} setting 变化的设置对象，含 `key`
 * @returns {void}
 */
function onUpdateSetting(setting) {
  if ( !isWallHintSettingKey(setting?.key) ) return;
  scheduleRedraw();
}

/**
 * `canvasTearDown` 钩子：清容器并作废排入中的重绘。
 *
 * @returns {void}
 */
function onCanvasTearDown() {
  redrawEpoch += 1;
  redrawQueued = false;
  destroyHintLayer();
}

/* -------------------------------------------------------------------------- */
/*  对外 API                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 安装墙体提示线（幂等）。
 *
 * 由 `init.mjs` 在 `Hooks.once("ready")` 中调用；本模块**不**自己注册 init/ready 钩子，
 * 保证钩子安装点唯一。重复调用不会重复挂钩子。
 *
 * @returns {void}
 */
export function installWallHint() {
  if ( installed ) return;
  installed = true;

  // 墙体集合变化 → 批量重绘（每面墙一次的重绘由 scheduleRedraw 节流）。
  Hooks.on("canvasReady", scheduleRedraw);
  Hooks.on("drawWall", scheduleRedraw);
  Hooks.on("refreshWall", scheduleRedraw);
  Hooks.on("destroyWall", scheduleRedraw);
  Hooks.on("updateWall", scheduleRedraw);
  Hooks.on("updateScene", scheduleRedraw);
  Hooks.on("canvasTearDown", onCanvasTearDown);

  // 图层切换：只改可见性，不重绘（scope = "always" 时 shouldHideHintOnWallsLayer 恒为 false）。
  Hooks.on("activateWalls", () => applyScopeVisibility(true));
  Hooks.on("deactivateWalls", () => applyScopeVisibility(false));

  // 设置变化 → 重绘。
  Hooks.on("updateSetting", onUpdateSetting);

  // 首次绘制：ready 后画布可能已经就绪（installWallHint 在 ready 里调用）。
  if ( canvas?.ready ) scheduleRedraw();
}

/**
 * 立即重绘全部墙体提示线（设置变更、场景变化或手动刷新时调用）。
 *
 * 行为：先清空旧线段；`wallHint` 关闭时只隐藏容器；开启时按当前颜色/线宽/透明度、
 * scope 与阻挡类型过滤重画。任何情况下都不写数据、不改墙体。
 *
 * @returns {void}
 */
export function refreshWallHint() {
  const layer = getHintLayer();
  if ( !layer ) return;

  clearHintLayer(layer);

  if ( !getBoolSetting(WALL_HINT_SETTINGS.ENABLED, false) ) {
    layer.visible = false;
    return;
  }

  applyScopeVisibility();

  const blocking = getArraySetting(WALL_HINT_SETTINGS.BLOCKING, []);
  const style = resolveWallHintStyle();

  let drawn = 0;
  let skipped = 0;
  for ( const entry of collectWallEntries() ) {
    const doc = entry?.document ?? entry;
    if ( !isWallHintEligible(doc, blocking) ) {
      skipped += 1;
      continue;
    }

    const segment = getWallSegment(doc, entry);
    if ( !segment ) {
      // 端点解析失败通常是数据形态变了（例如 c 不再是扁平数组）——这正是
      // "开了设置却一条线都没有"的静默失效形态，所以留一条可定位的警告。
      skipped += 1;
      continue;
    }

    const graphics = new PIXI.Graphics();
    graphics.eventMode = "none";
    graphics.lineStyle(style.width, style.color, style.opacity);
    graphics.moveTo(segment.a.x, segment.a.y);
    graphics.lineTo(segment.b.x, segment.b.y);
    layer.addChild(graphics);
    drawn += 1;
  }

  logWallHintSummary(drawn, skipped, blocking);
}

/** 已提示过"一条线都没画出来"的场景，避免每次重绘都刷屏。 */
let warnedEmptyDraw = false;

/**
 * 在"开启但一条线都没画出来"时输出一次可定位的警告。
 *
 * 正常场景（墙上确实没有符合过滤条件的墙）不刷日志；
 * 只有明显异常（一条都没画、且有墙被跳过）才提示，避免静默失效。
 *
 * @param {number} drawn 实际画出的线段数
 * @param {number} skipped 被跳过的墙体数
 * @param {string[]} blocking 当前阻挡类型过滤
 * @returns {void}
 */
function logWallHintSummary(drawn, skipped, blocking) {
  if ( drawn > 0 ) {
    warnedEmptyDraw = false;
    return;
  }
  if ( !skipped || warnedEmptyDraw ) return;
  warnedEmptyDraw = true;
  console.warn(`${MODULE_ID} | 墙体提示线已开启，但当前场景一条都没画出来`
    + `（跳过 ${skipped} 面墙${blocking.length ? `，阻挡类型过滤 = ${blocking.join("/")}` : ""}）。`
    + " 若墙确实存在，多半是端点解析失败或过滤条件过严。");
}
