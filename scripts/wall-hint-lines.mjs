/**
 * 墙体提示线：**可配置多条线**的纯函数模块（无副作用、可在 Node 里独立自测）。
 *
 * 需求（用户 2026-10-23）：墙体线不能只有一种样式，要能配置多种线；每条线单独配置
 * **线型（实线 / 虚线 / 点划线…）、颜色、宽度、条件（阻挡移动等）、优先级**；
 * 同一面墙同时满足多条线时，按**优先级最高**的那条画。
 *
 * 本文件只做"配置 → 规范化 → 选线 → 几何切段"这几件纯事：
 * - 设置注册、菜单 UI、PIXI 绘制分别在 `settings.mjs` / `wall-hint-config.mjs` / `wall-hint.mjs`；
 * - 这里不 import 任何其它模组文件，避免与设置注册形成循环依赖。
 *
 * ## 与"统一颜色 + 所有类型墙体一律绘制"的关系
 *
 * 默认（`wallHintLines` 为空）解析成**唯一一条**内置线：实线、颜色 `#00e5ff`、宽 2、
 * 不带任何条件 → 所有墙体（含密门 / 隐形墙 / 虚体墙）都用同一种颜色画出来。
 * 用户新增的多条线只是**可选的覆盖**：条件只按"墙体阻挡了哪些通道"判断，
 * **绝不按墙体类别（door/secret 等）判断**，所以不会把密门单独标出来。
 *
 * @module er-qol/scripts/wall-hint-lines
 */

/* -------------------------------------------------------------------------- */
/*  常量                                                                        */
/* -------------------------------------------------------------------------- */

/** 允许的线型；顺序即设置界面下拉框顺序。 */
export const WALL_HINT_LINE_STYLES = Object.freeze(["solid", "dashed", "dotted", "dashdot", "dashdotdot"]);

/**
 * 各线型的"实线段 / 空白段"像素长度（偶数下标为画、奇数下标为空）。
 *
 * `solid` 为 `null`（整段一次画完）。数值与线宽无关：提示线本身很细，
 * 用固定长度可保证不同线宽的虚线看起来疏密一致。
 */
export const WALL_HINT_DASH_PATTERNS = Object.freeze({
  solid: null,
  dashed: Object.freeze([12, 7]),
  dotted: Object.freeze([1.5, 6]),
  dashdot: Object.freeze([14, 6, 2, 6]),
  dashdotdot: Object.freeze([14, 6, 2, 6, 2, 6])
});

/** 默认线的颜色（与旧版 `wallHintColor` 默认值一致）。 */
export const DEFAULT_WALL_HINT_COLOR = "#00e5ff";

/** 默认线宽。 */
export const DEFAULT_WALL_HINT_WIDTH = 2;

/** 线宽允许范围（与旧版设置面板的 1–10 保持一致）。 */
export const MIN_WALL_HINT_WIDTH = 1;
export const MAX_WALL_HINT_WIDTH = 10;

/** 优先级允许范围（整数，越大越优先）。 */
export const MIN_WALL_HINT_PRIORITY = -9999;
export const MAX_WALL_HINT_PRIORITY = 9999;

/** 允许用于"条件"的阻挡类型（对应 `WallDocument` 上真实存在的四个通道）。 */
export const WALL_HINT_BLOCKING_TYPES = Object.freeze(["move", "sight", "sound", "light"]);

/* -------------------------------------------------------------------------- */
/*  墙体端点（纯几何）                                                           */
/* -------------------------------------------------------------------------- */

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
 * @param {{c?: Array<number>|Array<{x: number, y: number}>}} doc 墙体文档
 * @param {{b?: {x: number, y: number}}|null} [wallObject] 对应的画布对象
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

/* -------------------------------------------------------------------------- */
/*  颜色                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 把颜色值解析成 PIXI `lineStyle()` 需要的 0xRRGGBB 数字。
 *
 * 支持 `#rgb` / `#rrggbb` / `#rrggbbaa`（8 位时丢弃 alpha，只保留 RGB）以及裸数字；
 * 无法解析时返回 `null`，由调用方回退到默认色——**绝不**把带 `#` 的字符串直接交给 PIXI。
 *
 * @param {string|number} value 颜色值
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
 * 把颜色值规范化成 `<input type="color">` 能直接用的 `#rrggbb` 字符串。
 *
 * @param {string|number} value 颜色值
 * @returns {string|null} `#rrggbb`，无法解析时为 null
 */
export function normalizeHintColorText(value) {
  const parsed = parseHintColor(value);
  if ( parsed === null ) return null;
  return `#${parsed.toString(16).padStart(6, "0")}`;
}

