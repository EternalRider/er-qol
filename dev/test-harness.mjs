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
  ["er-qol.wallHint", false],
  ["er-qol.wallHintColor", "#00e5ff"],
  ["er-qol.wallHintWidth", 2],
  ["er-qol.wallHintOpacity", 1],
  ["er-qol.wallHintScope", "otherLayers"],
  ["er-qol.wallHintBlocking", []]
]);
const USER = {id: "u1", isGM: true, active: true};
const OTHER_GM = {id: "u3", isGM: true, active: false};
const PLAYER = {id: "u2", isGM: false, active: true};
const USERS = [USER, OTHER_GM, PLAYER];
Object.defineProperty(USERS, "activeGM", {get: () => USERS.find(user => user.isGM && user.active) ?? null});
USERS.contents = USERS;
const NOTIFICATIONS = [];
globalThis.game = {
  user: USER,
  users: USERS,
  modules: new Map(),
  scenes: {
    get: id => (globalThis.canvas?.scene?.id === id ? globalThis.canvas.scene
      : (globalThis.OTHER_SCENES?.get(id) ?? null)),
    getName: name => {
      if ( globalThis.canvas?.scene?.name === name ) return globalThis.canvas.scene;
      for ( const scene of (globalThis.OTHER_SCENES?.values() ?? []) ) {
        if ( scene.name === name ) return scene;
      }
      return null;
    }
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
  const token = {
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
      if ( Number.isFinite(data.x) ) token.x = data.x;
      if ( Number.isFinite(data.y) ) token.y = data.y;
      if ( Number.isFinite(data.elevation) ) token.elevation = data.elevation;
      return true;
    },
    toObject: () => ({_id: id, name, x: token.x, y: token.y, elevation: token.elevation}),
    delete: async () => {
      token.deleted = true;
      return true;
    },
    deleted: false,
    testInsideRegion: region => region.testPoint({x: token.x, y: token.y, elevation: token.elevation}),
    object: null,
    testUserPermission: () => true
  };
  return token;
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
/*  2. type 键命名空间                                                          */
/* -------------------------------------------------------------------------- */

console.log("\n[2] type 键命名空间");

assert("isBehaviorType 命中自己的键", common.isBehaviorType("er-qol.regionLighting", "regionLighting") === true);
assert("isBehaviorType 不命中旧模组的键", common.isBehaviorType("region-lighting.regionLighting", "regionLighting") === false);
assert("isBehaviorType 不命中裸子类型名", common.isBehaviorType("regionWall", "regionWall") === false);
assert("isBehaviorType 不跨子类型误判", common.isBehaviorType("er-qol.regionWall", "regionLighting") === false);
assert("isBehaviorType 不匹配相似键", common.isBehaviorType("er-qol.regionWallX", "regionWall") === false);
assert("globalThis.erqol 已挂载", globalThis.erqol?.MODULE_ID === "er-qol");
assert("BEHAVIOR_SUBTYPES 覆盖三个子类型", deepEqual(
  [...common.BEHAVIOR_SUBTYPES].sort(), ["regionAnnounce", "regionLighting", "regionWall"]));

/* -------------------------------------------------------------------------- */
/*  3. Behavior 注册（init 钩子）                                                */
/* -------------------------------------------------------------------------- */

console.log("\n[3] Behavior 类型注册");

Hooks.callAll("init");

const CANONICAL_TYPES = [
  "er-qol.regionLighting", "er-qol.regionWall", "er-qol.regionAnnounce"
];
for ( const type of CANONICAL_TYPES ) {
  assert(`dataModels 注册 ${type}`, !!CONFIG.RegionBehavior.dataModels[type]);
}
assert("不注册任何旧模组的 type 键（含裸子类型名）",
  !CONFIG.RegionBehavior.dataModels["region-lighting.regionLighting"]
  && !CONFIG.RegionBehavior.dataModels["region-walls.regionWall"]
  && !CONFIG.RegionBehavior.dataModels.regionLighting
  && !CONFIG.RegionBehavior.dataModels.regionWall);
assert("dataModels 里没有多余条目（只有本模组 3 个键，传送已移除）",
  deepEqual(Object.keys(CONFIG.RegionBehavior.dataModels).sort(), [...CANONICAL_TYPES].sort()),
  Object.keys(CONFIG.RegionBehavior.dataModels).join(", "));
assert("typeLabels 只给 3 个 er-qol 键",
  deepEqual(Object.keys(CONFIG.RegionBehavior.typeLabels).sort(), [...CANONICAL_TYPES].sort()));
assert("typeLabels 光照 = ERQOL key",
  CONFIG.RegionBehavior.typeLabels["er-qol.regionLighting"] === "ERQOL.REGION_LIGHTING.label");
assert("注册自检无缺失", deepEqual(globalThis.erqol.registeredTypes.missing, []));

// 音效必须尊重 visibility：非 Active GM 在 chat+gm 组合下不应放提示音。
const soundSystem = new features.RegionAnnounceBehaviorType({
  notifyEntry: true, notifyExit: false, output: "chat", visibility: "gm",
  entryMessage: "", exitMessage: "", sound: {enabled: true, src: "x.ogg", volume: 0.5}
});
makeBehavior("er-qol.regionAnnounce", soundSystem, makeRegion({name: "Quiet"}));
const soundEvent = {name: CONST.REGION_EVENTS.TOKEN_ENTER, data: {token: makeToken({name: "Alice"})}};
const soundCalls = [];
globalThis.foundry.audio = {AudioHelper: {play: options => soundCalls.push(options)}};
globalThis.game.user = PLAYER;
soundSystem.constructor.events[CONST.REGION_EVENTS.TOKEN_ENTER].call(soundSystem, soundEvent);
assert("visibility=gm 时玩家端不放提示音", soundCalls.length === 0, `实际 ${soundCalls.length}`);
globalThis.game.user = USER;
soundSystem.constructor.events[CONST.REGION_EVENTS.TOKEN_ENTER].call(soundSystem, soundEvent);
assert("visibility=gm 时 GM 端放提示音", soundCalls.length === 1, `实际 ${soundCalls.length}`);

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

// 去重：非 Active GM 不应创建聊天消息（否则 N 个在线客户端会发出 N 条重复消息）。
announceSystem.output = "chat";
globalThis.game.user = OTHER_GM;
const beforeCount = CHAT_MESSAGES.length;
announceSystem.constructor.events[CONST.REGION_EVENTS.TOKEN_ENTER].call(announceSystem, enterEvent);
assert("非 Active GM 不创建聊天消息（去重）", CHAT_MESSAGES.length === beforeCount,
  `实际新增 ${CHAT_MESSAGES.length - beforeCount}`);
globalThis.game.user = PLAYER;
announceSystem.constructor.events[CONST.REGION_EVENTS.TOKEN_ENTER].call(announceSystem, enterEvent);
assert("玩家客户端不创建聊天消息", CHAT_MESSAGES.length === beforeCount);
globalThis.game.user = USER;
announceSystem.constructor.events[CONST.REGION_EVENTS.TOKEN_ENTER].call(announceSystem, enterEvent);
assert("Active GM 创建聊天消息", CHAT_MESSAGES.length === beforeCount + 1);

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
assert("区域传送的设置已全部删除（含 world 级冷却）",
  !SETTINGS.has("er-qol.teleportCooldown") && !SETTINGS.has("er-qol.regionTeleport"));
for ( const key of ["wallHint", "wallHintColor", "wallHintWidth", "wallHintOpacity", "wallHintScope", "wallHintBlocking"] ) {
  assert(`墙体提示线设置 ${key} 已注册`, SETTINGS.has(`er-qol.${key}`));
}
assert("墙体提示线默认关闭", SETTINGS.get("er-qol.wallHint") === false);
assert("阻挡类型过滤默认为空数组（= 不过滤）",
  deepEqual(SETTINGS.get("er-qol.wallHintBlocking"), []));
assert("旧的 wallHintShowSecret 设置已删除", !SETTINGS.has("er-qol.wallHintShowSecret"));

/* -------------------------------------------------------------------------- */
/*  8b. 墙体提示线（其他图层显示墙体线）                                          */
/* -------------------------------------------------------------------------- */

console.log("\n[8b] 墙体提示线");

const wallHint = await import(scripts("wall-hint.mjs"));
assert("颜色解析：#00e5ff → 0x00e5ff",
  wallHint.parseHintColor("#00e5ff") === 0x00e5ff, String(wallHint.parseHintColor("#00e5ff")));
assert("颜色解析：不支持的值回退默认色（不是密门类别色）",
  wallHint.parseHintColor("not-a-color") !== wallHint.SECRET_DOOR_CATEGORY_COLOR);
assert("密门类别色常量与 Foundry 核心一致（0xA612D4）", wallHint.SECRET_DOOR_CATEGORY_COLOR === 0xA612D4);
assert("样式归一化：线宽/不透明度取设置值",
  deepEqual(wallHint.normalizeHintStyle({color: "#ff0000", width: 3, opacity: 0.5}).width, 3)
  && wallHint.normalizeHintStyle({color: "#ff0000", width: 3, opacity: 0.5}).opacity === 0.5);

// 真实 WallDocument 的 c 是**扁平数组** [x0, y0, x1, y1]（core schema 校验长度为 4）。
const FLAT = [0, 0, 10, 0];
const normalWallDoc = {c: [...FLAT], door: 0, move: 1, sight: 1, sound: 1, light: 1};
const secretWallDoc = {c: [...FLAT], door: 2, move: 1, sight: 1, sound: 1, light: 1};
const invisibleWallDoc = {c: [...FLAT], door: 0, move: 0, sight: 0, sound: 0, light: 0};
const etherealWallDoc = {c: [...FLAT], door: 0, move: 1, sight: 1, sound: 1, light: 1};
// 只挡移动、不挡视野 → 用于验证多选过滤
const moveOnlyDoc = {c: [...FLAT], door: 0, move: 1, sight: 0, sound: 0, light: 0};

assert("端点解析：真实扁平数组 [x0,y0,x1,y1]",
  deepEqual(wallHint.getWallSegment(normalWallDoc), {a: {x: 0, y: 0}, b: {x: 10, y: 0}}),
  JSON.stringify(wallHint.getWallSegment(normalWallDoc)));
assert("端点解析：兼容对象数组写法",
  deepEqual(wallHint.getWallSegment({c: [{x: 1, y: 2}, {x: 3, y: 4}]}), {a: {x: 1, y: 2}, b: {x: 3, y: 4}}));
assert("端点解析：c[2]/c[3] 缺失时退到画布对象 b",
  deepEqual(wallHint.getWallSegment({c: [0, 0]}, {b: {x: 5, y: 6}}), {a: {x: 0, y: 0}, b: {x: 5, y: 6}}));
assert("端点解析：非有限坐标返回 null", wallHint.getWallSegment({c: [0, 0, NaN, 5]}) === null);

// 核心要求：所有类型墙体统一绘制，密门也一样（统一颜色下无法分辨）。
assert("空过滤 = 任何墙体都画（普通墙）", wallHint.isWallHintEligible(normalWallDoc, []) === true);
assert("空过滤 = 任何墙体都画（密门）", wallHint.isWallHintEligible(secretWallDoc, []) === true);
assert("空过滤 = 任何墙体都画（隐形墙）", wallHint.isWallHintEligible(invisibleWallDoc, []) === true);
assert("空过滤 = 任何墙体都画（虚体墙）", wallHint.isWallHintEligible(etherealWallDoc, []) === true);
assert("密门不再被特殊排除（与普通墙同色绘制）",
  wallHint.isWallHintEligible(secretWallDoc, []) === wallHint.isWallHintEligible(normalWallDoc, []));

// 按阻挡类型过滤（或关系）。
assert("只勾「阻挡移动」：只挡移动的墙命中", wallHint.isWallHintEligible(moveOnlyDoc, ["move"]) === true);
assert("只勾「阻挡移动」：不挡移动的墙不命中", wallHint.isWallHintEligible(invisibleWallDoc, ["move"]) === false);
assert("只勾「阻挡视野」：只挡移动的墙不命中", wallHint.isWallHintEligible(moveOnlyDoc, ["sight"]) === false);
assert("勾「阻挡移动 + 阻挡视野」= 或关系：只挡移动仍命中",
  wallHint.isWallHintEligible(moveOnlyDoc, ["move", "sight"]) === true);
assert("勾「阻挡视野 + 阻挡声音」：只挡移动不命中",
  wallHint.isWallHintEligible(moveOnlyDoc, ["sight", "sound"]) === false);
assert("阻挡类型过滤会剔除不认识的值",
  deepEqual(wallHint.normalizeBlockingTypes(["move", "bogus", "move", "sight"]), ["move", "sight"]));
assert("多选接受字符串（单个值的兼容写法）",
  deepEqual(wallHint.normalizeBlockingTypes("sight"), ["sight"]));
assert("wallBlocks：通道值不是 NONE 即算阻挡",
  wallHint.wallBlocks({move: 1, sight: 0}, "move") === true
  && wallHint.wallBlocks({move: 1, sight: 0}, "sight") === false);
assert("otherLayers 范围在墙体图层激活时隐藏",
  wallHint.shouldHideHintOnWallsLayer("otherLayers", true) === true
  && wallHint.shouldHideHintOnWallsLayer("otherLayers", false) === false);
assert("always 范围任何图层都显示",
  wallHint.shouldHideHintOnWallsLayer("always", true) === false);

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
assert("documentTypes 覆盖三个子类型（传送已移除）",
  deepEqual(Object.keys(moduleJson.documentTypes?.RegionBehavior ?? {}).sort(),
    ["regionAnnounce", "regionLighting", "regionWall"]));

/* -------------------------------------------------------------------------- */
/*  汇总                                                                        */
/* -------------------------------------------------------------------------- */

console.log(`\n==== ${passCount} passed, ${failCount} failed ====`);
if ( failures.length ) {
  console.log("失败项：");
  for ( const item of failures ) console.log(`  - ${item}`);
  process.exitCode = 1;
}
