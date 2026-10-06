/**
 * er-qol 墙体 Behavior 模块（由旧模组 `region-walls` 迁移而来）。
 *
 * 迁移原则是"合并"而不是"重写"：
 * - Behavior 类、事件表、schema 字段名与 `initial` 值、PolygonBackend 包装逻辑（含单向阻挡方向、
 *   高度判定、射线落点高度插值）全部与旧模组一致；
 * - 旧文件里自带的 `elevationInRange` / `elevationRangeOverlaps` / `getProbeElevation` 已改为导入
 *   `./region-common.mjs` 的 `elevationInRegion` / `elevationRangeOverlaps` / `getProbeElevation`；
 * - 收集 Region 边界线段时改用 `getRegionPolygonEdges(region)`，不再直接读 `region.polygonTree`；
 * - 行为 type 的匹配统一走 `isBehaviorType(type, "regionWall")`，只认 er-qol 自己的
 *   `er-qol.regionWall`（旧模组 `region-walls` 从未发布，不保留其 type 键别名）；
 * - 注册拆成两步：`registerWallBehaviorTypes()` 由 `init.mjs` 在 `Hooks.once("init")` 调用，
 *   `installWalls()` 由 `init.mjs` 在 `Hooks.on("canvasInit")` 调用；本文件不再自行挂钩子。
 *
 * @module er-qol/scripts/region-walls
 */

import {
  WALL_TYPE,
  isBehaviorType,
  getRegionPolygonEdges,
  elevationInRegion,
  elevationRangeOverlaps,
  getProbeElevation
} from "./region-common.mjs";

/**
 * 墙体 Behavior 的 type 键（`er-qol.regionWall`）。
 *
 * er-qol 只用自己的命名空间：旧模组 `region-walls` 从未发布过，因此**不保留**它的
 * `region-walls.regionWall` 或裸子类型名 `regionWall` 作为别名，也不需要数据迁移。
 */
export const TYPE = WALL_TYPE;

/**
 * 由 `testCollision` 塞进 config、供后续阶段读取的"落点"键。
 *
 * 保持旧模组的字面量不变：这里存的是碰撞检测的目的点，用于在射线命中时插值出高度。
 */
const REGION_WALL_DESTINATION = "__regionWallsDestination";

/**
 * 阻挡方向模式。
 *
 * - `BOTH`：两个方向都挡；
 * - `INSIDE_TO_OUTSIDE`：只挡"从 Region 内部往外走"；
 * - `OUTSIDE_TO_INSIDE`：只挡"从外部往里走"。
 */
const DIRECTION_MODES = Object.freeze({
  BOTH: "both",
  INSIDE_TO_OUTSIDE: "insideToOutside",
  OUTSIDE_TO_INSIDE: "outsideToInside"
});

/**
 * 原始 PolygonBackend 类 → 包装类的缓存。
 *
 * 用 `WeakRef` 而不是强引用，避免模组卸载/热重载后把旧类永久留在内存里。
 * @type {WeakMap<Function, WeakRef<Function>>}
 */
const backendWrappers = new WeakMap();

/**
 * 「Region Walls」Behavior：把 Region 边界变成"墙"，阻挡移动 / 视觉 / 光照 / 声音 /（可选）黑暗。
 *
 * @extends {foundry.data.regionBehaviors.RegionBehaviorType}
 */