/* -------------------------------------------------------------------------- */
/*  阻挡类型（线的"条件"）                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 规范化阻挡类型条件：去重、丢掉不认识的值、保持稳定顺序。
 *
 * 兼容四种存法：数组 / `Set` / 单字符串 / 以布尔为值的对象（表单提交的形态）。
 *
 * @param {Iterable<string>|string|object|null|undefined} blocking 原始值
 * @returns {string[]} 规范化后的类型数组
 */
export function normalizeBlockingTypes(blocking) {
  let values;
  if ( (blocking === null) || (blocking === undefined) ) {
    values = [];
  }
  else if ( typeof blocking === "string" ) {
    values = [blocking];
  }
  else if ( typeof blocking[Symbol.iterator] === "function" ) {
    values = [...blocking];
  }
  else if ( typeof blocking === "object" ) {
    values = Object.entries(blocking).filter(([, enabled]) => enabled === true).map(([key]) => key);
  }
  else {
    values = [];
  }

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
 * 判断一面墙是否满足一条线的"条件"。
 *
 * 空条件 = 所有墙体都满足（默认线的行为：所有类型墙体一律绘制）。
 * 非空条件为**或**关系：至少阻挡其中一项即满足。
 *
 * @param {WallDocument} doc 墙体文档
 * @param {string[]} [blocking=[]] 条件通道
 * @returns {boolean} 满足时返回 true
 */
export function isWallHintEligible(doc, blocking = []) {
  if ( !doc ) return false;
  const wanted = normalizeBlockingTypes(blocking);
  if ( !wanted.length ) return true;
  return wanted.some(type => wallBlocks(doc, type));
}

/* -------------------------------------------------------------------------- */
/*  线的规范化与选线                                                             */
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
 * 把数字收敛到合法区间；非有限数回退默认值。
 *
 * @param {*} value 原始值
 * @param {number} min 下限
 * @param {number} max 上限
 * @param {number} fallback 回退值
 * @param {boolean} [integer=false] 是否取整
 * @returns {number} 合法数字
 */
function clampNumber(value, min, max, fallback, integer = false) {
  const number = Number(value);
  if ( !Number.isFinite(number) ) return fallback;
  const clamped = Math.min(max, Math.max(min, number));
  return integer ? Math.trunc(clamped) : clamped;
}

/**
 * 生成一条"默认线"：实线、统一颜色、宽 2、无优先级要求、无阻挡条件。
 *
 * 所有墙体都会命中它，因此默认配置下**每个墙体类别（含密门）都会被画出来**。
 *
 * @returns {object} 规范化后的默认线
 */
export function makeDefaultWallLine() {
  return {
    id: "default",
    style: "solid",
    colorText: DEFAULT_WALL_HINT_COLOR,
    color: parseHintColor(DEFAULT_WALL_HINT_COLOR),
    width: DEFAULT_WALL_HINT_WIDTH,
    priority: 0,
    blocking: []
  };
}

/**
 * 规范化一条线的配置；非对象（或数组）视为无效，返回 null 由调用方丢弃。
 *
 * 非法字段一律回退到安全值，保证"手改设置 / 旧数据"不会把绘制搞崩：
 * - 未知线型 → `solid`
 * - 颜色解析失败 → 默认色
 * - 宽度/优先级越界 → 收敛到合法区间
 * - 条件里不认识的值 → 丢弃
 *
 * @param {*} raw 原始配置
 * @param {number} [index=0] 在数组中的下标（用于补 id）
 * @returns {object|null} 规范化后的线
 */
export function normalizeWallLine(raw, index = 0) {
  if ( !raw || (typeof raw !== "object") || Array.isArray(raw) ) return null;

  const style = WALL_HINT_LINE_STYLES.includes(raw.style) ? raw.style : "solid";
  const colorText = normalizeHintColorText(raw.color) ?? DEFAULT_WALL_HINT_COLOR;
  const width = clampNumber(raw.width, MIN_WALL_HINT_WIDTH, MAX_WALL_HINT_WIDTH,
    DEFAULT_WALL_HINT_WIDTH);
  const priority = clampNumber(raw.priority, MIN_WALL_HINT_PRIORITY, MAX_WALL_HINT_PRIORITY, 0, true);

  return {
    id: (typeof raw.id === "string" && raw.id) ? raw.id : `line-${index}`,
    style,
    colorText,
    color: parseHintColor(colorText),
    width,
    priority,
    blocking: normalizeBlockingTypes(raw.blocking)
  };
}

/**
 * 把设置值解析成"实际用于绘制的线列表"。
 *
 * - 非数组 / 空数组 / 全部条目非法 → 返回**唯一一条默认线**（统一颜色、所有墙体都画）；
 * - 否则返回按数组顺序规范化后的线（顺序同时是**同优先级时的先后次序**）。
 *
 * @param {*} raw `wallHintLines` 设置值
 * @returns {object[]} 至少一条线的数组
 */
export function resolveWallHintLines(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const lines = [];
  for ( let index = 0; index < list.length; index += 1 ) {
    const line = normalizeWallLine(list[index], index);
    if ( line ) lines.push(line);
  }
  return lines.length ? lines : [makeDefaultWallLine()];
}

/**
 * 为一面墙选出要画的线：条件满足的线里**优先级最高**的那条；同优先级取数组里靠前的。
 *
 * @param {WallDocument} doc 墙体文档
 * @param {object[]} lines 规范化后的线（`resolveWallHintLines` 的返回值）
 * @returns {object|null} 选中的线；没有任何线满足条件时为 null（该墙不画）
 */
export function selectWallLine(doc, lines) {
  if ( !doc || !Array.isArray(lines) ) return null;

  let best = null;
  for ( const line of lines ) {
    if ( !isWallHintEligible(doc, line.blocking) ) continue;
    if ( !best || (line.priority > best.priority) ) best = line;
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/*  线型几何                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 取线型对应的"实/空"长度模式。
 *
 * @param {string} style 线型
 * @returns {number[]|null} 长度模式；实线或未知线型为 null
 */
export function getDashPattern(style) {
  return WALL_HINT_DASH_PATTERNS[style] ?? null;
}

/**
 * 把一条线段按线型切成若干实线段。
 *
 * 实线返回原线段一项；点划类线型按固定像素长度循环切分。零长度 / 非有限坐标返回 `[]`。
 * 本函数是纯几何函数，便于在 Node 里断言（不需要 PIXI）。
 *
 * @param {{x: number, y: number}} a 起点
 * @param {{x: number, y: number}} b 终点
 * @param {string} style 线型
 * @returns {Array<{a: {x: number, y: number}, b: {x: number, y: number}}>} 实线段数组
 */
export function splitSegmentByDash(a, b, style) {
  const pattern = getDashPattern(style);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if ( !Number.isFinite(length) || (length <= 0) ) return [];
  if ( !pattern ) return [{a: {x: a.x, y: a.y}, b: {x: b.x, y: b.y}}];

  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const segments = [];
  let position = 0;
  let index = 0;
  let draw = true;

  while ( position < length ) {
    const run = pattern[index % pattern.length];
    if ( !Number.isFinite(run) || (run <= 0) ) break;
    const end = Math.min(length, position + run);
    if ( draw ) {
      segments.push({
        a: {x: a.x + (ux * position), y: a.y + (uy * position)},
        b: {x: a.x + (ux * end), y: a.y + (uy * end)}
      });
    }
    position = end;
    index += 1;
    draw = !draw;
  }
  return segments;
}

/**
 * 把规范化后的线还原成"设置里可保存 / 编辑器里可回填"的普通对象。
 *
 * 去掉解析出来的数字颜色，只保留用户可编辑字段。
 *
 * @param {object} line 规范化后的线（或编辑器草稿）
 * @returns {{style: string, color: string, width: number, priority: number, blocking: string[]}} 可序列化配置
 */
export function toWallLineDraft(line) {
  const normalized = normalizeWallLine(line, 0) ?? makeDefaultWallLine();
  return {
    style: normalized.style,
    color: normalized.colorText,
    width: normalized.width,
    priority: normalized.priority,
    blocking: [...normalized.blocking]
  };
}

/**
 * 判断一份配置是否等价于"内置默认线"。
 *
 * 编辑器用它决定保存时是否把用户未改动的默认线写成空数组（保持 `[]` = 默认语义）。
 * 线型允许未写（视为 solid），颜色/宽度/优先级允许缺省。
 *
 * @param {object} line 配置
 * @returns {boolean} 等于默认线时返回 true
 */
export function isDefaultWallLine(line) {
  if ( !line || (typeof line !== "object") ) return false;
  const normalized = normalizeWallLine({...line, id: "default"}, 0);
  if ( !normalized ) return false;
  return (normalized.style === "solid")
    && (normalized.colorText === DEFAULT_WALL_HINT_COLOR)
    && (normalized.width === DEFAULT_WALL_HINT_WIDTH)
    && (normalized.priority === 0)
    && (normalized.blocking.length === 0);
}
