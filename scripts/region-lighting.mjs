/**
 * er-qol 光照 / 黑暗 Behavior 模块（由旧模组 `region-lighting` 迁移而来）。
 *
 * 迁移原则是"合并"而不是"重写"：
 * - Behavior 类、光照/黑暗 Source 类、事件表、schema 字段名与 `initial` 值、边/网格/遮罩的构建逻辑
 *   全部与旧模组一致，只把模块 id、type 键与本地化前缀换成 er-qol 的约定；
 * - 旧文件里自带的那份 Region 几何/高度工具（`getPrimaryRegionPolygon`、`getRegionRepresentativePoint`、
 *   `getRegionSamplePoints`、`getRegionSampleElevation`、`computeTriangulationCentroid`、
 *   `getFirstTrianglePoint`、`getRegionPolygonTree`、`getRegionBounds`、`getRegionTriangulation`、
 *   `getRegionState`、`isBehaviorRenderable`）已搬到 `./region-common.mjs` 并在此导入，
 *   本文件不再重复实现（`getRegionState` / `computeTriangulationCentroid` / `getFirstTrianglePoint`
 *   目前由 `getRegionRepresentativePoint()` 内部调用，此处一并导入以固定"唯一实现来源"）；
 * - 注册拆成两步：`registerLightingBehaviorTypes()` 由 `init.mjs` 在 `Hooks.once("init")` 调用，
 *   `installLighting()` 由 `init.mjs` 在 `Hooks.once("ready")` 调用；本文件不再自行挂 `once` 钩子。
 *
 * @module er-qol/scripts/region-lighting
 */

import {
  MODULE_ID,
  LIGHTING_TYPE,
  isActiveBehaviorType,
  getRegistrableTypes,
  getPrimaryRegionPolygon,
  getRegionRepresentativePoint,
  getRegionSamplePoints,
  getRegionSampleElevation,
  getRegionPolygonTree,
  getRegionBounds,
  getRegionTriangulation,
  isBehaviorRenderable,
  refreshPerception,
  updateRegionShapeConstraints
} from "./region-common.mjs";

/**
 * 规范化后的 Behavior type 键（`er-qol.regionLighting`）。
 *
 * 旧键 `region-lighting.regionLighting` 与裸子类型名 `regionLighting` 都由
 * `registerLightingBehaviorTypes()` 注册成同一个类，老世界无需迁移数据。
 */
export const TYPE = LIGHTING_TYPE;

/**
 * Region 光照/黑暗源的默认数据。
 *
 * `region` / `regionBottom` / `regionTop` / `regionTopInclusive` / `samplePoints` 会在
 * `initialize()` 时由 `getBehaviorSourceData()` 写入，其余字段沿用 Foundry 光源的默认值。
 *
 * @type {object}
 */
const REGION_SOURCE_DEFAULT_DATA = {
  region: null,
  regionBottom: null,
  regionTop: null,
  regionTopInclusive: false,
  samplePoints: []
};

/**
 * 「Region Lighting」Behavior：用 Region 的完整形状（含高度范围）发出光照或黑暗。
 *
 * @extends {foundry.data.regionBehaviors.RegionBehaviorType}
 */