export class RegionWallBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  /**
   * 本地化前缀：`ERQOL.REGION_WALLS` 提供本 Behavior 自己的 label/hint。
   *
   * @override
   */
  static LOCALIZATION_PREFIXES = ["ERQOL.REGION_WALLS"];

  /**
   * 定义 schema。字段名与 `initial` 值与旧模组完全一致，仅把本地化键前缀换成 `ERQOL.REGION_WALLS`。
   *
   * @returns {object} RegionBehavior 的字段定义
   * @override
   */
  static defineSchema() {
    const {BooleanField, StringField} = foundry.data.fields;
    return {
      move: new BooleanField({
        initial: true,
        label: "ERQOL.REGION_WALLS.FIELDS.move.label",
        hint: "ERQOL.REGION_WALLS.FIELDS.move.hint"
      }),
      sight: new BooleanField({
        initial: true,
        label: "ERQOL.REGION_WALLS.FIELDS.sight.label",
        hint: "ERQOL.REGION_WALLS.FIELDS.sight.hint"
      }),
      light: new BooleanField({
        initial: true,
        label: "ERQOL.REGION_WALLS.FIELDS.light.label",
        hint: "ERQOL.REGION_WALLS.FIELDS.light.hint"
      }),
      sound: new BooleanField({
        initial: true,
        label: "ERQOL.REGION_WALLS.FIELDS.sound.label",
        hint: "ERQOL.REGION_WALLS.FIELDS.sound.hint"
      }),
      darkness: new BooleanField({
        initial: false,
        label: "ERQOL.REGION_WALLS.FIELDS.darkness.label",
        hint: "ERQOL.REGION_WALLS.FIELDS.darkness.hint"
      }),
      direction: new StringField({
        required: true,
        blank: false,
        initial: DIRECTION_MODES.BOTH,
        label: "ERQOL.REGION_WALLS.FIELDS.direction.label",
        hint: "ERQOL.REGION_WALLS.FIELDS.direction.hint",
        choices: {
          [DIRECTION_MODES.BOTH]: "ERQOL.REGION_WALLS.DIRECTIONS.both.label",
          [DIRECTION_MODES.INSIDE_TO_OUTSIDE]: "ERQOL.REGION_WALLS.DIRECTIONS.insideToOutside.label",
          [DIRECTION_MODES.OUTSIDE_TO_INSIDE]: "ERQOL.REGION_WALLS.DIRECTIONS.outsideToInside.label"
        }
      })
    };
  }

  /**
   * 事件表：行为激活状态/视野状态变化以及 Region 边界变化时都重算一次画布。
   *
   * @type {Record<string, Function>}
   * @override
   */
  static events = {
    [CONST.REGION_EVENTS.BEHAVIOR_ACTIVATED]: this.#refreshFromEvent,
    [CONST.REGION_EVENTS.BEHAVIOR_DEACTIVATED]: this.#refreshFromEvent,
    [CONST.REGION_EVENTS.BEHAVIOR_VIEWED]: this.#refreshFromEvent,
    [CONST.REGION_EVENTS.BEHAVIOR_UNVIEWED]: this.#refreshFromEvent,
    [CONST.REGION_EVENTS.REGION_BOUNDARY]: this.#refreshFromEvent
  };

  /**
   * 静态事件回调：把事件转成一次画布刷新。
   * （事件回调由 Foundry 以数据模型实例为 `this` 调用，因此这里能访问实例私有方法。）
   *
   * @returns {Promise<void>} 刷新完成后的 Promise
   */
  static async #refreshFromEvent() {
    this.#refreshCanvas();
  }

  /**
   * 判断该行为是否阻挡某类穿透（`type` 为 `move` / `sight` / `light` / `sound` / `darkness`）。
   *
   * @param {"move"|"sight"|"light"|"sound"|"darkness"} type 穿透类型
   * @returns {boolean} 阻挡返回 true
   */
  blocks(type) {
    return this[type] === true;
  }

  /**
   * 实例数据更新时刷新画布（只有 `system` 或 `disabled` 变化才需要）。
   *
   * @param {object} changed 变更数据
   * @param {object} options 更新选项
   * @param {string} userId 触发更新的用户 id
   * @returns {void}
   * @override
   */
  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    if ( ("system" in changed) || ("disabled" in changed) ) this.#refreshCanvas();
  }

  /**
   * 按当前勾选项刷新画布：光照/视觉/声音走感知层刷新，移动则重算计划路径。
   *
   * @returns {void}
   */
  #refreshCanvas() {
    if ( !canvas?.ready ) return;
    const refreshLighting = this.light || this.darkness;
    if ( refreshLighting || this.sight || this.sound ) {
      canvas.perception.update({
        initializeLighting: refreshLighting,
        initializeVision: this.sight,
        refreshLighting,
        refreshVision: this.sight,
        refreshSounds: this.sound
      });
    }
    if ( this.move ) canvas.tokens?.recalculatePlannedMovementPaths?.();
  }
}

