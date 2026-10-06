/**
 * er-qol 共享工具模块。
 *
 * 本文件收纳 region-lighting 与 region-walls 原先各自复制的一份 Region 几何/高度工具函数
 * （原先两处共约 120 行重复代码），以及若干跨 Behavior 复用的辅助函数。
 *
 * 约定：**本文件不依赖任何 Behavior 类**，只依赖 Foundry 全局对象（canvas / CONST / PIXI 等），
 * 因此可以被任意子模块安全导入。
 *
 * @module er-qol/scripts/region-common
 */

/** 模组 id。必须与 module.json 的 `id`、目录名保持一致。 */
export const MODULE_ID = "er-qol";

/**
 * 旧模组的 type 键 → 新模组 type 键的兼容映射。
 *
 * 历史背景：
 * - `region-lighting` 与 `region-walls` 各自把 RegionBehavior 注册成
 *   `region-lighting.regionLighting` / `region-walls.regionWall`；
 * - swpt 的 `scripts/api.js`（`buildRegionLightingData` / `buildRegionWallData`）会把这两个
 *   字面量直接写进 Region 数据，且 swpt 已冻结不再修改；
 * - 某些加载路径下（例如仅按 module.json 的 documentTypes 解析）实际存储的 type 可能是
 *   **裸子类型名** `regionLighting` / `regionWall`。
 *
 * 因此新模组必须同时注册这四类键，否则老世界里已有的 Region 行为会静默失效。
 */
export const LEGACY_TYPE_GROUPS = Object.freeze({
  regionLighting: Object.freeze([
    "regionLighting",
    "region-lighting.regionLighting",
    `${MODULE_ID}.regionLighting`
  ]),
  regionWall: Object.freeze([
    "regionWall",
    "region-walls.regionWall",
    `${MODULE_ID}.regionWall`
  ])
});

/**
 * 兼容别名：旧模组 type 键 → er-qol 规范化 type 键。
 * @type {Readonly<Record<string, string>>}
 */
export const LEGACY_TYPE_ALIASES = Object.freeze({
  "regionLighting": `${MODULE_ID}.regionLighting`,
  "region-lighting.regionLighting": `${MODULE_ID}.regionLighting`,
  "regionWall": `${MODULE_ID}.regionWall`,
  "region-walls.regionWall": `${MODULE_ID}.regionWall`
});

/** 规范化后的光照 Behavior type 键。 */
export const LIGHTING_TYPE = `${MODULE_ID}.regionLighting`;

/** 规范化后的墙体 Behavior type 键。 */
export const WALL_TYPE = `${MODULE_ID}.regionWall`;

/**
 * 把任意历史 type 键归一化成 er-qol 的规范化 type 键。
 * 非 Region Behavior 的 type 原样返回。
 * @param {string} type 待归一化的 type 键
 * @returns {string} 归一化后的 type 键
 */
export function normalizeBehaviorType(type) {
  return LEGACY_TYPE_ALIASES[type] ?? type;
}

/**
 * 判断一个 type 键是否属于某个子类型（含所有历史别名）。
 * @param {string} type RegionBehavior 的 type 键
 * @param {keyof typeof LEGACY_TYPE_GROUPS} subtype 子类型名（如 `"regionLighting"`）
 * @returns {boolean} 命中返回 true
 */
export function isBehaviorType(type, subtype) {
  return (LEGACY_TYPE_GROUPS[subtype] ?? []).includes(type);
}

/** 子类型 → 取代它的旧模组 id。 */
const LEGACY_OWNER_MODULE = Object.freeze({
  regionLighting: "region-lighting",
  regionWall: "region-walls"
});

/**
 * 判断某个 type 键此刻是否应该由 er-qol 处理。
 *
 * 关键：当**旧的同名模组仍然启用**时，er-qol 必须让出旧 type 键——
 * 旧 `region-lighting` / `region-walls` 按精确 type 匹配自己处理一遍，
 * er-qol 若同时按别名再处理一遍，同一条 Region 行为就会被收集两次
 * （墙体边界重复、光照源重复）。而 swpt 生成的数据写的正是旧 type 键，
 * 所以这个"让位"规则同时保证了 swpt 内容不会被重复结算。
 *
 * 规范化的 `er-qol.*` 键始终由 er-qol 处理，与旧模组是否启用无关。
 *
 * @param {string} type RegionBehavior 的 type 键
 * @param {keyof typeof LEGACY_TYPE_GROUPS} subtype 子类型名
 * @returns {boolean} 应由 er-qol 处理时返回 true
 */