export class RegionLightingBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  /**
   * 本地化前缀：`ERQOL.REGION_LIGHTING` 提供本 Behavior 自己的 label/hint，
   * `LIGHT` 与 `BEHAVIOR.TYPES.base` 继续复用 Foundry 核心键（schema 里对核心键的引用保持原样）。
   *
   * @override
   */
  static LOCALIZATION_PREFIXES = ["ERQOL.REGION_LIGHTING", "LIGHT", "BEHAVIOR.TYPES.base"];

  /**
   * 定义 schema。字段名、`initial` 值与校验规则与旧模组完全一致，
   * 仅把自有本地化键的前缀换成 `ERQOL.REGION_LIGHTING`。
   *
   * @returns {object} RegionBehavior 的字段定义
   * @override
   */
  static defineSchema() {
    const {AlphaField, BooleanField, ColorField, NumberField, SchemaField, StringField} = foundry.data.fields;
    return {
      negative: new BooleanField({
        initial: false,
        label: "LIGHT.FIELDS.negative.label"
      }),
      priority: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0,
        label: "LIGHT.FIELDS.priority.label",
        hint: "ERQOL.REGION_LIGHTING.FIELDS.priority.hint"
      }),
      alpha: new AlphaField({
        initial: 0.5,
        label: "LIGHT.FIELDS.alpha.label"
      }),
      bright: new NumberField({
        required: true,
        nullable: false,
        min: 0,
        step: 0.01,
        initial: 0,
        label: "LIGHT.FIELDS.bright.label"
      }),
      dim: new NumberField({
        required: true,
        nullable: false,
        min: 0,
        step: 0.01,
        initial: 20,
        label: "LIGHT.FIELDS.dim.label"
      }),
      color: new ColorField({
        label: "LIGHT.FIELDS.color.label"
      }),
      coloration: new NumberField({
        required: true,
        nullable: false,
        integer: true,
        initial: 1,
        choices: getColorationChoices,
        label: "LIGHT.FIELDS.coloration.label"
      }),
      attenuation: new AlphaField({
        initial: 0.5,
        label: "LIGHT.FIELDS.attenuation.label"
      }),
      luminosity: new NumberField({
        required: true,
        nullable: false,
        min: 0,
        max: 1,
        initial: 0.5,
        step: 0.01,
        label: "LIGHT.FIELDS.luminosity.label"
      }),
      saturation: new NumberField({
        required: true,
        nullable: false,
        min: -1,
        max: 1,
        initial: 0,
        step: 0.01,
        label: "LIGHT.FIELDS.saturation.label"
      }),
      contrast: new NumberField({
        required: true,
        nullable: false,
        min: -1,
        max: 1,
        initial: 0,
        step: 0.01,
        label: "LIGHT.FIELDS.contrast.label"
      }),
      shadows: new NumberField({
        required: true,
        nullable: false,
        min: 0,
        max: 1,
        initial: 0,
        step: 0.01,
        label: "LIGHT.FIELDS.shadows.label"
      }),
      animation: new SchemaField({
        type: new StringField({
          required: true,
          blank: true,
          initial: "",
          choices: getAnimationChoices,
          label: "LIGHT.FIELDS.animation.type.label",
          hint: "ERQOL.REGION_LIGHTING.FIELDS.animation.type.hint"
        }),
        speed: new NumberField({
          required: true,
          nullable: false,
          integer: true,
          min: 0,
          max: 10,
          initial: 5,
          label: "LIGHT.FIELDS.animation.speed.label"
        }),
        intensity: new NumberField({
          required: true,
          nullable: false,
          integer: true,
          min: 1,
          max: 10,
          initial: 5,
          label: "LIGHT.FIELDS.animation.intensity.label"
        }),
        reverse: new BooleanField({
          initial: false,
          label: "LIGHT.FIELDS.animation.reverse.label"
        })
      }),
      darkness: new SchemaField({
        min: new AlphaField({
          initial: 0,
          label: "LIGHT.FIELDS.darkness.min.label"
        }),
        max: new AlphaField({
          initial: 1,
          label: "LIGHT.FIELDS.darkness.max.label"
        })
      }, {
        validate: value => (value.min ?? 0) <= (value.max ?? 1),
        validationError: "darkness.max may not be less than darkness.min"
      })
    };
  }

  /**
   * 事件表：行为被激活/取消激活、进入/离开视野、边界变化、动画推进时都同步一次光源。
   *
   * @type {Record<string, Function>}
   * @override
   */
  static events = {
    [CONST.REGION_EVENTS.BEHAVIOR_ACTIVATED]: this.#syncFromEvent,
    [CONST.REGION_EVENTS.BEHAVIOR_DEACTIVATED]: this.#destroyFromEvent,
    [CONST.REGION_EVENTS.BEHAVIOR_VIEWED]: this.#syncFromEvent,
    [CONST.REGION_EVENTS.BEHAVIOR_UNVIEWED]: this.#destroyFromEvent,
    [CONST.REGION_EVENTS.REGION_BOUNDARY]: this.#syncFromEvent,
    [CONST.REGION_EVENTS.REGION_ANIMATION]: this.#syncFromEvent
  };

  /**
   * 静态事件回调：把事件转成一次光源同步。
   * （事件回调由 Foundry 以数据模型实例为 `this` 调用，因此这里能访问实例私有方法/字段。）
   *
   * @returns {Promise<void>} 同步完成后的 Promise
   */
  static async #syncFromEvent() {
    syncBehaviorSource(this);
  }

  /**
   * 静态事件回调：把事件转成一次光源销毁。
   *
   * @returns {Promise<void>} 销毁完成后的 Promise
   */
  static async #destroyFromEvent() {
    destroyBehaviorSource(this.behavior);
  }

  /**
   * 实例数据更新时同步光源（只有 `system` 或 `disabled` 变化才需要）。
   *
   * @param {object} changed 变更数据
   * @param {object} options 更新选项
   * @param {string} userId 触发更新的用户 id
   * @returns {void}
   * @override
   */
  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    if ( ("system" in changed) || ("disabled" in changed) ) syncBehaviorSource(this);
  }

  /**
   * 行为被删除时销毁对应的光源。
   *
   * @param {object} options 删除选项
   * @param {string} userId 触发删除的用户 id
   * @returns {void}
   * @override
   */
  _onDelete(options, userId) {
    super._onDelete(options, userId);
    destroyBehaviorSource(this.behavior);
  }
}

