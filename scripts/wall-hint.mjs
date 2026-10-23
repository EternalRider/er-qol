/**
 * er-qol 新增功能：墙体提示线（Wall Outlines On Other Layers）。
 *
 * 目的：墙体只在"墙体"图层绘制，玩家在 Token / 光照 / 地形等图层上看不到真实墙线。
 * 本模块把每面墙的线段**再画一遍**，挂到 `canvas.interface`（InterfaceCanvasGroup：
 * 在所有图层之上、随世界变换），从而在任何图层上都能提示墙的真实位置。
 *
 * ## 可配置多条线（用户 2026-10-23 需求）
 *
 * 墙体线不再只有一种样式。设置里保存**一组线定义**（`wallHintLines`），每条线单独配置：
 * 线型（实线 / 虚线 / 点划线…）、颜色、宽度、条件（阻挡移动等）、优先级。
 * 同一面墙同时满足多条线时，画**优先级最高**的那条（同优先级取数组里靠前的）。
 *
 * ## 为什么默认仍是"统一颜色 + 所有类型墙体一律绘制"
 *
 * Foundry 的墙体颜色由 `Wall#_getWallColor()` 按墙的类别决定，其中**密门（`secret`）**
 * 的类别色是 `0xA612D4`（紫色）。如果提示线跟着类别上色，密门那根线会变成紫色，
 * 等于当着玩家的面把密门标出来。
 *
 * 因此：
 * 1. **线的条件只按"墙体阻挡了哪些通道"判断，绝不按墙体类别判断**；
 * 2. 未配置任何线时，解析成唯一一条内置默认线（实线、`#00e5ff`、宽 2、无条件），
 *    所有墙体（含密门 / 隐形墙 / 虚体墙）都用同一种颜色画出来。
 *
 * 用户在设置菜单里新增的多条线属于**可选的显式配置**，不会读取任何类别信息。
 *
 * ## 结构
 *
 * - 纯函数（颜色解析 / 端点提取 / 选线 / 虚线切段）在 `wall-hint-lines.mjs`，可在 Node 里自测；
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
  getSetting
} from "./settings.mjs";
import {
  DEFAULT_WALL_HINT_COLOR,
  DEFAULT_WALL_HINT_WIDTH,
  WALL_HINT_BLOCKING_TYPES,
  WALL_HINT_LINE_STYLES,
  getDashPattern,
  getWallSegment,
  isWallHintEligible,
  normalizeBlockingTypes,
  parseHintColor,
  resolveWallHintLines,
  selectWallLine,
  splitSegmentByDash,
  wallBlocks
} from "./wall-hint-lines.mjs";

// 纯函数集中放在 wall-hint-lines.mjs；这里再导出一次，让调用方与旧测试仍可从 wall-hint 取。
export {
  WALL_HINT_BLOCKING_TYPES,
  WALL_HINT_LINE_STYLES,
  getWallSegment,
  isWallHintEligible,
  normalizeBlockingTypes,
  parseHintColor,
  wallBlocks
};

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
  OPACITY: "wallHintOpacity",
  SCOPE: "wallHintScope",
  LINES: "wallHintLines"
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

/** 透明度 / 显示范围的默认回退值（与 settings.mjs 的 default 对齐）。 */
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
/*  纯函数：显示判定（可独立自测）                                                 */
/* -------------------------------------------------------------------------- */

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
 * 读取当前设置并解析成"实际要画的线列表"。
 *
 * 空数组 / 非法值 → 唯一一条内置默认线（统一颜色、所有墙体都画）。
 *
 * @returns {object[]} 至少一条线的数组
 */
function resolveSettingLines() {
  return resolveWallHintLines(getSetting(WALL_HINT_SETTINGS.LINES, []));
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
 * 判断 `updateSetting` 的 key 是否属于本功能的设置。
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
 * 行为：先清空旧线段；`wallHint` 关闭时只隐藏容器；开启时对每面墙按当前线配置选一条线
 * （条件满足的线里优先级最高者）画出线段。任何情况下都不写数据、不改墙体。
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

  const lines = resolveSettingLines();
  const opacity = getNumberSetting(WALL_HINT_SETTINGS.OPACITY, DEFAULT_OPACITY);
  const graphicsByLine = new Map();

  let drawn = 0;
  let skipped = 0;
  for ( const entry of collectWallEntries() ) {
    const doc = entry?.document ?? entry;
    const line = selectWallLine(doc, lines);
    if ( !line ) {
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

    const pieces = splitSegmentByDash(segment.a, segment.b, line.style);
    if ( !pieces.length ) {
      skipped += 1;
      continue;
    }

    let graphics = graphicsByLine.get(line);
    if ( !graphics ) {
      graphics = new PIXI.Graphics();
      graphics.eventMode = "none";
      graphics.lineStyle(line.width, line.color, opacity);
      layer.addChild(graphics);
      graphicsByLine.set(line, graphics);
    }
    for ( const piece of pieces ) {
      graphics.moveTo(piece.a.x, piece.a.y);
      graphics.lineTo(piece.b.x, piece.b.y);
    }
    drawn += 1;
  }

  logWallHintSummary(drawn, skipped, lines);
}

/** 已提示过"一条线都没画出来"的场景，避免每次重绘都刷屏。 */
let warnedEmptyDraw = false;

/**
 * 在"开启但一条线都没画出来"时输出一次可定位的警告。
 *
 * 正常场景（墙上确实没有符合过滤条件的墙）不刷日志；
 * 只有明显异常（一条都没画、且有墙被跳过）才提示，避免静默失效。
 *
 * @param {number} drawn 实际画出的墙体数
 * @param {number} skipped 被跳过的墙体数
 * @param {object[]} lines 当前线配置
 * @returns {void}
 */
function logWallHintSummary(drawn, skipped, lines) {
  if ( drawn > 0 ) {
    warnedEmptyDraw = false;
    return;
  }
  if ( !skipped || warnedEmptyDraw ) return;
  warnedEmptyDraw = true;
  const styles = lines.map(line => line.style).join("/");
  console.warn(`${MODULE_ID} | 墙体提示线已开启，但当前场景一条都没画出来`
    + `（跳过 ${skipped} 面墙，线型 = ${styles}）。`
    + " 若墙确实存在，多半是端点解析失败或线配置的条件过严。");
}

/**
 * 本模块依赖的默认颜色/宽度（供设置菜单与自测读取）。
 *
 * @type {{color: string, width: number}}
 */
export const WALL_HINT_DEFAULTS = Object.freeze({
  color: DEFAULT_WALL_HINT_COLOR,
  width: DEFAULT_WALL_HINT_WIDTH
});

/**
 * 线型列表（供设置菜单渲染下拉框）。
 *
 * @type {ReadonlyArray<string>}
 */
export const WALL_HINT_STYLE_CHOICES = WALL_HINT_LINE_STYLES;

/**
 * 线型对应的虚线模式（供自测断言每个线型都有定义）。
 *
 * @type {Readonly<Record<string, ReadonlyArray<number>|null>>}
 */
export const WALL_HINT_DASH_PATTERNS = Object.freeze({
  solid: getDashPattern("solid"),
  dashed: getDashPattern("dashed"),
  dotted: getDashPattern("dotted"),
  dashdot: getDashPattern("dashdot"),
  dashdotdot: getDashPattern("dashdotdot")
});