/**
 * 取（必要时创建）某个 PolygonBackend 的包装类。
 *
 * 包装类做三件事：
 * 1. 在 `testCollision` 里把目的点存进 config，供后续阶段插值高度；
 * 2. 在 `_identifyEdges` 里把 Region 边界当作 `wall` 类型的边加进碰撞集合；
 * 3. 在 `_testCollision` 里过滤掉高度不匹配的命中，从而支持"仅在 Region 高度范围内阻挡"。
 *
 * 同一个原始类只会被包装一次（缓存于 `backendWrappers`）。
 *
 * @param {Function} PolygonBackend 原始 PolygonBackend 类
 * @returns {Function} 包装后的 PolygonBackend 子类
 */
function getWrappedBackend(PolygonBackend) {
  const existing = backendWrappers.get(PolygonBackend)?.deref();
  if ( existing ) return existing;

  /**
   * Region 墙体专用的 PolygonBackend 包装类。
   * @extends {PolygonBackend}
   */
  class RegionWallPolygonBackend extends PolygonBackend {
    /** 是否已经收集过 Region 边界（每个实例只做一次）。 */
    #identifiedRegionWalls = false;

    /**
     * 把目的点写进 config 后再执行原始碰撞检测。
     *
     * @param {object} origin 起点（含 `x` / `y` / `elevation`）
     * @param {object} destination 目的点（含 `x` / `y` / `elevation`）
     * @param {object} [config={}] PolygonBackend 配置
     * @returns {boolean} 原始实现的返回值
     * @override
     */
    static testCollision(origin, destination, config={}) {
      return super.testCollision(origin, destination, {
        ...config,
        [REGION_WALL_DESTINATION]: {
          x: Math.round(destination.x),
          y: Math.round(destination.y),
          elevation: destination.elevation ?? origin.elevation ?? config.source?.elevation ?? config.level?.elevation?.base ?? 0
        }
      });
    }

    /**
     * 在原始边界收集完成后，把命中的 Region 边界追加进 `this.edges`，
     * 并与已有边互相记录交点。
     *
     * @returns {void}
     * @override
     */
    _identifyEdges() {
      if ( this.#identifiedRegionWalls ) return;
      this.#identifiedRegionWalls = true;
      super._identifyEdges();
      const EdgeClass = this.#getEdgeClass();
      if ( !EdgeClass ) return;
      const edgeTypes = this._determineEdgeTypes(this.config.type, this.config.priority, this.config);
      const regionEdges = this.#collectRegionEdges(EdgeClass).filter(edge => this._testEdgeInclusion(edge, edgeTypes));
      if ( !regionEdges.length ) return;

      const existingEdges = Array.from(this.edges);
      for ( const edge of regionEdges ) {
        for ( const other of existingEdges ) edge.recordIntersections(other, this.level.id);
        existingEdges.push(edge);
        this.edges.add(edge);
      }
    }

    /**
     * 在原始命中结果上按高度过滤，并按 `mode` 返回布尔/数组/单条命中。
     *
     * @param {object} ray 射线
     * @param {"any"|"all"|"closest"} mode 返回模式
     * @param {object} destination 目的点
     * @param {number} tMin 命中参数下限
     * @param {number} tMax 命中参数上限
     * @returns {boolean|Array<object>|object|null} 过滤后的命中结果
     * @override
     */
    _testCollision(ray, mode, destination, tMin, tMax) {
      const collisions = super._testCollision(ray, "all", destination, tMin, tMax).filter(collision => {
        return Array.from(collision.edges).some(edge => this.#collisionMatchesElevation(edge, destination, collision._distance));
      });
      if ( mode === "any" ) return collisions.length > 0;
      if ( mode === "all" ) return collisions;
      return collisions[0] ?? null;
    }

    /**
     * 取用于创建边界边的 `Edge` 类：优先从已收集的边推断，退化时向当前 level 索取。
     *
     * @returns {Function|null} `Edge` 类，取不到时为 null
     */
    #getEdgeClass() {
      const firstEdge = this.edges.values().next().value;
      if ( firstEdge ) return firstEdge.constructor;
      const fallback = this.level?.edges?.getEdges?.(this.config.boundingBox, {
        includeOuterBounds: true,
        includeInnerBounds: true
      });
      return fallback?.[0]?.constructor;
    }

    /**
     * 收集落在本次检测包围盒内、当前高度区间重叠且方向匹配的 Region 边界线段。
     *
     * 线段来源统一走 `getRegionPolygonEdges()`（外环与洞都算），不再直接读 `region.polygonTree`。
     *
     * @param {Function} EdgeClass 用于实例化的 `Edge` 类
     * @returns {Array<object>} 新创建的 `Edge` 数组（尚未加入 `this.edges`）
     */
    #collectRegionEdges(EdgeClass) {
      const behaviors = getActiveRegionWallBehaviors(this.scene, this.level, this.config.type, this.origin.elevation,
        this.config[REGION_WALL_DESTINATION]?.elevation);
      if ( !behaviors.length ) return [];

      const edges = [];
      const boundingBox = this.config.boundingBox;
      for ( const behavior of behaviors ) {
        const directionMode = behavior.system.direction ?? DIRECTION_MODES.BOTH;
        const probeElevation = getProbeElevation(behavior.region);
        /** 本 Behavior 内每个多边形的线段序号，仅用于生成互不重复的 edge id。 */
        const segmentIndexes = new Map();
        for ( const segment of getRegionPolygonEdges(behavior.region) ) {
          const [a, b] = segment.points;
          if ( !segmentIntersectsRectangle(a, b, boundingBox) ) continue;
          const segmentIndex = segmentIndexes.get(segment.polygonIndex) ?? 0;
          segmentIndexes.set(segment.polygonIndex, segmentIndex + 1);
          const insideSide = getInsideSide(a, b, behavior.region, probeElevation);
          const direction = getEdgeDirection(directionMode, insideSide);
          const edge = new EdgeClass(a, b, {
            id: `${TYPE}.${behavior.id}.${Math.round(a.x)},${Math.round(a.y)}-${Math.round(b.x)},${Math.round(b.y)}.${segmentIndex}`,
            object: behavior,
            type: "wall",
            direction,
            light: behavior.system.light ? CONST.EDGE_SENSE_TYPES.NORMAL : CONST.EDGE_SENSE_TYPES.NONE,
            darkness: behavior.system.darkness ? CONST.EDGE_SENSE_TYPES.NORMAL : CONST.EDGE_SENSE_TYPES.NONE,
            move: behavior.system.move ? CONST.EDGE_SENSE_TYPES.NORMAL : CONST.EDGE_SENSE_TYPES.NONE,
            sight: behavior.system.sight ? CONST.EDGE_SENSE_TYPES.NORMAL : CONST.EDGE_SENSE_TYPES.NONE,
            sound: behavior.system.sound ? CONST.EDGE_SENSE_TYPES.NORMAL : CONST.EDGE_SENSE_TYPES.NONE
          });
          edge.regionWallBehavior = behavior;
          edges.push(edge);
        }
      }
      return edges;
    }

    /**
     * 判断一条命中边是否应该算作本次碰撞：非 Region 墙体边一律算，
     * 墙体边则要求插值出的高度落在该 Region 的高度范围内。
     *
     * @param {object} edge 命中的边
     * @param {object} destination 目的点
     * @param {number} t 命中在射线上的插值参数
     * @returns {boolean} 应该算作碰撞返回 true
     */
    #collisionMatchesElevation(edge, destination, t) {
      const behavior = edge.regionWallBehavior;
      if ( !behavior ) return true;
      const destinationElevation = destination?.elevation ?? this.origin.elevation;
      const elevation = Math.mix(this.origin.elevation, destinationElevation, t);
      return elevationInRegion(behavior.region, elevation);
    }
  }

  const ref = new WeakRef(RegionWallPolygonBackend);
  backendWrappers.set(PolygonBackend, ref);
  backendWrappers.set(RegionWallPolygonBackend, ref);
  return RegionWallPolygonBackend;
}