/**
 * Region 光照源：把 Region 的完整形状当作一个有半径的光源体，
 * 支持 Region 边界遮挡（边）以及按优先级压制其它光源。
 *
 * @extends {CONFIG.Canvas.lightSourceClass}
 */
export class RegionLightSource extends CONFIG.Canvas.lightSourceClass {
  /**
   * 默认数据：在 Foundry 光照源默认值之上叠加 Region 源自己的字段。
   *
   * @type {object}
   * @override
   */
  static defaultData = {
    ...super.defaultData,
    ...REGION_SOURCE_DEFAULT_DATA
  };

  /**
   * 关闭软边缘：Region 光源的形状由 Region 边界决定，不做径向羽化。
   *
   * @returns {void}
   * @override
   */
  _initializeSoftEdges() {
    this._flags.renderSoftEdges = false;
  }

  /**
   * 创建形状：清掉旧边、按更高优先级的光照源计算压制状态、并把形状设为 Region 主多边形。
   *
   * @returns {void}
   * @override
   */
  _createShapes() {
    this._deleteEdges();
    this.suppression.darkness = isRegionSourceSuppressed(this, canvas.effects.darknessSources,
      darknessSource => this.priority <= darknessSource.priority);
    this.shape = getPrimaryRegionPolygon(this.data.region);
  }

  /**
   * 创建边界：Region 的每条边界都会生成一条遮光边。
   *
   * @returns {void}
   * @override
   */
  _createEdges() {
    createRegionSourceEdges(this);
  }

  /**
   * 更新几何：把 Region 的三角剖分归一化到以光源原点为中心、半径为 1 的坐标系。
   *
   * @returns {void}
   * @override
   */
  _updateGeometry() {
    updateRegionSourceGeometry(this);
  }

  /**
   * 绘制网格：把网格缩放到光源半径。
   *
   * @param {string} layerId 图层 id
   * @returns {PIXI.Mesh|null} 绘制出的网格，图层未激活时为 null
   * @override
   */
  _drawMesh(layerId) {
    const mesh = drawRegionSourceMesh(this, layerId);
    if ( mesh ) mesh.scale.set(this.radius);
    return mesh;
  }

  /**
   * 点判定：点必须同时落在 Region 形状与 Region 高度范围内。
   *
   * @param {object} point 待判定点（含 `x` / `y` / `elevation`）
   * @returns {boolean} 命中返回 true
   * @override
   */
  testPoint(point) {
    return testRegionSourcePoint(this, point);
  }
}