export function isActiveBehaviorType(type, subtype) {
  if ( !isBehaviorType(type, subtype) ) return false;
  if ( type === `${MODULE_ID}.${subtype}` ) return true;
  const owner = LEGACY_OWNER_MODULE[subtype];
  if ( !owner ) return true;
  return !globalThis.game?.modules?.get?.(owner)?.active;
}

/**
 * 该子类型的旧模组是否正在启用（启用时 er-qol 不注册旧别名，也不处理旧键）。
 * @param {keyof typeof LEGACY_TYPE_GROUPS} subtype 子类型名
 * @returns {boolean} 旧模组启用时返回 true
 */
export function isLegacyOwnerActive(subtype) {
  const owner = LEGACY_OWNER_MODULE[subtype];
  return !!owner && !!globalThis.game?.modules?.get?.(owner)?.active;
}

/**
 * 取某子类型需要注册的 type 键：规范化键始终注册，旧别名只在旧模组未启用时注册。
 *
 * 不注册（而不是注册后用不到）能带来两个好处：行为类型下拉框不会出现
 * 无法生效的旧键；`auditTypeAliases()` 也能据此区分"预期跳过"与"真缺失"。
 *
 * @param {keyof typeof LEGACY_TYPE_GROUPS} subtype 子类型名
 * @returns {string[]} 需要注册的 type 键
 */
export function getRegistrableTypes(subtype) {
  const all = LEGACY_TYPE_GROUPS[subtype] ?? [`${MODULE_ID}.${subtype}`];
  if ( !isLegacyOwnerActive(subtype) ) return [...all];
  return all.filter(type => type === `${MODULE_ID}.${subtype}`);
}

/** 模组 API 命名空间，挂到 `game.erqol`，供宏/其他模组调用。 */
export const erqol = {
  MODULE_ID,
  LIGHTING_TYPE,
  WALL_TYPE,
  LEGACY_TYPE_GROUPS,
  LEGACY_TYPE_ALIASES,
  normalizeBehaviorType,
  isBehaviorType,
  isActiveBehaviorType,
  isLegacyOwnerActive,
  getRegistrableTypes,
  getBehaviorsBySubtype: (...args) => getBehaviorsBySubtype(...args)
};

globalThis.erqol = erqol;

/**
 * 本地化取值，缺失 key 时回退到默认值而不是显示原始 key。
 * @param {string} key 本地化键
 * @param {string} [fallback] 回退文本，省略时回退为 key 本身
 * @returns {string} 本地化后的文本
 */
export function localize(key, fallback) {
  const localized = globalThis.game?.i18n?.localize?.(key);
  if (!localized || (localized === key)) return fallback ?? key;
  return localized;
}

/**
 * 带数据的本地化取值（`game.i18n.format`），失败时回退到 `localize`。
 * @param {string} key 本地化键
 * @param {object} [data] 插值数据
 * @returns {string} 本地化后的文本
 */
export function format(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.format) {
    try {
      const formatted = i18n.format(key, data);
      if (formatted && (formatted !== key)) return formatted;
    } catch ( err ) {
      console.warn(`${MODULE_ID} | format failed for ${key}`, err);
    }
  }
  return localize(key, key);
}

/* -------------------------------------------------------------------------- */
/*  Region 几何工具（region-lighting / region-walls 共享）                       */
/* -------------------------------------------------------------------------- */

/**
 * 取 Region 的动画状态对象。
 *
 * Region 的 polygonTree / triangulation / bounds 平时挂在 `region.object.animationState` 上
 * （由 Region 的动画状态维护），在无画布或未初始化时退化为 Region 文档本身。
 *
 * @param {RegionDocument|Region} region Region 文档或 Region 对象
 * @returns {RegionDocument|Region|object} 带 polygonTree / triangulation / bounds 的对象
 */
export function getRegionState(region) {
  return region?.object?.animationState ?? region;
}

/**
 * 取 Region 的多边形树（外环 + 洞）。
 * @param {RegionDocument|Region} region Region 文档
 * @returns {Array<object>} 多边形节点数组，节点含 `polygon` / `path` / `bounds` / `isHole`
 */
export function getRegionPolygonTree(region) {
  return getRegionState(region)?.polygonTree ?? [];
}

/**
 * 取 Region 的三角剖分结果（归一化顶点 + 索引）。
 * @param {RegionDocument|Region} region Region 文档
 * @returns {{vertices: Float32Array, indices: Uint16Array|Uint32Array}} 三角剖分
 */
