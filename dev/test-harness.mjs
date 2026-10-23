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
  ["er-qol.wallHint", false],
  ["er-qol.wallHintOpacity", 1],
  ["er-qol.wallHintScope", "otherLayers"],
  ["er-qol.wallHintLines", []]
]);
const MENUS = new Map();
const SETTING_DEFS = new Map();
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
      SETTING_DEFS.set(`${module}.${key}`, data);
    },
    registerMenu: (module, key, data) => {
      MENUS.set(`${module}.${key}`, data);
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
/*  7. 画布级钩子（悬停功能已移除）                                               */
/* -------------------------------------------------------------------------- */

console.log("\n[7] 画布级钩子");

Hooks.callAll("ready");
assert("悬停相关钩子已不再注册（drawRegion / refreshRegion）",
  !(HOOKS.get("drawRegion") ?? []).length && !(HOOKS.get("refreshRegion") ?? []).length);
assert("画布拆除钩子仍然安装（wall-hint / token-blocking 用）",
  (HOOKS.get("canvasTearDown") ?? []).length > 0);

// 给后续 wall-hint 用例准备一个最小画布
globalThis.canvas = {
  ready: true,
  scene: {id: "scene-1", regions: [], name: "Scene 1", tokens: [], walls: []},
  regions: new MockContainer(),
  effects: {
    darknessSources: new Map(),
    lightSources: new Map()
  },
  perception: {update: () => {}},
  dimensions: {distancePixels: 100}
};

/* -------------------------------------------------------------------------- */
/*  8. 设置注册                                                                 */
/* -------------------------------------------------------------------------- */

console.log("\n[8] 设置注册");

assert("悬停相关设置已全部删除",
  !SETTINGS.has("er-qol.hoverHighlight") && !SETTINGS.has("er-qol.hoverInfo"));
assert("区域传送的设置已全部删除（含 world 级冷却）",
  !SETTINGS.has("er-qol.teleportCooldown") && !SETTINGS.has("er-qol.regionTeleport"));
for ( const key of ["wallHint", "wallHintOpacity", "wallHintScope", "wallHintLines"] ) {
  assert(`墙体提示线设置 ${key} 已注册`, SETTINGS.has(`er-qol.${key}`));
}
assert("墙体提示线默认关闭", SETTINGS.get("er-qol.wallHint") === false);
assert("多条线默认为空数组（= 内置默认线：统一颜色 + 所有墙体都画）",
  deepEqual(SETTINGS.get("er-qol.wallHintLines"), []));
assert("多条线是 config:false（由自定义设置子菜单编辑）",
  SETTING_DEFS.get("er-qol.wallHintLines")?.config === false);
assert("旧的单线设置 wallHintColor / wallHintWidth / wallHintBlocking 已移除",
  !SETTINGS.has("er-qol.wallHintColor") && !SETTINGS.has("er-qol.wallHintWidth")
  && !SETTINGS.has("er-qol.wallHintBlocking"));
assert("旧的 wallHintShowSecret 设置已删除", !SETTINGS.has("er-qol.wallHintShowSecret"));
assert("墙体线样式设置菜单已注册", MENUS.has("er-qol.wallHintLinesMenu"));
assert("设置菜单的 type 是 ApplicationV2 子类样式（构造函数）",
  typeof MENUS.get("er-qol.wallHintLinesMenu")?.type === "function");

/* -------------------------------------------------------------------------- */
/*  8b. 墙体提示线（其他图层显示墙体线）                                          */
/* -------------------------------------------------------------------------- */

console.log("\n[8b] 墙体提示线（多条线配置）");

const wallHint = await import(scripts("wall-hint.mjs"));
const lineUtils = await import(scripts("wall-hint-lines.mjs"));

assert("颜色解析：#00e5ff → 0x00e5ff",
  wallHint.parseHintColor("#00e5ff") === 0x00e5ff, String(wallHint.parseHintColor("#00e5ff")));
assert("颜色解析：#0af → 0x00aaff", wallHint.parseHintColor("#0af") === 0x00aaff);
assert("颜色解析：不支持的值回退默认色（不是密门类别色）",
  wallHint.parseHintColor("not-a-color") !== wallHint.SECRET_DOOR_CATEGORY_COLOR);
assert("密门类别色常量与 Foundry 核心一致（0xA612D4）", wallHint.SECRET_DOOR_CATEGORY_COLOR === 0xA612D4);
assert("颜色文本规范化：#0AF → #00aaff", lineUtils.normalizeHintColorText("#0AF") === "#00aaff");

// 真实 WallDocument 的 c 是**扁平数组** [x0, y0, x1, y1]（core schema 校验长度为 4）。
const FLAT = [0, 0, 10, 0];
const normalWallDoc = {c: [...FLAT], door: 0, move: 1, sight: 1, sound: 1, light: 1};
const secretWallDoc = {c: [...FLAT], door: 2, move: 1, sight: 1, sound: 1, light: 1};
const invisibleWallDoc = {c: [...FLAT], door: 0, move: 0, sight: 0, sound: 0, light: 0};
const moveOnlyDoc = {c: [...FLAT], door: 0, move: 1, sight: 0, sound: 0, light: 0};
const sightOnlyDoc = {c: [...FLAT], door: 0, move: 0, sight: 1, sound: 0, light: 0};

assert("端点解析：真实扁平数组 [x0,y0,x1,y1]",
  deepEqual(wallHint.getWallSegment(normalWallDoc), {a: {x: 0, y: 0}, b: {x: 10, y: 0}}),
  JSON.stringify(wallHint.getWallSegment(normalWallDoc)));
assert("端点解析：兼容对象数组写法",
  deepEqual(wallHint.getWallSegment({c: [{x: 1, y: 2}, {x: 3, y: 4}]}), {a: {x: 1, y: 2}, b: {x: 3, y: 4}}));
assert("端点解析：c[2]/c[3] 缺失时退到画布对象 b",
  deepEqual(wallHint.getWallSegment({c: [0, 0]}, {b: {x: 5, y: 6}}), {a: {x: 0, y: 0}, b: {x: 5, y: 6}}));
assert("端点解析：非有限坐标返回 null", wallHint.getWallSegment({c: [0, 0, NaN, 5]}) === null);

// 默认配置 = 唯一一条默认线：统一颜色 + 所有墙体（含密门）都画。
const defaultLines = lineUtils.resolveWallHintLines([]);
assert("空配置解析成 1 条默认线", defaultLines.length === 1, `实际 ${defaultLines.length}`);
assert("默认线：实线 / #00e5ff / 宽 2 / 优先级 0 / 无条件",
  (defaultLines[0].style === "solid") && (defaultLines[0].color === 0x00e5ff)
  && (defaultLines[0].width === 2) && (defaultLines[0].priority === 0)
  && (defaultLines[0].blocking.length === 0));
assert("默认线命中所有墙体类别（含密门 / 隐形墙）",
  [normalWallDoc, secretWallDoc, invisibleWallDoc]
    .every(doc => lineUtils.selectWallLine(doc, defaultLines) === defaultLines[0]));
assert("默认配置下密门与普通墙使用同一种颜色（不泄露密门）",
  lineUtils.selectWallLine(secretWallDoc, defaultLines).color
  === lineUtils.selectWallLine(normalWallDoc, defaultLines).color);

// 多条线：条件 + 优先级。
const customLines = lineUtils.resolveWallHintLines([
  {style: "dashed", color: "#ff0000", width: 3, priority: 10, blocking: ["sight"]},
  {style: "dotted", color: "#00ff00", width: 1, priority: 5, blocking: ["move"]},
  {style: "solid", color: "#0000ff", width: 2, priority: 0, blocking: []}
]);
assert("多条线被完整保留（3 条）", customLines.length === 3, `实际 ${customLines.length}`);
assert("按优先级选线：只挡视野的墙 → 优先级 10 的虚线",
  lineUtils.selectWallLine(sightOnlyDoc, customLines).style === "dashed");
assert("按优先级选线：只挡移动的墙 → 优先级 5 的点线",
  lineUtils.selectWallLine(moveOnlyDoc, customLines).style === "dotted");
assert("按优先级选线：两条都命中的墙 → 优先级最高的那条",
  lineUtils.selectWallLine(normalWallDoc, customLines).style === "dashed");
assert("按优先级选线：只命中兜底线 → 实线",
  lineUtils.selectWallLine(invisibleWallDoc, customLines).style === "solid");
assert("条件为或关系：勾「移动 + 视野」能命中只挡移动的墙",
  lineUtils.isWallHintEligible(moveOnlyDoc, ["move", "sight"]) === true);
assert("条件为或关系：勾「视野 + 声音」不命中只挡移动的墙",
  lineUtils.isWallHintEligible(moveOnlyDoc, ["sight", "sound"]) === false);
assert("同优先级时取数组中靠前的线",
  (() => {
    const tie = lineUtils.resolveWallHintLines([
      {style: "dashed", color: "#ff0000", width: 2, priority: 0, blocking: []},
      {style: "dotted", color: "#00ff00", width: 2, priority: 0, blocking: []}
    ]);
    return lineUtils.selectWallLine(normalWallDoc, tie).style === "dashed";
  })());
assert("非法条目被丢弃；全是非法时回退默认线",
  lineUtils.resolveWallHintLines([null, 5, "x"]).length === 1);
assert("单条字段非法时安全回退（线型 solid / 默认色 / 宽度下限 1 / 优先级 0）",
  (() => {
    const [line] = lineUtils.resolveWallHintLines([{style: "bogus", color: "nope", width: 0, priority: "x"}]);
    return (line.style === "solid") && (line.color === 0x00e5ff)
      && (line.width === 1) && (line.priority === 0);
  })());
assert("阻挡类型条件会剔除不认识的值",
  deepEqual(wallHint.normalizeBlockingTypes(["move", "bogus", "move", "sight"]), ["move", "sight"]));
assert("阻挡类型条件接受对象（复选框提交形态）",
  deepEqual(wallHint.normalizeBlockingTypes({move: true, sight: false, light: true}), ["move", "light"]));

// 线型切段（纯几何）。
assert("实线：整段一画", lineUtils.splitSegmentByDash({x: 0, y: 0}, {x: 100, y: 0}, "solid").length === 1);
const dashedPieces = lineUtils.splitSegmentByDash({x: 0, y: 0}, {x: 100, y: 0}, "dashed");
assert("虚线：切出多段", dashedPieces.length > 1, `实际 ${dashedPieces.length}`);
assert("虚线：所有实线段首尾都在原线段上",
  dashedPieces.every(piece => (piece.a.y === 0) && (piece.b.y === 0)
    && (piece.a.x >= 0) && (piece.b.x <= 100)));
assert("零长度线段不产生任何绘制段",
  lineUtils.splitSegmentByDash({x: 5, y: 5}, {x: 5, y: 5}, "solid").length === 0);

assert("otherLayers 范围在墙体图层激活时隐藏",
  wallHint.shouldHideHintOnWallsLayer("otherLayers", true) === true
  && wallHint.shouldHideHintOnWallsLayer("otherLayers", false) === false);
assert("always 范围任何图层都显示",
  wallHint.shouldHideHintOnWallsLayer("always", true) === false);

/* -------------------------------------------------------------------------- */
/*  8c. Token 阻挡（像墙一样阻挡移动/视野/声音/光照）                              */
/* -------------------------------------------------------------------------- */

console.log("\n[8c] Token 阻挡");

const tokenBlocking = await import(scripts("token-blocking.mjs"));
assert("导出了冻结接口",
  !!tokenBlocking.TOKEN_BLOCKING_FLAG
  && Array.isArray(tokenBlocking.TOKEN_BLOCKING_KEYS)
  && typeof tokenBlocking.getTokenBlocking === "function"
  && typeof tokenBlocking.isEmptyTokenBlocking === "function"
  && typeof tokenBlocking.getTokenBlockingEdges === "function"
  && typeof tokenBlocking.getTokenBlockingShape === "function"
  && typeof tokenBlocking.buildAlphaContourFromAlphaData === "function"
  && typeof tokenBlocking.refreshTokenBlockingEdges === "function"
  && typeof tokenBlocking.isOwnTokenBlockingEdge === "function"
  && typeof tokenBlocking.installTokenBlockingPolygons === "function"
  && typeof tokenBlocking.installTokenBlocking === "function");
assert("通道顺序 = move/sight/sound/light",
  deepEqual(tokenBlocking.TOKEN_BLOCKING_KEYS, ["move", "sight", "sound", "light"]));
assert("默认全 false",
  deepEqual(tokenBlocking.DEFAULT_TOKEN_BLOCKING, {move: false, sight: false, sound: false, light: false}));

const blockingDoc = {
  id: "tk1", x: 100, y: 200, elevation: 5, width: 1, height: 1,
  flags: {"er-qol": {blocking: {move: true, sight: true, sound: false, light: false}}}
};
assert("读取 TokenDocument 的阻挡配置", deepEqual(tokenBlocking.getTokenBlocking(blockingDoc),
  {move: true, sight: true, sound: false, light: false}));
assert("缺失时回退默认", deepEqual(tokenBlocking.getTokenBlocking({id: "x"}),
  {move: false, sight: false, sound: false, light: false}));
assert("非布尔值按 false", deepEqual(
  tokenBlocking.getTokenBlocking({flags: {"er-qol": {blocking: {move: 1, sight: "true"}}}}),
  {move: false, sight: false, sound: false, light: false}));
assert("isEmptyTokenBlocking：全 false → true",
  tokenBlocking.isEmptyTokenBlocking({move: false, sight: false, sound: false, light: false}) === true);
assert("isEmptyTokenBlocking：有一项 → false",
  tokenBlocking.isEmptyTokenBlocking({move: true}) === false);

const EdgeStub = class {
  constructor(a, b, options) {
    Object.assign(this, options);
    this.a = a;
    this.b = b;
  }
};
assert("全 false 不产生任何边",
  deepEqual(tokenBlocking.getTokenBlockingEdges({id: "x", flags: {}}, {EdgeClass: EdgeStub, width: 100, height: 100}), []));
const blockingEdges = tokenBlocking.getTokenBlockingEdges(blockingDoc, {EdgeClass: EdgeStub, width: 100, height: 100});
assert("四条边（矩形）", blockingEdges.length === 4, `实际 ${blockingEdges.length}`);
assert("边 id 前缀正确且唯一",
  blockingEdges.every(edge => String(edge.id).startsWith("er-qol.tokenBlocking."))
  && new Set(blockingEdges.map(edge => edge.id)).size === 4);
assert("边 type=wall、direction=BOTH、object 指向所属 TokenDocument",
  blockingEdges.every(edge => (edge.type === "wall")
    && (edge.direction === CONST.EDGE_DIRECTIONS.BOTH)
    && (edge.object === blockingDoc)));
assert("四通道逐项映射（勾 move+sight）：move=NORMAL、sight=LIMITED、sound/light=NONE",
  blockingEdges.every(edge => (edge.move === CONST.EDGE_SENSE_TYPES.NORMAL)
    && (edge.sight === CONST.EDGE_SENSE_TYPES.LIMITED)
    && (edge.sound === CONST.EDGE_SENSE_TYPES.NONE)
    && (edge.light === CONST.EDGE_SENSE_TYPES.NONE)));

// 自我豁免：backend 包装层只跳过"source 指向同一个 TokenDocument"的边。
const selfSource = {object: {document: blockingDoc}};
const otherSource = {object: {document: {id: "other-token"}}};
assert("**Token 自己的 sweep（source.object.document === edge.object）会跳过自己的边**",
  blockingEdges.every(edge => tokenBlocking.isOwnTokenBlockingEdge(edge, selfSource)));
assert("**其他 Token 的 sweep 不会跳过这些边**",
  blockingEdges.every(edge => !tokenBlocking.isOwnTokenBlockingEdge(edge, otherSource)));
assert("非本模组登记的边永远不跳过",
  tokenBlocking.isOwnTokenBlockingEdge({id: "core.wall.1", object: blockingDoc}, selfSource) === false);
assert("没有 source（手工 polygon 等）时不跳过",
  blockingEdges.every(edge => !tokenBlocking.isOwnTokenBlockingEdge(edge, null)));
assert("高度取自 doc.elevation", blockingEdges.every(edge => edge.a.elevation === 5));
assert("options.elevation 覆盖 doc.elevation",
  tokenBlocking.getTokenBlockingEdges(blockingDoc, {EdgeClass: EdgeStub, width: 100, height: 100, elevation: 0})
    .every(edge => edge.a.elevation === 0));
assert("缺 EdgeClass → 空数组且不抛错",
  deepEqual(tokenBlocking.getTokenBlockingEdges(blockingDoc, {width: 100, height: 100}), []));

// ---- 阻挡形状：矩形 / 椭圆 / 图片边缘（2026-10-23 追加） ----
assert("形状清单 = rect / ellipse / alpha",
  deepEqual(tokenBlocking.TOKEN_BLOCKING_SHAPES, ["rect", "ellipse", "alpha"]));
assert("默认形状 = rect", tokenBlocking.getTokenBlockingShape(blockingDoc) === "rect");
assert("形状读取来自 flags['er-qol'].blocking.shape",
  tokenBlocking.getTokenBlockingShape({flags: {"er-qol": {blocking: {move: true, shape: "ellipse"}}}}) === "ellipse");
assert("非法形状回退 rect",
  tokenBlocking.getTokenBlockingShape({flags: {"er-qol": {blocking: {shape: "hexagon"}}}}) === "rect");
assert("getTokenBlocking() 仍只返回 4 个布尔键（形状是独立字段，不污染通道语义）",
  deepEqual(Object.keys(tokenBlocking.getTokenBlocking({flags: {"er-qol": {blocking: {move: true, shape: "ellipse"}}}})),
    ["move", "sight", "sound", "light"]));

const ellipseDoc = {id: "ell", x: 0, y: 0, width: 1, height: 1,
  flags: {"er-qol": {blocking: {move: true, shape: "ellipse"}}}};
const ellipseEdges = tokenBlocking.getTokenBlockingEdges(ellipseDoc, {EdgeClass: EdgeStub, width: 100, height: 100});
assert("椭圆形状生成 48 条边（闭合多边形）", ellipseEdges.length === 48, `实际 ${ellipseEdges.length}`);
assert("椭圆点都落在占位矩形内、且满足椭圆方程（不是四角）",
  ellipseEdges.every(edge => (edge.a.x >= 0) && (edge.a.x <= 100) && (edge.a.y >= 0) && (edge.a.y <= 100))
  && ellipseEdges.every(edge => {
    const nx = (edge.a.x - 50) / 50;
    const ny = (edge.a.y - 50) / 50;
    return Math.abs((nx * nx) + (ny * ny) - 1) < 1e-9;
  }));
assert("椭圆边 id 连续且唯一", new Set(ellipseEdges.map(edge => edge.id)).size === 48);

const alphaDoc = {id: "alpha", x: 0, y: 0, width: 1, height: 1,
  texture: {src: "token.webp", anchorX: 0.5, anchorY: 0.5, scaleX: 1, scaleY: 1, fit: "contain"},
  flags: {"er-qol": {blocking: {move: true, shape: "alpha"}}}};
assert("alpha 形状没有轮廓时回退成矩形（4 条边）",
  tokenBlocking.getTokenBlockingEdges(alphaDoc, {EdgeClass: EdgeStub, width: 100, height: 100}).length === 4);
const fakeContour = {
  width: 10, height: 10,
  points: [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}, {x: 0, y: 1}]
};
const alphaEdges = tokenBlocking.getTokenBlockingEdges(alphaDoc, {EdgeClass: EdgeStub, width: 100, height: 100, contour: fakeContour});
assert("alpha 形状使用传入轮廓（4 个点 → 4 条边，映射到占位矩形）",
  alphaEdges.length === 4
  && alphaEdges.map(edge => [edge.a.x, edge.a.y]).join(";") === "0,0;100,0;100,100;0,100");