/**
 * Region 黑暗源：与 `RegionLightSource` 对称，但压制关系按"比它更暗/更低优先级"的光照源判断，
 * 并且不维护 `_visualShape`。
 *
 * @extends {CONFIG.Canvas.darknessSourceClass}
 */
export class RegionDarknessSource extends CONFIG.Canvas.darknessSourceClass {
  /**
   * 默认数据：在 Foundry 黑暗源默认值之上叠加 Region 源自己的字段。
   *
   * @type {object}
   * @override
   */
  static defaultData = {
    ...super.defaultData,
    ...REGION_SOURCE_DEFAULT_DATA
  };

  /** 黑暗源不额外扩张内边距。 */
  _padding = 0;

  /**
   * 关闭软边缘：Region 黑暗源的形状由 Region 边界决定。
   *
   * @returns {void}
   * @override
   */
  _initializeSoftEdges() {
    this._flags.renderSoftEdges = false;
  }

  /**
   * 创建形状：清掉旧边与可视形状、按更低优先级的光照源计算压制状态、并把形状设为 Region 主多边形。
   *
   * @returns {void}
   * @override
   */
  _createShapes() {
    this._deleteEdges();
    this._visualShape = null;
    this.suppression.light = isRegionSourceSuppressed(this, canvas.effects.lightSources,
      lightSource => this.priority < lightSource.priority);
    this.shape = getPrimaryRegionPolygon(this.data.region);
  }

  /**
   * 创建边界：Region 的每条边界都会生成一条遮光边。
   *
   * @returns {void}
   * @override
   */
  _createEdges() {
    createRegionSourceEdges(this);
  }

  /**
   * 更新几何：把 Region 的三角剖分归一化到以光源原点为中心、半径为 1 的坐标系。
   *
   * @returns {void}
   * @override
   */
  _updateGeometry() {
    updateRegionSourceGeometry(this);
  }

  /**
   * 绘制网格：把网格缩放到光源半径。
   *
   * @param {string} layerId 图层 id
   * @returns {PIXI.Mesh|null} 绘制出的网格，图层未激活时为 null
   * @override
   */
  _drawMesh(layerId) {
    const mesh = drawRegionSourceMesh(this, layerId);
    if ( mesh ) mesh.scale.set(this.radius);
    return mesh;
  }

  /**
   * 点判定：点必须同时落在 Region 形状与 Region 高度范围内。
   *
   * @param {object} point 待判定点（含 `x` / `y` / `elevation`）
   * @returns {boolean} 命中返回 true
   * @override
   */
  testPoint(point) {
    return testRegionSourcePoint(this, point);
  }
}

/**
 * 组装光照动画下拉框的选项（Foundry 注册的光照动画 + 黑暗动画，键相同时以前者为准）。
 *
 * @returns {Record<string, string>} `动画 id → 本地化标签`，含空字符串选项（无动画）
 */
function getAnimationChoices() {
  const choices = {
    "": "LIGHT.FIELDS.animation.type.none"
  };
  for ( const collection of [CONFIG.Canvas.lightAnimations ?? {}, CONFIG.Canvas.darknessAnimations ?? {}] ) {
    for ( const [key, config] of foundry.utils.objectEntries(collection) ) {
      choices[key] ??= config.label;
    }
  }
  return choices;
}

/**
 * 组装着色技术下拉框的选项（自适应光照 shader 的 `SHADER_TECHNIQUES`）。
 *
 * @returns {Record<number, string>} `技术 id → 本地化标签`
 */
function getColorationChoices() {
  const techniques = foundry.canvas.rendering.shaders.AdaptiveLightingShader.SHADER_TECHNIQUES ?? {};
  return Object.fromEntries(foundry.utils.objectValues(techniques).map(config => [config.id, config.label]));
}

/**
 * 由行为文档生成光照源 id。用 `behavior.uuid` 保证跨场景唯一。
 *
 * @param {RegionBehavior} behavior Region 行为文档
 * @returns {string} 光照源 id
 */
function getBehaviorSourceId(behavior) {
  return `${MODULE_ID}.${behavior.uuid}`;
}