export function getRegionTriangulation(region) {
  return getRegionState(region)?.triangulation ?? {vertices: new Float32Array(), indices: new Uint16Array()};
}

/**
 * 取 Region 的包围盒。
 * @param {RegionDocument|Region} region Region 文档
 * @returns {PIXI.Rectangle} 包围盒
 */
export function getRegionBounds(region) {
  return getRegionState(region)?.bounds ?? new PIXI.Rectangle(0, 0, 0, 0);
}

/**
 * 提取 Region 全部边界线段（外环保留，洞也保留），返回去重后的点对。
 *
 * 这是 region-lighting 与 region-walls 原先各自实现的一份逻辑的**唯一实现**：
 * - 光照/黑暗源用它生成 `Edge`（边界决定光照如何被遮挡）；
 * - 墙体 Behavior 用它生成"像墙一样"的碰撞边。
 *
 * 坐标来源优先取 `node.path`（`Region` 对象上的点数组），退化时用 `polygon.points`
 * 的扁平数组（`[x0, y0, x1, y1, ...]`）。
 *
 * @param {RegionDocument|Region} region Region 文档
 * @param {object} [options] 选项
 * @param {boolean} [options.holes=true] 是否包含洞的边界
 * @returns {Array<{points: Array<{x: number, y: number}>, polygonIndex: number, isHole: boolean}>}
 *          每段含两个点、所属多边形序号与是否为洞
 */
export function getRegionPolygonEdges(region, {holes = true} = {}) {
  const segments = [];
  let polygonIndex = 0;

  for ( const node of getRegionPolygonTree(region) ) {
    const isHole = !!node.isHole;
    const index = polygonIndex++;
    if ( isHole && !holes ) continue;

    const points = nodePoints(node);
    if ( points.length < 3 ) continue;

    for ( let i = 0; i < points.length; i++ ) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ( (a.x === b.x) && (a.y === b.y) ) continue;
      segments.push({points: [a, b], polygonIndex: index, isHole});
    }
  }

  return segments;
}

/**
 * 把多边形树节点转换成点数组（优先 `node.path`）。
 * @param {object} node 多边形树节点
 * @returns {Array<{x: number, y: number}>} 顶点数组
 */
function nodePoints(node) {
  if ( Array.isArray(node.path) ) return node.path;
  const flat = node.polygon?.points ?? [];
  const points = [];
  for ( let i = 0; i < flat.length; i += 2 ) points.push({x: flat[i], y: flat[i + 1]});
  return points;
}

/**
 * 取 Region 的第一个非洞多边形（用于光照/黑暗源的可视形状）。
 * @param {RegionDocument|Region} region Region 文档
 * @returns {PIXI.Polygon} 多边形，找不到时返回空 Polygon
 */
export function getPrimaryRegionPolygon(region) {
  for ( const node of getRegionPolygonTree(region) ) {
    if ( !node.isHole ) return node.polygon;
  }
  return new PIXI.Polygon([]);
}

/**
 * 计算三角剖分的面积加权重心。
 * @param {ArrayLike<number>} vertices 归一化顶点（`[x0, y0, x1, y1, ...]`）
 * @param {ArrayLike<number>} indices 三角形索引
 * @returns {{x: number, y: number}|null} 重心坐标，退化时返回 null
 */
export function computeTriangulationCentroid(vertices, indices) {
  if ( !indices?.length ) return null;
  let totalArea = 0;
  let centroidX = 0;
  let centroidY = 0;

  for ( let i = 0; i < indices.length; i += 3 ) {
    const a = indices[i] * 2;
    const b = indices[i + 1] * 2;
    const c = indices[i + 2] * 2;
    const ax = vertices[a];
    const ay = vertices[a + 1];
    const bx = vertices[b];
    const by = vertices[b + 1];
    const cx = vertices[c];
    const cy = vertices[c + 1];
    const twiceArea = ((bx - ax) * (cy - ay)) - ((by - ay) * (cx - ax));
    const area = Math.abs(twiceArea) / 2;
    if ( area <= 1e-8 ) continue;
    totalArea += area;
    centroidX += ((ax + bx + cx) / 3) * area;
    centroidY += ((ay + by + cy) / 3) * area;
  }

  if ( totalArea <= 1e-8 ) return null;
  return {x: centroidX / totalArea, y: centroidY / totalArea};
}