// 图片显示矩形：方形图 → 正好等于占位矩形；2:1 图按 contain 居中留白。
const footprint = {left: 0, top: 0, right: 100, bottom: 100};
assert("getTokenTextureRectangle：方形图 + contain → 与占位矩形一致",
  deepEqual(tokenBlocking.getTokenTextureRectangle(
    {texture: {fit: "contain", anchorX: 0.5, anchorY: 0.5, scaleX: 1, scaleY: 1}},
    footprint, 100, 100), {left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100}));
assert("getTokenTextureRectangle：2:1 图 + contain → 100×50 居中",
  deepEqual(tokenBlocking.getTokenTextureRectangle(
    {texture: {fit: "contain", anchorX: 0.5, anchorY: 0.5, scaleX: 1, scaleY: 1}},
    footprint, 200, 100), {left: 0, top: 25, right: 100, bottom: 75, width: 100, height: 50}));

// 纯 alpha 数据 → 轮廓（不依赖 canvas）
const makeAlpha = (w, h, predicate) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const offset = ((y * w) + x) * 4;
    data[offset] = 255; data[offset + 1] = 255; data[offset + 2] = 255;
    data[offset + 3] = predicate(x, y) ? 255 : 0;
  }
  return data;
};
const opaqueSquare = tokenBlocking.buildAlphaContourFromAlphaData(makeAlpha(16, 16, () => true), 16, 16, {segments: 16});
assert("alpha 轮廓：整张不透明图片 → 16 个点、半径接近边界",
  opaqueSquare?.points?.length === 16
  && opaqueSquare.points.every(point => (point.x > 0.75) || (point.x < 0.25)
    || (point.y > 0.75) || (point.y < 0.25)));
const opaqueCircle = tokenBlocking.buildAlphaContourFromAlphaData(
  makeAlpha(32, 32, (x, y) => Math.hypot(x - 15.5, y - 15.5) <= 12), 32, 32, {segments: 32});
assert("alpha 轮廓：圆形图 → 点到重心距离近似相等（星形轮廓）",
  opaqueCircle?.points?.length === 32
  && (() => {
    const radii = opaqueCircle.points.map(point => Math.hypot(point.x - 0.5, point.y - 0.5));
    const avg = radii.reduce((a, b) => a + b, 0) / radii.length;
    return radii.every(radius => Math.abs(radius - avg) < 0.06);
  })());
assert("alpha 轮廓：全透明 → null（调用方回退矩形）",
  tokenBlocking.buildAlphaContourFromAlphaData(makeAlpha(8, 8, () => false), 8, 8) === null);

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