/**
 * 取行为当前对应的光源（先查光照源集合，再查黑暗源集合）。
 *
 * @param {RegionBehavior} behavior Region 行为文档
 * @returns {RegionLightSource|RegionDarknessSource|undefined} 已存在的光源，不存在时为 undefined
 */
function getBehaviorSource(behavior) {
  const sourceId = getBehaviorSourceId(behavior);
  return canvas.effects.lightSources.get(sourceId) ?? canvas.effects.darknessSources.get(sourceId);
}

/**
 * 同步一个行为对应的光源：不可渲染则销毁；否则按当前 schema 数据重建/更新光源，
 * 并在"是否黑暗源"或"优先级"变化时重建（因为压制关系与边是否参与遮挡都随之改变）。
 *
 * @param {RegionLightingBehaviorType} behaviorType 行为的数据模型实例
 * @returns {void}
 */
function syncBehaviorSource(behaviorType) {
  if ( !isBehaviorRenderable(behaviorType) ) {
    destroyBehaviorSource(behaviorType?.behavior);
    return;
  }

  const behavior = behaviorType.behavior;
  const sourceId = getBehaviorSourceId(behavior);
  const source = getBehaviorSource(behavior);
  const wasLight = canvas.effects.lightSources.has(sourceId);
  const wasDarkness = canvas.effects.darknessSources.has(sourceId);
  const previousPriority = source?.priority ?? 0;
  const isDarkness = !!behaviorType.negative;
  const edgesBefore = wasDarkness || (wasLight && (previousPriority > 0));
  const edgesNow = isDarkness || (behaviorType.priority > 0);
  const darknessChanged = wasDarkness !== isDarkness;
  const priorityChanged = previousPriority !== behaviorType.priority;

  if ( darknessChanged || priorityChanged ) destroyBehaviorSource(behavior, {suppressPerception: true});

  let activeSource = getBehaviorSource(behavior);
  if ( !activeSource ) {
    const SourceClass = isDarkness ? RegionDarknessSource : RegionLightSource;
    activeSource = new SourceClass({sourceId, object: behaviorType.region.object});
  }

  activeSource.initialize(getBehaviorSourceData(behaviorType), {reset: true});
  activeSource.add();

  if ( edgesBefore || edgesNow ) updateRegionSourceConstraints(behaviorType.region.parent, wasDarkness, isDarkness);
  refreshPerception({
    lighting: edgesBefore || edgesNow,
    vision: edgesBefore || edgesNow
  });
}

/**
 * 销毁行为对应的光源，并按需要刷新感知层。
 *
 * @param {RegionBehavior} behavior Region 行为文档
 * @param {object} [options] 选项
 * @param {boolean} [options.suppressPerception=false] 为 true 时只销毁光源、不刷新感知
 *        （调用方会紧接着重建光源并自行刷新，避免重复计算）
 * @returns {void}
 */
function destroyBehaviorSource(behavior, {suppressPerception=false}={}) {
  if ( !canvas?.ready || !behavior ) return;
  const sourceId = getBehaviorSourceId(behavior);
  const source = getBehaviorSource(behavior);
  if ( !source ) return;

  const wasDarkness = canvas.effects.darknessSources.has(sourceId);
  const wasLight = canvas.effects.lightSources.has(sourceId);
  const previousPriority = source.priority ?? 0;
  const edgesBefore = wasDarkness || (wasLight && (previousPriority > 0));

  source.destroy();
  if ( suppressPerception ) return;

  if ( edgesBefore ) updateRegionSourceConstraints(behavior.parent?.parent, wasDarkness, false);
  refreshPerception({
    lighting: edgesBefore,
    vision: edgesBefore
  });
}

/**
 * 把"变化前/后是否为黑暗源"翻译成受影响类型列表，再交给 `region-common` 请求场景重算约束。
 *
 * 与旧实现的等价条件：
 * - 只要前后任一是黑暗源 → 影响 `light` 与 `sight`；
 * - 只要前后不全是黑暗源 → 影响 `darkness`（`region-common` 会自行去重）。
 *
 * @param {Scene} scene 目标场景
 * @param {boolean} wasDarkness 变化前是否为黑暗源
 * @param {boolean} isDarkness 变化后是否为黑暗源
 * @returns {void}
 */
