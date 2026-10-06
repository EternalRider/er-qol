/**
 * er-qol 本地测试台（不需要 Foundry）。
 *
 * 用途：在没有浏览器/Foundry 的环境下，用最小桩对象加载 `scripts/*.mjs`，
 * 验证共享工具函数、Behavior 注册、兼容别名、本地化键完整性与传送逻辑。
 *
 * 运行：`node dev/test-harness.mjs`
 * 退出码：0 = 全部通过；1 = 有失败项。
 *
 * 注意：本文件只在开发时运行，不会被 Foundry 加载（不在 module.json 的 esmodules 里）。
 */

import path from "node:path";
import {pathToFileURL} from "node:url";
import fs from "node:fs";

/* -------------------------------------------------------------------------- */
/*  最小 Foundry / PIXI 桩                                                      */
/* -------------------------------------------------------------------------- */

let passCount = 0;
let failCount = 0;
const failures = [];

/**
 * 断言。
 * @param {string} name 用例名
 * @param {boolean} condition 条件
 * @param {string} [detail] 失败详情
 * @returns {void}
 */
function assert(name, condition, detail = "") {
  if ( condition ) {
    passCount += 1;
    console.log(`  ok   ${name}`);
  } else {
    failCount += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * 深比较两个简单对象（用于高度判定等结构化断言）。
 * @param {*} a 左值
 * @param {*} b 右值
 * @returns {boolean} 相等返回 true
 */
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

class MockField {
  constructor(options = {}) {
    Object.assign(this, options);
    this.initial = options.initial;
  }

  getInitial() {
    return this.initial;
  }
}

class MockSchemaField extends MockField {
  constructor(fields = {}, options = {}) {
    super({...options, fields});
    this.fields = fields;
  }
}

class MockRegionBehaviorType {
  constructor(data = {}, options = {}) {
    this._source = data;
    this.behavior = options.parent ?? data.behavior ?? null;
    for ( const [key, value] of Object.entries(data) ) {
      if ( this[key] === undefined ) this[key] = value;
    }
  }

  static defineSchema() {
    return {};
  }
}

class MockRectangle {
  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x; this.y = y; this.width = width; this.height = height;
    this.left = x; this.top = y; this.right = x + width; this.bottom = y + height;
  }

  contains(x, y) {
    return (x >= this.left) && (x <= this.right) && (y >= this.top) && (y <= this.bottom);
  }

  get center() {
    return {x: this.x + (this.width / 2), y: this.y + (this.height / 2)};
  }
}

class MockPolygon {
  constructor(points = []) {
    this.points = points;
  }
}

class MockContainer {
  constructor() {
    this.children = [];
    this.destroyed = false;
    this.name = "";
    this.zIndex = 0;
  }

  addChild(child) {
    this.children.push(child);
    return child;
  }

  removeChildren() {
    const removed = this.children;
    this.children = [];
    return removed;
  }
}

class MockGraphics extends MockContainer {
  beginFill() { return this; }
  lineStyle() { return this; }
  moveTo() { return this; }
  lineTo() { return this; }
  closePath() { return this; }
  endFill() { return this; }
  destroy() { this.destroyed = true; }
}

class MockEdge {
  constructor(a, b, options = {}) {
    Object.assign(this, options);
    this.a = a;
    this.b = b;
  }
}

const HOOKS = new Map();
const CONFIG = {
  RegionBehavior: {dataModels: {}, typeLabels: {}, typeHints: {}, typeIcons: {}},
  Canvas: {
    lightSourceClass: class {},
    darknessSourceClass: class {},
    polygonBackends: {},
    lightAnimations: {},
    darknessAnimations: {}
  }
};

const CONST = {
  REGION_EVENTS: {
    TOKEN_ENTER: "tokenEnter",
    TOKEN_EXIT: "tokenExit",
    BEHAVIOR_ACTIVATED: "behaviorActivated",
    BEHAVIOR_DEACTIVATED: "behaviorDeactivated",
    BEHAVIOR_VIEWED: "behaviorViewed",
    BEHAVIOR_UNVIEWED: "behaviorUnviewed",
    REGION_BOUNDARY: "regionBoundary",
    REGION_ANIMATION: "regionAnimation"
  },
  EDGE_SENSE_TYPES: {NONE: 0, NORMAL: 1, LIMITED: 10, PROXIMITY: 20, DISTANCE: 30},
  EDGE_DIRECTIONS: {BOTH: 0, LEFT: 1, RIGHT: 2},
  EDGE_RESTRICTION_TYPES: ["light", "darkness", "sight", "sound", "move"]
};

globalThis.CONFIG = CONFIG;
globalThis.CONST = CONST;
globalThis.PIXI = {
  Rectangle: MockRectangle,
  Polygon: MockPolygon,
  Graphics: MockGraphics,
  Container: MockContainer,
  FederatedPointerEvent: class {}
};
globalThis.foundry = {
  data: {
    regionBehaviors: {RegionBehaviorType: MockRegionBehaviorType},
    fields: {
      BooleanField: MockField,
      NumberField: MockField,
      StringField: MockField,
      SchemaField: MockSchemaField,
      AlphaField: MockField,
      ColorField: MockField
    }
  },
  utils: {
    escapeHTML: value => String(value ?? ""),
    deepClone: value => JSON.parse(JSON.stringify(value ?? {})),
    mergeObject: (target, source) => Object.assign(target ?? {}, source ?? {}),
    lineSegmentIntersects: () => false,
    objectEntries: obj => Object.entries(obj ?? {}),
    objectValues: obj => Object.values(obj ?? {})
  },
  audio: {AudioHelper: {play: () => Promise.resolve()}},
  canvas: {geometry: {edges: {Edge: MockEdge}}}
};
globalThis.Hooks = {
  on: (name, fn) => {
    if ( !HOOKS.has(name) ) HOOKS.set(name, []);
    HOOKS.get(name).push(fn);
    return HOOKS.get(name).length;
  },
  once: (name, fn) => {
    if ( !HOOKS.has(name) ) HOOKS.set(name, []);
    HOOKS.get(name).push(fn);
    return HOOKS.get(name).length;
  },
  callAll: name => {
    for ( const fn of (HOOKS.get(name) ?? []) ) fn();
  }
};

const SETTINGS = new Map([
  ["er-qol.hoverHighlight", true],
  ["er-qol.hoverInfo", true],
  ["er-qol.teleportCooldown", 1000]
]);
const USER = {id: "u1", isGM: true};
const NOTIFICATIONS = [];
globalThis.game = {
  user: USER,
  users: [USER, {id: "u2", isGM: false}],
  modules: new Map(),
  scenes: {
    get: id => (globalThis.canvas?.scene?.id === id ? globalThis.canvas.scene : null)
  },
  settings: {
    register: (module, key, data) => {
      SETTINGS.set(`${module}.${key}`, data.default);
    },
    get: (module, key) => SETTINGS.get(`${module}.${key}`),
    set: async (module, key, value) => SETTINGS.set(`${module}.${key}`, value)
  },
  i18n: {
    localize: key => key,
    format: (key, data) => {
      let out = key;
      for ( const [k, v] of Object.entries(data ?? {}) ) out = out.replaceAll(`{${k}}`, String(v));
      return out;
    }
  }
};
globalThis.ui = {
  notifications: {
    info: (message, options) => {
      NOTIFICATIONS.push({level: "info", message, options});
      return NOTIFICATIONS.length;
    },
    warn: message => {
      NOTIFICATIONS.push({level: "warn", message});
      return NOTIFICATIONS.length;
    }
  }
};
const CHAT_MESSAGES = [];
globalThis.ChatMessage = {
  create: data => {
    CHAT_MESSAGES.push(data);
    return Promise.resolve(data);
  },
  getSpeaker: () => ({alias: "tester"})
};
globalThis.canvas = null;
globalThis.setTimeout = globalThis.setTimeout;

/* -------------------------------------------------------------------------- */
/*  测试用 Region / Token 桩                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 造一个矩形 Region 文档桩。
 * @param {object} [options] 选项
 * @returns {object} Region 桩
 */
function makeRegion({
  id = "region-1", name = "Test Region", x = 0, y = 0, width = 100, height = 100,
  bottom = 0, top = 10, shapes = [[0, 0, 100, 0, 100, 100, 0, 100]]
} = {}) {
  const polygonTree = shapes.map((flat, index) => ({
    isHole: false,
    bounds: new MockRectangle(x, y, width, height),
    polygon: new MockPolygon(flat),
    path: (() => {
      const points = [];
      for ( let i = 0; i < flat.length; i += 2 ) points.push({x: flat[i], y: flat[i + 1]});
      return points;
    })(),
    index
  }));
  const vertices = new Float32Array([0, 0, width, 0, width, height, 0, height]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

  return {
    id,
    name,
    elevation: {bottom, top, topInclusive: false},
    polygonTree,
    triangulation: {vertices, indices},
    bounds: new MockRectangle(x, y, width, height),
    behaviors: [],
    testPoint: point => (point.x >= x) && (point.x <= (x + width)) && (point.y >= y) && (point.y <= (y + height)),
    object: null,
    levels: [],
    includedInLevel: () => true
  };
}

/**
 * 造一个 Token 文档桩。
 * @param {object} [options] 选项
 * @returns {object} Token 桩
 */
function makeToken({id = "token-1", name = "Hero", x = 50, y = 50, sceneId = "scene-1"} = {}) {
  const flags = {};
  const updates = [];
  return {
    id,
    name,
    x,
    y,
    elevation: 0,
    isOwner: true,
    parent: {id: sceneId},
    flags,
    updates,
    getFlag: (module, key) => flags[`${module}.${key}`],
    setFlag: async (module, key, value) => {
      flags[`${module}.${key}`] = value;
      return true;
    },
    unsetFlag: async (module, key) => {
      delete flags[`${module}.${key}`];
      return true;
    },
    update: async data => {
      updates.push(data);
      Object.assign({}, data);
      return true;
    },
    toObject: () => ({_id: id, name, x, y, elevation: 0}),
    object: null,
    testUserPermission: () => true
  };
}

/**
 * 造一个 RegionBehavior 桩（带 system 数据模型实例）。
 * @param {string} type type 键
 * @param {object} system system 数据
 * @param {object} region 所属 Region
 * @param {object} [options] 选项
 * @returns {object} behavior 桩
 */
function makeBehavior(type, system, region, {id = "behavior-1", active = true, viewed = true} = {}) {
  const behavior = {id, type, active, viewed, system, parent: region};
  system.behavior = behavior;
  region.behaviors.push(behavior);
  return behavior;
}

/* -------------------------------------------------------------------------- */
/*  载入被测模块                                                                 */
/* -------------------------------------------------------------------------- */

const MODULE_DIR = path.resolve(import.meta.dirname, "..");
const scripts = file => pathToFileURL(path.join(MODULE_DIR, "scripts", file)).href;

const common = await import(scripts("region-common.mjs"));
await import(scripts("features.mjs"));
await import(scripts("init.mjs"));

let lighting = null;
let walls = null;
try {
  lighting = await import(scripts("region-lighting.mjs"));
} catch ( err ) {
  console.log(`[skip] region-lighting.mjs 尚未就绪：${err.message}`);
}
try {
  walls = await import(scripts("region-walls.mjs"));
} catch ( err ) {
  console.log(`[skip] region-walls.mjs 尚未就绪：${err.message}`);
}

const features = await import(scripts("features.mjs"));

/* -------------------------------------------------------------------------- */
/*  1. 共享几何工具                                                             */
/* -------------------------------------------------------------------------- */

console.log("\n[1] region-common：几何 / 高度工具");

const region = makeRegion();
assert("getRegionPolygonEdges 返回 4 条边", common.getRegionPolygonEdges(region).length === 4,
  `实际 ${common.getRegionPolygonEdges(region).length}`);
assert("getRegionPolygonEdges 每段 2 个点", common.getRegionPolygonEdges(region).every(s => s.points.length === 2));
assert("getRegionPolygonEdges 首段闭合正确", deepEqual(common.getRegionPolygonEdges(region)[3].points,
  [{x: 0, y: 100}, {x: 0, y: 0}]));
assert("getPrimaryRegionPolygon 取非洞多边形", common.getPrimaryRegionPolygon(region) === region.polygonTree[0].polygon);

const centroid = common.computeTriangulationCentroid(region.triangulation.vertices, region.triangulation.indices);
assert("三角剖分重心 ≈ 矩形中心", Math.abs(centroid.x - 50) < 1e-6 && Math.abs(centroid.y - 50) < 1e-6,
  JSON.stringify(centroid));

const representative = common.getRegionRepresentativePoint(region);
assert("代表点落在 Region 内", region.testPoint(representative), JSON.stringify(representative));
assert("代表点取高度范围中点", representative.elevation === 5, `实际 ${representative.elevation}`);

const samples = common.getRegionSamplePoints(region, representative);
assert("采样点已去重", samples.length === new Set(samples.map(p => `${p.x}:${p.y}`)).size);

const elevated = makeRegion({bottom: 10, top: 10});
assert("bottom === top 时采样高度取该值", common.getRegionSampleElevation(elevated) === 10);

const openTop = makeRegion({bottom: 0, top: undefined});
delete openTop.elevation.top;
assert("无 top 时采样高度 = bottom", common.getRegionSampleElevation(openTop) === 0);

assert("elevationInRegion：内部 true", common.elevationInRegion(makeRegion({bottom: 0, top: 10}), 5) === true);
assert("elevationInRegion：下界含 true", common.elevationInRegion(makeRegion({bottom: 0, top: 10}), 0) === true);
assert("elevationInRegion：上界不含 false", common.elevationInRegion(makeRegion({bottom: 0, top: 10}), 10) === false);
assert("elevationInRegion：上界含（topInclusive）true",
  common.elevationInRegion({elevation: {bottom: 0, top: 10, topInclusive: true}}, 10) === true);
assert("elevationInRegion：无 top 视为无上界",
  common.elevationInRegion({elevation: {bottom: 0, top: null}}, 999) === true);
assert("elevationRangeOverlaps：区间跨越 true",
  common.elevationRangeOverlaps(makeRegion({bottom: 5, top: 10}), 0, 20) === true);
assert("elevationRangeOverlaps：区间在下方 false",
  common.elevationRangeOverlaps(makeRegion({bottom: 5, top: 10}), 0, 4) === false);
assert("getProbeElevation：有界取中点", common.getProbeElevation(makeRegion({bottom: 0, top: 10})) === 5);
assert("getProbeElevation：bottom === top", common.getProbeElevation(makeRegion({bottom: 3, top: 3})) === 3);

/* -------------------------------------------------------------------------- */
/*  2. 兼容别名                                                                 */
/* -------------------------------------------------------------------------- */

console.log("\n[2] 兼容别名");

assert("normalizeBehaviorType：旧光照键", common.normalizeBehaviorType("region-lighting.regionLighting") === "er-qol.regionLighting");
assert("normalizeBehaviorType：旧墙体键", common.normalizeBehaviorType("region-walls.regionWall") === "er-qol.regionWall");
assert("normalizeBehaviorType：裸子类型键", common.normalizeBehaviorType("regionWall") === "er-qol.regionWall");
assert("normalizeBehaviorType：新键原样", common.normalizeBehaviorType("er-qol.regionWall") === "er-qol.regionWall");
assert("normalizeBehaviorType：无关键原样", common.normalizeBehaviorType("other-mod.thing") === "other-mod.thing");
assert("isBehaviorType 命中别名组", common.isBehaviorType("region-lighting.regionLighting", "regionLighting") === true);
assert("isBehaviorType 不串组", common.isBehaviorType("region-walls.regionWall", "regionLighting") === false);
assert("globalThis.erqol 已挂载", globalThis.erqol?.MODULE_ID === "er-qol");

/* -------------------------------------------------------------------------- */
/*  3. Behavior 注册（init 钩子）                                                */
/* -------------------------------------------------------------------------- */

console.log("\n[3] Behavior 类型注册");

Hooks.callAll("init");

const expectedAliases = [
  "regionLighting", "region-lighting.regionLighting", "er-qol.regionLighting",
  "regionWall", "region-walls.regionWall", "er-qol.regionWall",
  "er-qol.regionAnnounce", "er-qol.regionTeleport"
];
for ( const type of expectedAliases ) {
  assert(`dataModels 注册 ${type}`, !!CONFIG.RegionBehavior.dataModels[type]);
}

assert("typeLabels 只给规范化键（无裸子类型键）",
  !CONFIG.RegionBehavior.typeLabels.regionWall && !CONFIG.RegionBehavior.typeLabels.regionLighting);
assert("typeLabels 光照 = ERQOL key",
  CONFIG.RegionBehavior.typeLabels["er-qol.regionLighting"] === "ERQOL.REGION_LIGHTING.label");
assert("typeLabels 提示/传送已注册",
  !!CONFIG.RegionBehavior.typeLabels["er-qol.regionAnnounce"]
  && !!CONFIG.RegionBehavior.typeLabels["er-qol.regionTeleport"]);
assert("别名冲突检测：四个规范化键齐全",
  deepEqual(globalThis.erqol.registeredTypes.missing, []));

/* -------------------------------------------------------------------------- */
/*  4. 本地化键完整性                                                            */
/* -------------------------------------------------------------------------- */

console.log("\n[4] 本地化键完整性");

/**
 * 收拢某个对象里出现的所有 `ERQOL.` 开头的字符串字面量。
 * @param {string} dir 源文件目录
 * @returns {Set<string>} 键集合
 */
function collectI18nKeys(dir) {
  const keys = new Set();
  const files = fs.readdirSync(dir).filter(name => name.endsWith(".mjs"));
  for ( const file of files ) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    for ( const match of text.matchAll(/"([A-Z][A-Z0-9_]*(?:\.[A-Za-z0-9_]+)+)"/g) ) {
      if ( match[1].startsWith("ERQOL.") ) keys.add(match[1]);
    }
  }
  return keys;
}

/**
 * 取 `lang/en.json` 里某个键是否存在。
 * @param {object} lang 语言对象
 * @param {string} key 点分键
 * @returns {boolean} 存在返回 true
 */
function hasLangKey(lang, key) {
  return key.split(".").reduce((node, part) => (node == null ? undefined : node[part]), lang) !== undefined;
}

const langDir = path.join(MODULE_DIR, "lang");
const en = JSON.parse(fs.readFileSync(path.join(langDir, "en.json"), "utf8"));
const zh = JSON.parse(fs.readFileSync(path.join(langDir, "zh-CN.json"), "utf8"));
const cn = JSON.parse(fs.readFileSync(path.join(langDir, "cn.json"), "utf8"));

const usedKeys = collectI18nKeys(path.join(MODULE_DIR, "scripts"));
const missingInEn = [...usedKeys].filter(key => !hasLangKey(en, key));
assert("脚本里用到的 ERQOL.* 键都在 en.json", missingInEn.length === 0, missingInEn.join(", "));
const missingInZh = [...usedKeys].filter(key => !hasLangKey(zh, key));
assert("脚本里用到的 ERQOL.* 键都在 zh-CN.json", missingInZh.length === 0, missingInZh.join(", "));
assert("cn.json 与 zh-CN.json 完全一致", deepEqual(cn, zh));

/* -------------------------------------------------------------------------- */
/*  5. 区域提示 Behavior                                                        */
/* -------------------------------------------------------------------------- */

console.log("\n[5] 区域提示 Behavior");

NOTIFICATIONS.length = 0;
CHAT_MESSAGES.length = 0;
globalThis.canvas = {ready: true, scene: {id: "scene-1", regions: [], name: "Scene 1"}};
const announceRegion = makeRegion({name: "Arena"});
const announceSystem = new features.RegionAnnounceBehaviorType({
  notifyEntry: true, notifyExit: false, output: "chat", visibility: "all",
  entryMessage: "{token} 冲进了 {region}", exitMessage: "",
  sound: {enabled: false, src: "", volume: 0.6}
});
const announceBehavior = makeBehavior("er-qol.regionAnnounce", announceSystem, announceRegion);
const enterEvent = {name: CONST.REGION_EVENTS.TOKEN_ENTER, data: {token: makeToken({name: "Alice"})}};
announceSystem.constructor.events[CONST.REGION_EVENTS.TOKEN_ENTER].call(announceSystem, enterEvent);
assert("进入事件发出一条聊天消息", CHAT_MESSAGES.length === 1, `实际 ${CHAT_MESSAGES.length}`);
assert("聊天消息渲染了占位符", /Alice 冲进了 Arena/.test(CHAT_MESSAGES[0]?.content ?? ""),
  CHAT_MESSAGES[0]?.content ?? "");

announceBehavior.active = false;
announceSystem.constructor.events[CONST.REGION_EVENTS.TOKEN_ENTER].call(announceSystem, enterEvent);
assert("行为被禁用后不再发消息", CHAT_MESSAGES.length === 1, `实际 ${CHAT_MESSAGES.length}`);
announceBehavior.active = true;

announceSystem.notifyExit = false;
announceSystem.constructor.events[CONST.REGION_EVENTS.TOKEN_EXIT].call(announceSystem,
  {name: CONST.REGION_EVENTS.TOKEN_EXIT, data: {token: makeToken({name: "Alice"})}});
assert("未开启离开提示时不发消息", CHAT_MESSAGES.length === 1, `实际 ${CHAT_MESSAGES.length}`);

announceSystem.output = "notification";
announceSystem.notifyExit = true;
announceSystem.constructor.events[CONST.REGION_EVENTS.TOKEN_EXIT].call(announceSystem,
  {name: CONST.REGION_EVENTS.TOKEN_EXIT, data: {token: makeToken({name: "Alice"})}});
assert("通知模式走 ui.notifications", NOTIFICATIONS.some(n => n.level === "info"));

/* -------------------------------------------------------------------------- */
/*  6. 区域传送 Behavior                                                        */
/* -------------------------------------------------------------------------- */

console.log("\n[6] 区域传送 Behavior");

const teleportSystem = new features.RegionTeleportBehaviorType({
  scene: "", x: 500, y: 600, elevation: 5, consume: true, notify: true,
  message: "", label: ""
});
const teleportRegion = makeRegion({name: "Portal"});
const teleportBehavior = makeBehavior("er-qol.regionTeleport", teleportSystem, teleportRegion);
const token = makeToken();

await teleportSystem.constructor.events[CONST.REGION_EVENTS.TOKEN_ENTER].call(teleportSystem,
  {name: CONST.REGION_EVENTS.TOKEN_ENTER, data: {token}});
assert("传送写入了目标坐标与高度", deepEqual(token.updates[0], {x: 500, y: 600, elevation: 5}),
  JSON.stringify(token.updates[0]));
assert("传送后写入冷却标记", typeof token.flags["er-qol.teleportCooldown"] === "number");

token.updates.length = 0;
await teleportSystem.constructor.events[CONST.REGION_EVENTS.TOKEN_ENTER].call(teleportSystem,
  {name: CONST.REGION_EVENTS.TOKEN_ENTER, data: {token}});
assert("冷却期内不会再次传送", token.updates.length === 0, `实际 ${token.updates.length}`);

teleportBehavior.active = false;
token.flags["er-qol.teleportCooldown"] = 0;
await teleportSystem.constructor.events[CONST.REGION_EVENTS.TOKEN_ENTER].call(teleportSystem,
  {name: CONST.REGION_EVENTS.TOKEN_ENTER, data: {token}});
assert("行为被禁用后不传送", token.updates.length === 0, `实际 ${token.updates.length}`);
teleportBehavior.active = true;

SETTINGS.set("er-qol.teleportCooldown", 0);
token.updates.length = 0;
token.flags["er-qol.teleportCooldown"] = 0;
teleportSystem.consume = false;
await teleportSystem.constructor.events[CONST.REGION_EVENTS.TOKEN_ENTER].call(teleportSystem,
  {name: CONST.REGION_EVENTS.TOKEN_ENTER, data: {token}});
assert("冷却设为 0 且 consume 关闭时不再写标记",
  token.flags["er-qol.teleportCooldown"] === 0 && token.updates.length === 1);
SETTINGS.set("er-qol.teleportCooldown", 1000);

const noSceneSystem = new features.RegionTeleportBehaviorType({
  scene: "missing-scene", x: 1, y: 1, elevation: 0, consume: false, notify: true,
  message: "", label: ""
});
makeBehavior("er-qol.regionTeleport", noSceneSystem, makeRegion({name: "Bad Portal"}));
NOTIFICATIONS.length = 0;
await noSceneSystem.constructor.events[CONST.REGION_EVENTS.TOKEN_ENTER].call(noSceneSystem,
  {name: CONST.REGION_EVENTS.TOKEN_ENTER, data: {token: makeToken()}});
assert("目标场景不存在时给出警告且不传送", NOTIFICATIONS.some(n => n.level === "warn"));

/* -------------------------------------------------------------------------- */
/*  7. 悬停高亮                                                                 */
/* -------------------------------------------------------------------------- */

console.log("\n[7] 悬停高亮");

Hooks.callAll("ready");
const drawRegionHook = (HOOKS.get("drawRegion") ?? [])[0];
assert("drawRegion 钩子已注册", typeof drawRegionHook === "function");

const parentContainer = new MockContainer();
globalThis.canvas = {
  ready: true,
  scene: {id: "scene-1", regions: [], name: "Scene 1"},
  regions: parentContainer,
  effects: {
    darknessSources: new Map(),
    lightSources: new Map()
  },
  perception: {update: () => {}},
  dimensions: {distancePixels: 100}
};

const hoverRegion = makeRegion({name: "Hovered"});
const fakeRegionObject = {
  document: hoverRegion,
  eventMode: "auto",
  handlers: {},
  on(event, fn) { this.handlers[event] = fn; return this; }
};
drawRegionHook(fakeRegionObject);
assert("Region 对象绑定 pointerover", typeof fakeRegionObject.handlers.pointerover === "function");
assert("Region 对象绑定 pointerout", typeof fakeRegionObject.handlers.pointerout === "function");

NOTIFICATIONS.length = 0;
fakeRegionObject.handlers.pointerover({data: {originalEvent: {clientX: 10, clientY: 10}}});
assert("悬停后创建高亮图层", parentContainer.children.some(child => child.name === "erqolHoverHighlight"));
assert("悬停后显示区域信息", NOTIFICATIONS.some(n => String(n.message).includes("Hovered")));
fakeRegionObject.handlers.pointerout();
assert("移出后清空高亮",
  (parentContainer.children.find(child => child.name === "erqolHoverHighlight")?.children.length ?? 0) === 0);

/* -------------------------------------------------------------------------- */
/*  8. 设置注册                                                                 */
/* -------------------------------------------------------------------------- */

console.log("\n[8] 设置注册");

assert("hoverHighlight 已注册", SETTINGS.has("er-qol.hoverHighlight"));
assert("hoverInfo 已注册", SETTINGS.has("er-qol.hoverInfo"));
assert("teleportCooldown 已注册", SETTINGS.has("er-qol.teleportCooldown"));

/* -------------------------------------------------------------------------- */
/*  9. 光照 / 墙体模块（可选）                                                   */
/* -------------------------------------------------------------------------- */

console.log("\n[9] 光照 / 墙体模块");

if ( lighting ) {
  assert("光照模块导出 TYPE", lighting.TYPE === "er-qol.regionLighting", String(lighting.TYPE));
  assert("光照模块导出 Behavior 类", typeof lighting.RegionLightingBehaviorType === "function");
  assert("光照模块导出注册函数", typeof lighting.registerLightingBehaviorTypes === "function");
  const schema = lighting.RegionLightingBehaviorType.defineSchema();
  assert("光照 schema 含 priority", "priority" in schema);
  assert("光照 schema 含 darkness", "darkness" in schema);
  assert("光照 schema 含 animation", "animation" in schema);
} else {
  assert("光照模块存在", false, "scripts/region-lighting.mjs 缺失");
}

if ( walls ) {
  assert("墙体模块导出 TYPE", walls.TYPE === "er-qol.regionWall", String(walls.TYPE));
  assert("墙体模块导出 Behavior 类", typeof walls.RegionWallBehaviorType === "function");
  const schema = walls.RegionWallBehaviorType.defineSchema();
  for ( const field of ["move", "sight", "light", "sound", "darkness", "direction"] ) {
    assert(`墙体 schema 含 ${field}`, field in schema);
  }
} else {
  assert("墙体模块存在", false, "scripts/region-walls.mjs 缺失");
}

/* -------------------------------------------------------------------------- */
/*  10. module.json 与目录一致性                                                 */
/* -------------------------------------------------------------------------- */

console.log("\n[10] module.json 校验");

const moduleJson = JSON.parse(fs.readFileSync(path.join(MODULE_DIR, "module.json"), "utf8"));
assert("module.json id === er-qol", moduleJson.id === "er-qol");
assert("目录名 === id", path.basename(MODULE_DIR) === moduleJson.id);
assert("有 license 字段", typeof moduleJson.license === "string" && moduleJson.license.length > 0);
assert("有 compatibility.verified", !!moduleJson.compatibility?.verified);
for ( const entry of moduleJson.esmodules ?? [] ) {
  assert(`esmodules 存在：${entry}`, fs.existsSync(path.join(MODULE_DIR, entry)));
}
for ( const lang of moduleJson.languages ?? [] ) {
  assert(`本地化文件存在：${lang.path}`, fs.existsSync(path.join(MODULE_DIR, lang.path)));
}
assert("documentTypes 覆盖四个子类型",
  ["regionLighting", "regionWall", "regionAnnounce", "regionTeleport"]
    .every(key => key in (moduleJson.documentTypes?.RegionBehavior ?? {})));

/* -------------------------------------------------------------------------- */
/*  汇总                                                                        */
/* -------------------------------------------------------------------------- */

console.log(`\n==== ${passCount} passed, ${failCount} failed ====`);
if ( failures.length ) {
  console.log("失败项：");
  for ( const item of failures ) console.log(`  - ${item}`);
  process.exitCode = 1;
}