/**
 * 取三角剖分第一个三角形的重心（第二候选点）。
 * @param {ArrayLike<number>} vertices 归一化顶点
 * @param {ArrayLike<number>} indices 三角形索引
 * @returns {{x: number, y: number}|null} 重心坐标
 */
export function getFirstTrianglePoint(vertices, indices) {
  if ( !indices?.length ) return null;
  const a = indices[0] * 2;
  const b = indices[1] * 2;
  const c = indices[2] * 2;
  return {
    x: (vertices[a] + vertices[b] + vertices[c]) / 3,
    y: (vertices[a + 1] + vertices[b + 1] + vertices[c + 1]) / 3
  };
}

/**
 * 取 Region 的代表点（保证落在 Region 内部）。
 *
 * 依次尝试：三角剖分重心 → 第一个三角形重心 → 包围盒中心。
 * 前两者只在 `region.testPoint()` 通过时采用。
 *
 * @param {RegionDocument|Region} region Region 文档
 * @param {number} [elevation] 附带的高度，省略时按 Region 高度范围取采样高度
 * @returns {{x: number, y: number, elevation: number}} 代表点
 */
export function getRegionRepresentativePoint(region, elevation = getRegionSampleElevation(region)) {
  const triangulation = getRegionTriangulation(region);
  const realElevation = elevation ?? getRegionSampleElevation(region);

  const centroid = computeTriangulationCentroid(triangulation.vertices, triangulation.indices);
  if ( centroid && region.testPoint({x: centroid.x, y: centroid.y, elevation: realElevation}) ) {
    return {x: centroid.x, y: centroid.y, elevation: realElevation};
  }

  const firstTrianglePoint = getFirstTrianglePoint(triangulation.vertices, triangulation.indices);
  if ( firstTrianglePoint && region.testPoint({x: firstTrianglePoint.x, y: firstTrianglePoint.y, elevation: realElevation}) ) {
    return {x: firstTrianglePoint.x, y: firstTrianglePoint.y, elevation: realElevation};
  }

  const bounds = getRegionBounds(region);
  const center = bounds.center ?? {x: bounds.x + (bounds.width / 2), y: bounds.y + (bounds.height / 2)};
  return {x: center.x, y: center.y, elevation: realElevation};
}

/**
 * 取一组落在 Region 内部的采样点（用于判断整片 Region 是否被其他光源覆盖/压制）。
 *
 * 采样点 = 代表点 + 每个外环的包围盒中心（需 `testPoint` 通过），并按坐标去重。
 *
 * @param {RegionDocument|Region} region Region 文档
 * @param {{x: number, y: number, elevation: number}} [fallbackPoint] 代表点，省略时内部计算
 * @param {number} [elevation] 采样高度，省略时按 Region 高度范围推导
 * @returns {Array<{x: number, y: number, elevation: number}>} 去重后的采样点
 */