function updateRegionSourceConstraints(scene, wasDarkness, isDarkness) {
  if ( !scene?.updateRegionShapeConstraints ) return;
  const affectedTypes = [];
  if ( wasDarkness || isDarkness ) affectedTypes.push("light", "sight");
  if ( !wasDarkness || !isDarkness ) affectedTypes.push("darkness");
  updateRegionShapeConstraints(scene, affectedTypes);
}

/**
 * 由行为数据组装光源初始化数据（位置/高度/采样点/亮度/颜色/动画/压制等）。
 *
 * @param {RegionLightingBehaviorType} behaviorType 行为的数据模型实例
 * @returns {object} 传给 `LightSource#initialize()` 的数据
 */
function getBehaviorSourceData(behaviorType) {
  const region = behaviorType.region;
  const elevation = getRegionSampleElevation(region);
  const origin = getRegionRepresentativePoint(region, elevation);
  const level = canvas.inferLevelFromElevation(origin.elevation, {levels: region.levels});
  const distancePixels = canvas.dimensions.distancePixels;
  return {
    x: origin.x,
    y: origin.y,
    elevation: origin.elevation,
    level: level?.id,
    region,
    regionBottom: region.elevation.bottom,
    regionTop: region.elevation.top,
    regionTopInclusive: region.elevation.topInclusive,
    samplePoints: getRegionSamplePoints(region, origin),
    bright: behaviorType.bright * distancePixels,
    dim: behaviorType.dim * distancePixels,
    alpha: behaviorType.alpha,
    color: behaviorType.color ?? null,
    coloration: behaviorType.coloration,
    attenuation: behaviorType.attenuation,
    luminosity: behaviorType.luminosity,
    saturation: behaviorType.saturation,
    contrast: behaviorType.contrast,
    shadows: behaviorType.shadows,
    priority: behaviorType.priority,
    darkness: {
      min: behaviorType.darkness.min,
      max: behaviorType.darkness.max
    },
    animation: {
      type: behaviorType.animation.type || null,
      speed: behaviorType.animation.speed,
      intensity: behaviorType.animation.intensity,
      reverse: behaviorType.animation.reverse
    },
    disabled: !behaviorType.behavior.active,
    preview: false
  };
}

/**
 * 判断光源是否被集合里的其它光源完全压制：所有采样点都被某个满足条件的光源覆盖时返回 true。
 *
 * @param {RegionLightSource|RegionDarknessSource} source 待判定的光源
 * @param {Iterable<object>} collection 与之比较的光源集合
 * @param {(otherSource: object) => boolean} condition 判定"其它光源是否具备压制资格"的回调
 * @returns {boolean} 被完全压制返回 true
 */
function isRegionSourceSuppressed(source, collection, condition) {
  if ( !source.data.samplePoints?.length ) return false;
  return source.data.samplePoints.every(point => {
    for ( const otherSource of collection ) {
      if ( !otherSource.active || (otherSource.sourceId === source.sourceId) ) continue;
      if ( condition(otherSource) === false ) continue;
      if ( otherSource.testPoint(point) ) return true;
    }
    return false;
  });
}

/**
 * 为光源创建边界遮挡用的 `Edge`：为 Region 多边形树的每个节点逐段生成，并登记到 `canvas.edges`。
 *
 * 多边形遍历统一走 `getRegionPolygonTree()`，不再直接读 `region.polygonTree`。
 *
 * @param {RegionLightSource|RegionDarknessSource} source 光源
 * @returns {void}
 */