/**
 * 取当前场景中所有会对该类穿透生效的 Region 墙体行为。
 *
 * 行为 type 用 `isBehaviorType(type, "regionWall")` 匹配，即只认 `er-qol.regionWall`。
 * 高度判定用 `elevationInRegion` / `elevationRangeOverlaps`（无目的点高度时只看起点高度）。
 *
 * @param {Scene} scene 场景
 * @param {Level} level 当前 level
 * @param {"move"|"sight"|"light"|"sound"|"darkness"} type 穿透类型
 * @param {number} originElevation 起点高度
 * @param {number|undefined} destinationElevation 目的点高度，undefined 表示未知
 * @returns {Array<RegionBehavior>} 命中的行为
 */
function getActiveRegionWallBehaviors(scene, level, type, originElevation, destinationElevation) {
  const behaviors = [];
  for ( const region of scene.regions ) {
    if ( !region.includedInLevel(level) ) continue;
    for ( const behavior of region.behaviors ) {
      if ( !behavior.active || !isBehaviorType(behavior.type, "regionWall") ) continue;
      if ( !behavior.system.blocks?.(type) ) continue;
      if ( destinationElevation === undefined ) {
        if ( !elevationInRegion(region, originElevation) ) continue;
      } else if ( !elevationRangeOverlaps(region, originElevation, destinationElevation) ) continue;
      behaviors.push(behavior);
    }
  }
  return behaviors;
}