export function getRegionSamplePoints(region, fallbackPoint, elevation = getRegionSampleElevation(region)) {
  const point = fallbackPoint ?? getRegionRepresentativePoint(region, elevation);
  const points = [point];

  for ( const node of getRegionPolygonTree(region) ) {
    if ( node.isHole ) continue;
    const bounds = node.bounds;
    if ( !bounds ) continue;
    const candidate = {
      x: bounds.x + (bounds.width / 2),
      y: bounds.y + (bounds.height / 2),
      elevation: point.elevation
    };
    if ( region.testPoint(candidate) ) points.push(candidate);
  }

  const seen = new Set();
  return points.filter(p => {
    const key = `${Math.round(p.x)}:${Math.round(p.y)}:${p.elevation}`;
    if ( seen.has(key) ) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 按 Region 的高度范围推导一个稳定的采样高度。
 * @param {RegionDocument|Region} region Region 文档
 * @returns {number} 采样高度
 */
export function getRegionSampleElevation(region) {
  const {bottom, top, topInclusive} = region.elevation ?? {};
  if ( Number.isFinite(bottom) && Number.isFinite(top) ) {
    if ( bottom === top ) return bottom;
    return (bottom + top) / 2;
  }
  if ( Number.isFinite(bottom) ) return bottom;
  if ( Number.isFinite(top) ) return topInclusive ? top : (top - 0.0001);
  return 0;
}

/**
 * 判断某高度是否落在 Region 的高度范围内（含 `topInclusive` 语义）。
 *
 * 注意与 `getRegionSampleElevation` 的区别：本函数是**判定**，`bottom` 视为包含边界。
 *
 * @param {RegionDocument|Region} region Region 文档
 * @param {number} elevation 待判定高度
 * @returns {boolean} 在范围内返回 true
 */
export function elevationInRegion(region, elevation) {
  const {bottom, top, topInclusive} = region.elevation ?? {};
  if ( (bottom != null) && (elevation < bottom) ) return false;
  if ( elevation === bottom ) return true;
  if ( top == null ) return true;
  if ( topInclusive ) return elevation <= top;
  return elevation < top;
}

/**
 * 判断两段高度区间（`[a, b]` 与 Region 高度范围）是否有交集。
 * @param {RegionDocument|Region} region Region 文档
 * @param {number} a 区间端点 A
 * @param {number} b 区间端点 B
 * @returns {boolean} 有交集返回 true
 */
export function elevationRangeOverlaps(region, a, b) {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  const {bottom, top, topInclusive} = region.elevation ?? {};
  if ( (bottom != null) && (max < bottom) ) return false;
  if ( top == null ) return true;
  if ( topInclusive ) return min <= top;
  return min < top;
}

/**
 * 取一个"探针高度"，用于在 Region 内部做二维点判定。
 *
 * 与 `getRegionSampleElevation` 的差异：当高度范围无界或很窄时更偏向取内部值，
 * 避免正好落在边界上导致 `testPoint` 抖动。
 *
 * @param {RegionDocument|Region} region Region 文档
 * @returns {number} 探针高度
 */
export function getProbeElevation(region) {
  const {bottom, top} = region.elevation ?? {};
  if ( bottom === top ) return bottom ?? 0;
  if ( Number.isFinite(bottom) && Number.isFinite(top) ) return (bottom + top) / 2;
  if ( Number.isFinite(bottom) ) return bottom + 1;
  if ( Number.isFinite(top) ) return top - 1;
  return 0;
}

/* -------------------------------------------------------------------------- */
/*  画布辅助                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 判断 Region 是否应该渲染（行为启用、已 viewed、且有画布对象）。
 * @param {object} behaviorType RegionBehavior 的 system 数据模型
 * @param {object} [options] 选项
 * @param {boolean} [options.requireRegionObject=true] 是否要求 `region.object` 存在
 * @returns {boolean} 可渲染返回 true
 */
export function isBehaviorRenderable(behaviorType, {requireRegionObject = true} = {}) {
  if ( !canvas?.ready ) return false;
  const behavior = behaviorType?.behavior;
  if ( !behavior?.active || !behavior.viewed ) return false;
  if ( requireRegionObject && !behaviorType.region?.object ) return false;
  return true;
}

/**
 * 触发一次感知层刷新（光照/视觉/声音）。
 * @param {object} [options] 选项
 * @param {boolean} [options.lighting] 是否重新初始化光照
 * @param {boolean} [options.vision] 是否重新初始化视觉
 * @param {boolean} [options.sounds] 是否刷新声音
 * @returns {void}
 */
export function refreshPerception({lighting = false, vision = false, sounds = false} = {}) {
  if ( !canvas?.ready || !canvas.perception ) return;
  canvas.perception.update({
    initializeLighting: lighting,
    initializeVision: vision,
    refreshLighting: true,
    refreshVision: true,
    refreshSounds: sounds
  });
}

/**
 * 请求场景重新计算 Region 的形状约束（光照/视觉/黑暗的遮挡）。
 * @param {Scene} scene 场景
 * @param {string[]} affectedTypes 受影响的类型（`light` / `sight` / `darkness` / `move` / `sound`）
 * @returns {void}
 */
export function updateRegionShapeConstraints(scene, affectedTypes) {
  if ( !scene?.updateRegionShapeConstraints || !affectedTypes?.length ) return;
  scene.updateRegionShapeConstraints([...new Set(affectedTypes)]);
}

/**
 * 遍历当前场景中所有属于指定子类型的 Region 行为。
 * @param {string} subtype 子类型名（`LEGACY_TYPE_GROUPS` 的键）
 * @returns {Array<{region: RegionDocument, behavior: RegionBehavior, system: object, type: string}>}
 *          行为描述数组
 */
export function getBehaviorsBySubtype(subtype) {
  const found = [];
  if ( !canvas?.ready || !canvas.scene ) return found;
  for ( const region of canvas.scene.regions ) {
    for ( const behavior of region.behaviors ) {
      if ( !isBehaviorType(behavior.type, subtype) ) continue;
      found.push({region, behavior, system: behavior.system, type: behavior.type});
    }
  }
  return found;
}