function createRegionSourceEdges(source) {
  if ( !source.requiresEdges || !source.active || source.isPreview ) return;
  const EdgeClass = foundry.canvas.geometry.edges.Edge;
  const edgeOptions = source._getEdgeCreationOptions();
  let polygonIndex = 0;

  for ( const node of getRegionPolygonTree(source.data.region) ) {
    const points = node.polygon.points;
    if ( points.length < 6 ) continue;
    for ( let i = 0; i < points.length; i += 2 ) {
      const next = (i + 2) % points.length;
      const p0 = {x: points[i], y: points[i + 1]};
      const p1 = {x: points[next], y: points[next + 1]};
      if ( (p0.x === p1.x) && (p0.y === p1.y) ) continue;
      const id = `${source.constructor.sourceType}.${source.sourceId}.${polygonIndex}.${i / 2}`;
      const edge = new EdgeClass(p0, p1, {...edgeOptions, id});
      source.edges.push(edge);
      canvas.edges.set(edge.id, edge);
    }
    polygonIndex += 1;
  }
}

/**
 * 用 Region 的三角剖分重建光源几何：顶点归一化到"原点 + 半径"坐标系，深度全为 1，索引沿用剖分索引。
 *
 * @param {RegionLightSource|RegionDarknessSource} source 光源
 * @returns {void}
 */
function updateRegionSourceGeometry(source) {
  const geometry = source._geometry ?? createRegionSourceGeometry();
  const radius = source.radius;
  const triangulation = getRegionTriangulation(source.data.region);
  const vertices = (radius > 0)
    ? normalizeRegionVertices(triangulation.vertices, source.origin.x, source.origin.y, radius)
    : new Float32Array();
  const depth = new Float32Array(vertices.length / 2).fill(1);
  const indices = (radius > 0) ? triangulation.indices : new Uint16Array();

  geometry.getBuffer("aVertexPosition").update(vertices);
  geometry.getBuffer("aDepthValue").update(depth);
  geometry.indexBuffer.update(indices);
  source._geometry = geometry;

  const bounds = new PIXI.Rectangle(0, 0, 0, 0);
  if ( radius > 0 ) {
    const regionBounds = getRegionBounds(source.data.region);
    bounds.x = (regionBounds.x - source.origin.x) / radius;
    bounds.y = (regionBounds.y - source.origin.y) / radius;
    bounds.width = regionBounds.width / radius;
    bounds.height = regionBounds.height / radius;
  }
  if ( source._geometry.bounds ) source._geometry.bounds.copyFrom(bounds);
  else source._geometry.bounds = bounds;
}

/**
 * 创建一个空的 Region 光源几何（顶点 / 深度 / 索引三个缓冲）。
 *
 * @returns {PIXI.Geometry} 空几何
 */
function createRegionSourceGeometry() {
  return new PIXI.Geometry()
    .addAttribute("aVertexPosition", new PIXI.Buffer(new Float32Array(), true, false), 2)
    .addAttribute("aDepthValue", new PIXI.Buffer(new Float32Array(), true, false), 1)
    .addIndex(new PIXI.Buffer(new Uint16Array(), true, true));
}

/**
 * 把绝对坐标顶点归一化到以光源原点为中心、半径为 1 的坐标系。
 *
 * @param {Float32Array|ArrayLike<number>} vertices 绝对坐标顶点（`[x0, y0, x1, y1, ...]`）
 * @param {number} originX 光源原点 X
 * @param {number} originY 光源原点 Y
 * @param {number} radius 光源半径
 * @returns {Float32Array} 归一化后的顶点
 */
function normalizeRegionVertices(vertices, originX, originY, radius) {
  const normalized = new Float32Array(vertices.length);
  for ( let i = 0; i < vertices.length; i += 2 ) {
    normalized[i] = (vertices[i] - originX) / radius;
    normalized[i + 1] = (vertices[i + 1] - originY) / radius;
  }
  return normalized;
}

/**
 * 绘制光源网格：必要时先刷新该图层的 uniform，再把网格摆到光源位置。
 *
 * @param {RegionLightSource|RegionDarknessSource} source 光源
 * @param {string} layerId 图层 id
 * @returns {PIXI.Mesh|null} 网格；图层未激活时返回 null（并隐藏网格）
 */