/**
 * 判断线段的哪一侧落在 Region 内部（用于单向阻挡）。
 *
 * 做法是取线段中点，沿法线两侧各偏移一点点（偏移量随线段长度自适应），
 * 再用 `region.testPoint()` 判定；两侧结果相同（都在内或都在外）时返回 `BOTH`。
 *
 * @param {{x: number, y: number}} a 线段起点
 * @param {{x: number, y: number}} b 线段终点
 * @param {RegionDocument} region 所属 Region
 * @param {number} elevation 判定所用高度
 * @returns {number} `CONST.EDGE_DIRECTIONS.LEFT` / `RIGHT` / `BOTH`
 */
function getInsideSide(a, b, region, elevation) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if ( length === 0 ) return CONST.EDGE_DIRECTIONS.BOTH;
  const offset = Math.max(1, Math.min(4, length / 4));
  const nx = (-dy / length) * offset;
  const ny = (dx / length) * offset;
  const midpoint = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
  const leftInside = region.testPoint({x: midpoint.x + nx, y: midpoint.y + ny, elevation});
  const rightInside = region.testPoint({x: midpoint.x - nx, y: midpoint.y - ny, elevation});
  if ( leftInside === rightInside ) return CONST.EDGE_DIRECTIONS.BOTH;
  return leftInside ? CONST.EDGE_DIRECTIONS.LEFT : CONST.EDGE_DIRECTIONS.RIGHT;
}

/**
 * 把"阻挡方向模式 + Region 内部所在侧"翻译成边的 `direction`。
 *
 * 注意：`ClockwiseSweepPolygon` 会在射线起点位于 `edge.direction` 一侧时忽略这条单向边，
 * 所以这里存的是**不阻挡**的那一侧，而不是被阻挡的那一侧。
 *
 * @param {string} directionMode `DIRECTION_MODES` 之一
 * @param {number} insideSide Region 内部相对线段的方向（`CONST.EDGE_DIRECTIONS.*`）
 * @returns {number} 边的 `direction`（`CONST.EDGE_DIRECTIONS.*`）
 */