function drawRegionSourceMesh(source, layerId) {
  const layer = source.layers[layerId];
  const mesh = layer.mesh;

  if ( layer.reset ) {
    const fn = source[`_update${layerId.titleCase()}Uniforms`];
    fn.call(source);
  }
  if ( !layer.active ) {
    mesh.visible = false;
    return null;
  }

  mesh.position.set(source.data.x, source.data.y);
  mesh.visible = mesh.renderable = true;
  return mesh;
}

/**
 * 光源点判定：点必须通过 Region 的二维点判定，并落在 Region 的高度范围内。
 *
 * @param {RegionLightSource|RegionDarknessSource} source 光源
 * @param {object} point 待判定点（含 `x` / `y` / `elevation`）
 * @returns {boolean} 命中返回 true
 */
function testRegionSourcePoint(source, point) {
  const region = source.data.region;
  if ( !region?.testPoint(point) ) return false;
  return pointInRegionElevation(source, point.elevation);
}

/**
 * 判断高度是否落在光源记录的 Region 高度范围内（`regionTopInclusive` 控制上界是否闭合）。
 *
 * @param {RegionLightSource|RegionDarknessSource} source 光源
 * @param {number} elevation 待判定高度
 * @returns {boolean} 在范围内返回 true
 */
function pointInRegionElevation(source, elevation) {
  const bottom = source.data.regionBottom;
  const top = source.data.regionTop;
  if ( (bottom != null) && (elevation < bottom) ) return false;
  if ( (top == null) || (elevation < top) ) return true;
  return !!source.data.regionTopInclusive && (elevation === top);
}

/**
 * 同步场景里所有 Region Lighting 行为（含旧 type 别名）的光源。
 *
 * @returns {void}
 */
function syncAllBehaviorSources() {
  if ( !canvas?.ready ) return;
  for ( const region of canvas.scene.regions ) {
    for ( const behavior of region.behaviors ) {
      if ( !isActiveBehaviorType(behavior.type, "regionLighting") ) continue;
      syncBehaviorSource(behavior.system);
    }
  }
}

/** 画布钩子是否已安装（`installLighting()` 幂等）。 */
let lightingInstalled = false;

/**
 * 安装光照/黑暗源需要的画布钩子。
 *
 * 由 `init.mjs` 在 `Hooks.once("ready")` 中调用；重复调用是幂等的。
 *
 * @returns {void}
 */
export function installLighting() {
  if ( lightingInstalled ) return;
  lightingInstalled = true;

  Hooks.on("canvasReady", syncAllBehaviorSources);
  Hooks.on("deleteRegion", region => {
    for ( const behavior of region.behaviors ) {
      if ( isActiveBehaviorType(behavior.type, "regionLighting") ) destroyBehaviorSource(behavior);
    }
  });
  Hooks.on("deleteRegionBehavior", behavior => {
    if ( isActiveBehaviorType(behavior.type, "regionLighting") ) destroyBehaviorSource(behavior);
  });

  syncAllBehaviorSources();
}

/**
 * 注册「Region Lighting」Behavior 的 type 键。
 *
 * 规范化键 `er-qol.regionLighting` 始终注册；旧模组的别名键只在
 * **旧 `region-lighting` 未启用**时注册——旧模组启用时会自己处理旧键，
 * er-qol 再注册/处理一遍会让同一个行为产生两个光照源。
 * `typeLabels` / `typeHints` / `typeIcons` 只写给规范化键，否则下拉框会出现重复条目。
 *
 * 必须在 `Hooks.once("init")` 中调用（由 `init.mjs` 统一调用）。
 *
 * @returns {void}
 */
export function registerLightingBehaviorTypes() {
  for ( const type of getRegistrableTypes("regionLighting") ) {
    CONFIG.RegionBehavior.dataModels[type] = RegionLightingBehaviorType;
  }
  CONFIG.RegionBehavior.typeLabels[LIGHTING_TYPE] = "ERQOL.REGION_LIGHTING.label";
  CONFIG.RegionBehavior.typeHints[LIGHTING_TYPE] = "ERQOL.REGION_LIGHTING.hint";
  CONFIG.RegionBehavior.typeIcons[LIGHTING_TYPE] = "fa-solid fa-lightbulb";
}