function getEdgeDirection(directionMode, insideSide) {
  if ( (directionMode === DIRECTION_MODES.BOTH) || (insideSide === CONST.EDGE_DIRECTIONS.BOTH) ) {
    return CONST.EDGE_DIRECTIONS.BOTH;
  }
  // ClockwiseSweepPolygon filters out one-way edges when the origin is on edge.direction,
  // so the stored direction has to be the non-blocking side, not the blocked side.
  if ( directionMode === DIRECTION_MODES.INSIDE_TO_OUTSIDE ) return oppositeSide(insideSide);
  if ( directionMode === DIRECTION_MODES.OUTSIDE_TO_INSIDE ) return insideSide;
  return CONST.EDGE_DIRECTIONS.BOTH;
}

/**
 * 取相反方向。
 *
 * @param {number} side `CONST.EDGE_DIRECTIONS.LEFT` / `RIGHT` / `BOTH`
 * @returns {number} 相反方向，无法取反时返回 `BOTH`
 */
function oppositeSide(side) {
  if ( side === CONST.EDGE_DIRECTIONS.LEFT ) return CONST.EDGE_DIRECTIONS.RIGHT;
  if ( side === CONST.EDGE_DIRECTIONS.RIGHT ) return CONST.EDGE_DIRECTIONS.LEFT;
  return CONST.EDGE_DIRECTIONS.BOTH;
}

/**
 * 判断线段是否与矩形相交（端点落在矩形内，或与矩形四条边相交）。
 *
 * @param {{x: number, y: number}} a 线段起点
 * @param {{x: number, y: number}} b 线段终点
 * @param {PIXI.Rectangle} rectangle 检测用包围盒
 * @returns {boolean} 相交返回 true
 */
function segmentIntersectsRectangle(a, b, rectangle) {
  if ( rectangle.contains(a.x, a.y) || rectangle.contains(b.x, b.y) ) return true;
  const topLeft = {x: rectangle.left, y: rectangle.top};
  const topRight = {x: rectangle.right, y: rectangle.top};
  const bottomLeft = {x: rectangle.left, y: rectangle.bottom};
  const bottomRight = {x: rectangle.right, y: rectangle.bottom};
  return foundry.utils.lineSegmentIntersects(a, b, topLeft, topRight)
    || foundry.utils.lineSegmentIntersects(a, b, topRight, bottomRight)
    || foundry.utils.lineSegmentIntersects(a, b, bottomRight, bottomLeft)
    || foundry.utils.lineSegmentIntersects(a, b, bottomLeft, topLeft);
}

/** PolygonBackend 是否已经包装过（`installWalls()` 幂等）。 */
let wallsInstalled = false;

/**
 * 包装 PolygonBackend，让 Region 边界参与碰撞检测。
 *
 * 由 `init.mjs` 在 `Hooks.on("canvasInit")` 中调用（必须在画布初始化时安装）；
 * 重复调用是幂等的：`getWrappedBackend()` 对同一个原始类只会包装一次。
 *
 * @returns {void}
 */
export function installWalls() {
  if ( wallsInstalled ) return;
  wallsInstalled = true;

  for ( const type of ["move", "sight", "light", "sound", "darkness"] ) {
    const PolygonBackend = CONFIG.Canvas.polygonBackends[type];
    if ( !PolygonBackend ) continue;
    CONFIG.Canvas.polygonBackends[type] = getWrappedBackend(PolygonBackend);
  }
}

/**
 * 注册「Region Walls」Behavior 的 type 键。
 *
 * 只注册 er-qol 自己的 `er-qol.regionWall`（不保留旧模组 `region-walls` 的 type 键别名，
 * 该模组从未发布过、不需要数据迁移）。
 *
 * 必须在 `Hooks.once("init")` 中调用（由 `init.mjs` 统一调用）。
 *
 * @returns {void}
 */
export function registerWallBehaviorTypes() {
  CONFIG.RegionBehavior.dataModels[WALL_TYPE] = RegionWallBehaviorType;
  CONFIG.RegionBehavior.typeLabels[WALL_TYPE] = "ERQOL.REGION_WALLS.label";
  CONFIG.RegionBehavior.typeHints[WALL_TYPE] = "ERQOL.REGION_WALLS.hint";
  CONFIG.RegionBehavior.typeIcons[WALL_TYPE] = "fa-solid fa-bars";
}
