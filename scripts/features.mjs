/**
 * er-qol 新增功能：区域提示（Announce）、悬停高亮（Hover Highlight）、区域信息（Region Info）、
 * 区域传送（Teleport）。
 *
 * 这些功能都是原 `region-lighting` / `region-walls` 之外的追加能力，
 * 全部可以在模组设置里单独关闭（Behavior 类的功能则在行为自身勾选项里关闭）。
 *
 * @module er-qol/scripts/features
 */

import {
  MODULE_ID,
  erqol,
  format,
  localize,
  getRegionPolygonTree,
  getProbeElevation,
  getRegionSampleElevation
} from "./region-common.mjs";

/* -------------------------------------------------------------------------- */
/*  设置注册                                                                     */
/* -------------------------------------------------------------------------- */

/** 模组设置键。 */
export const SETTINGS = Object.freeze({
  HOVER_HIGHLIGHT: "hoverHighlight",
  HOVER_INFO: "hoverInfo",
  TELEPORT_COOLDOWN: "teleportCooldown"
});

/** 区域提示（Announce）的 Behavior type 键。 */
export const ANNOUNCE_TYPE = `${MODULE_ID}.regionAnnounce`;

/** 区域传送（Teleport）的 Behavior type 键。 */
export const TELEPORT_TYPE = `${MODULE_ID}.regionTeleport`;

/** 传送冷却标记，写在 `token.flags["er-qol"].teleportCooldown`。 */
const TELEPORT_COOLDOWN_FLAG = "teleportCooldown";

/**
 * 注册模组设置。
 * 必须在 `Hooks.once("init")` 中调用。
 * @returns {void}
 */
export function registerFeatureSettings() {
  game.settings.register(MODULE_ID, SETTINGS.HOVER_HIGHLIGHT, {
    name: "ERQOL.SETTINGS.hoverHighlight.name",
    hint: "ERQOL.SETTINGS.hoverHighlight.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.HOVER_INFO, {
    name: "ERQOL.SETTINGS.hoverInfo.name",
    hint: "ERQOL.SETTINGS.hoverInfo.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.TELEPORT_COOLDOWN, {
    name: "ERQOL.SETTINGS.teleportCooldown.name",
    hint: "ERQOL.SETTINGS.teleportCooldown.hint",
    scope: "world",
    config: true,
    type: Number,
    range: {min: 0, max: 10000, step: 100},
    default: 1000
  });
}

/**
 * 读取布尔设置（在 `ready` 之前调用也不会抛错）。
 * @param {string} key 设置键
 * @param {boolean} [fallback=true] 读取失败时的回退值
 * @returns {boolean} 设置值
 */
function getBoolSetting(key, fallback = true) {
  try {
    return !!game.settings.get(MODULE_ID, key);
  } catch ( err ) {
    return fallback;
  }
}

/**
 * 读取数字设置。
 * @param {string} key 设置键
 * @param {number} [fallback=0] 读取失败时的回退值
 * @returns {number} 设置值
 */
function getNumberSetting(key, fallback = 0) {
  try {
    const value = Number(game.settings.get(MODULE_ID, key));
    return Number.isFinite(value) ? value : fallback;
  } catch ( err ) {
    return fallback;
  }
}

/* -------------------------------------------------------------------------- */
/*  Region Announce：走进/离开 Region 时提示或发聊天消息                          */
/* -------------------------------------------------------------------------- */

/**
 * 「区域提示」Behavior：Token 进入/离开 Region 时发送聊天消息或界面通知。
 * @extends {foundry.data.regionBehaviors.RegionBehaviorType}
 */
export class RegionAnnounceBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  /** @override */
  static LOCALIZATION_PREFIXES = ["ERQOL.REGION_ANNOUNCE"];

  /** @override */
  static defineSchema() {
    const {BooleanField, NumberField, SchemaField, StringField} = foundry.data.fields;
    return {
      notifyEntry: new BooleanField({
        initial: true,
        label: "ERQOL.REGION_ANNOUNCE.FIELDS.notifyEntry.label",
        hint: "ERQOL.REGION_ANNOUNCE.FIELDS.notifyEntry.hint"
      }),
      notifyExit: new BooleanField({
        initial: false,
        label: "ERQOL.REGION_ANNOUNCE.FIELDS.notifyExit.label",
        hint: "ERQOL.REGION_ANNOUNCE.FIELDS.notifyExit.hint"
      }),
      entryMessage: new StringField({
        required: true,
        blank: true,
        initial: "",
        label: "ERQOL.REGION_ANNOUNCE.FIELDS.entryMessage.label",
        hint: "ERQOL.REGION_ANNOUNCE.FIELDS.entryMessage.hint"
      }),
      exitMessage: new StringField({
        required: true,
        blank: true,
        initial: "",
        label: "ERQOL.REGION_ANNOUNCE.FIELDS.exitMessage.label",
        hint: "ERQOL.REGION_ANNOUNCE.FIELDS.exitMessage.hint"
      }),
      output: new StringField({
        required: true,
        blank: false,
        initial: "notification",
        choices: {
          notification: "ERQOL.REGION_ANNOUNCE.OUTPUT.notification",
          chat: "ERQOL.REGION_ANNOUNCE.OUTPUT.chat"
        },
        label: "ERQOL.REGION_ANNOUNCE.FIELDS.output.label",
        hint: "ERQOL.REGION_ANNOUNCE.FIELDS.output.hint"
      }),
      visibility: new StringField({
        required: true,
        blank: false,
        initial: "observers",
        choices: {
          all: "ERQOL.REGION_ANNOUNCE.VISIBILITY.all",
          observers: "ERQOL.REGION_ANNOUNCE.VISIBILITY.observers",
          gm: "ERQOL.REGION_ANNOUNCE.VISIBILITY.gm"
        },
        label: "ERQOL.REGION_ANNOUNCE.FIELDS.visibility.label",
        hint: "ERQOL.REGION_ANNOUNCE.FIELDS.visibility.hint"
      }),
      sound: new SchemaField({
        enabled: new BooleanField({
          initial: false,
          label: "ERQOL.REGION_ANNOUNCE.FIELDS.soundEnabled.label"
        }),
        src: new StringField({
          required: true,
          blank: true,
          initial: "",
          label: "ERQOL.REGION_ANNOUNCE.FIELDS.sound.src.label"
        }),
        volume: new NumberField({
          required: true,
          nullable: false,
          min: 0,
          max: 1,
          step: 0.05,
          initial: 0.6,
          label: "ERQOL.REGION_ANNOUNCE.FIELDS.sound.volume.label"
        })
      })
    };
  }

  /** @override */
  static events = {
    [CONST.REGION_EVENTS.TOKEN_ENTER]: this.#onRegionEvent,
    [CONST.REGION_EVENTS.TOKEN_EXIT]: this.#onRegionEvent
  };

  /**
   * 静态事件回调：转发给实例方法处理。
   * @param {object} event 事件对象
   * @returns {void}
   */
  static #onRegionEvent(event) {
    this.#dispatch(event);
  }

  /**
   * 处理进入/离开事件（含去重与权限判断）。
   * @param {object} event 事件对象，含 `name`、`data.token`、`data.movement`
   * @returns {void}
   */
  #dispatch(event) {
    if ( !this.behavior?.active ) return;
    const entering = event?.name === CONST.REGION_EVENTS.TOKEN_ENTER;
    if ( entering && !this.notifyEntry ) return;
    if ( !entering && !this.notifyExit ) return;

    const token = event?.data?.token;
    if ( !token ) return;
    const region = this.behavior?.parent;
    const regionName = region?.name || localize("ERQOL.NOTIFY.unnamedRegion", "Region");
    const tokenName = token.name ?? token.actor?.name ?? "";

    const custom = entering ? this.entryMessage : this.exitMessage;
    const fallbackKey = entering ? "ERQOL.NOTIFY.regionEntry" : "ERQOL.NOTIFY.regionExit";
    const message = (custom && custom.trim().length)
      ? format(custom, {token: tokenName, region: regionName})
      : format(fallbackKey, {token: tokenName, region: regionName});

    this.#deliver(message, token);
  }

  /**
   * 按 `output` / `visibility` 配置投递消息。
   *
   * **去重**：Foundry 会把 Region 事件广播给每个客户端，因此"创建聊天消息"只能由
   * 一个客户端执行——这里限定为当前联网 GM，否则 N 个客户端会发出 N 条重复消息。
   * 界面通知是本地的，各客户端按可见范围自己显示即可。
   *
   * @param {string} message 已渲染的文本
   * @param {TokenDocument} token 触发事件的 Token
   * @returns {void}
   */
  #deliver(message, token) {
    if ( this.output === "chat" ) {
      if ( isActiveGM() ) {
        const recipients = this.#getRecipients(token);
        ChatMessage.create({
          content: `<p class="er-qol-region-announce">${foundry.utils.escapeHTML(message)}</p>`,
          speaker: ChatMessage.getSpeaker({token: token.object ?? undefined}),
          ...(recipients ? {whisper: recipients} : {})
        });
      }
    } else {
      const visibleToMe = this.#isVisibleToMe(token);
      if ( !visibleToMe ) return;
      ui.notifications.info(message);
    }

    // 音效不受"聊天消息只由 Active GM 创建"的限制：那是为了去重消息，
    // 而提示音本来就该在能听到的客户端各自播放。
    playAnnounceSound(this.sound);
  }

  /**
   * 判断当前用户是否应该看到该提示。
   * @param {TokenDocument} token 触发事件的 Token
   * @returns {boolean} 应该看到返回 true
   */
  #isVisibleToMe(token) {
    switch ( this.visibility ) {
      case "all": return true;
      case "gm": return !!game.user?.isGM;
      default: return !!game.user?.isGM || token?.isOwner;
    }
  }

  /**
   * 计算聊天消息的接收者；`all` / 无效时返回 null 表示公开。
   * @param {TokenDocument} token 触发事件的 Token
   * @returns {string[]|null} 用户 id 数组，或 null（公开）
   */
  #getRecipients(token) {
    switch ( this.visibility ) {
      case "all": return null;
      case "gm": return game.users?.filter(user => user.isGM).map(user => user.id) ?? [];
      default: {
        const recipients = new Set();
        for ( const user of (game.users ?? []) ) {
          if ( user.isGM || token?.testUserPermission?.(user, "OBSERVER") ) recipients.add(user.id);
        }
        return recipients.size ? [...recipients] : null;
      }
    }
  }
}

/**
 * 判断当前用户是不是"当前联网的 GM"（Active GM）。
 *
 * 用来给聊天播报去重：Foundry 会把 Region 事件广播给每个客户端，
 * 若每个客户端都建一条 ChatMessage，消息数会等于在线客户端数。
 *
 * @returns {boolean} 当前用户是 Active GM 时返回 true
 */
function isActiveGM() {
  if ( !game.user?.isGM ) return false;
  const activeGM = game.users?.activeGM ?? null;
  if ( activeGM ) return activeGM.id === game.user.id;
  // 退化路径：老版本/异常情况下没有任何 activeGM 标记时，只认第一个 GM。
  const firstGM = (game.users?.contents ?? []).find(user => user.isGM);
  return !firstGM || (firstGM.id === game.user.id);
}

/**
 * 注册「区域提示」Behavior 的全部 type 键。
 * @returns {void}
 */
export function registerAnnounceBehaviorTypes() {
  CONFIG.RegionBehavior.dataModels[ANNOUNCE_TYPE] = RegionAnnounceBehaviorType;
  CONFIG.RegionBehavior.typeLabels[ANNOUNCE_TYPE] = "ERQOL.REGION_ANNOUNCE.label";
  CONFIG.RegionBehavior.typeHints[ANNOUNCE_TYPE] = "ERQOL.REGION_ANNOUNCE.hint";
  CONFIG.RegionBehavior.typeIcons[ANNOUNCE_TYPE] = "fa-solid fa-bullhorn";
}

/* -------------------------------------------------------------------------- */
/*  Region Teleport：走到出口 Region 时自动传送到目的地                            */
/* -------------------------------------------------------------------------- */

/**
 * 「区域传送」Behavior：Token 进入本 Region 时被传送到另一个场景/坐标。
 * @extends {foundry.data.regionBehaviors.RegionBehaviorType}
 */
export class RegionTeleportBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  /** @override */
  static LOCALIZATION_PREFIXES = ["ERQOL.REGION_TELEPORT"];

  /** @override */
  static defineSchema() {
    const {BooleanField, NumberField, StringField} = foundry.data.fields;
    return {
      scene: new StringField({
        required: true,
        blank: true,
        initial: "",
        label: "ERQOL.REGION_TELEPORT.FIELDS.scene.label",
        hint: "ERQOL.REGION_TELEPORT.FIELDS.scene.hint"
      }),
      x: new NumberField({
        required: true,
        nullable: false,
        initial: 0,
        label: "ERQOL.REGION_TELEPORT.FIELDS.x.label"
      }),
      y: new NumberField({
        required: true,
        nullable: false,
        initial: 0,
        label: "ERQOL.REGION_TELEPORT.FIELDS.y.label"
      }),
      elevation: new NumberField({
        required: true,
        nullable: false,
        initial: 0,
        label: "ERQOL.REGION_TELEPORT.FIELDS.elevation.label"
      }),
      consume: new BooleanField({
        initial: true,
        label: "ERQOL.REGION_TELEPORT.FIELDS.consume.label",
        hint: "ERQOL.REGION_TELEPORT.FIELDS.consume.hint"
      }),
      notify: new BooleanField({
        initial: true,
        label: "ERQOL.REGION_TELEPORT.FIELDS.notify.label"
      }),
      message: new StringField({
        required: true,
        blank: true,
        initial: "",
        label: "ERQOL.REGION_TELEPORT.FIELDS.message.label",
        hint: "ERQOL.REGION_TELEPORT.FIELDS.message.hint"
      }),
      destinationRegion: new StringField({
        required: true,
        blank: true,
        initial: "",
        label: "ERQOL.REGION_TELEPORT.FIELDS.destinationRegion.label",
        hint: "ERQOL.REGION_TELEPORT.FIELDS.destinationRegion.hint"
      })
    };
  }

  /** @override */
  static events = {
    [CONST.REGION_EVENTS.TOKEN_ENTER]: this.#onRegionEvent
  };

  /**
   * 静态事件回调：转发给实例方法处理。
   * @param {object} event 事件对象
   * @returns {void}
   */
  static #onRegionEvent(event) {
    this.#dispatch(event);
  }

  /**
   * 执行一次传送尝试。
   * @param {object} event 事件对象
   * @returns {Promise<void>} 完成后的 Promise
   */
  async #dispatch(event) {
    if ( !this.behavior?.active ) return;
    const token = event?.data?.token;
    if ( !token ) return;
    if ( !game.user?.isGM && !token.isOwner ) return;

    const cooldown = Math.max(0, getNumberSetting(SETTINGS.TELEPORT_COOLDOWN, 1000));
    const last = Number(token.getFlag?.(MODULE_ID, TELEPORT_COOLDOWN_FLAG) ?? 0);

    const targetScene = this.scene ? game.scenes?.get(this.scene) : canvas.scene;
    const destinationRegion = (this.destinationRegion ?? "").trim();

    // 到达站点判定要放在冷却判断之前：若是刚被传送到站点上，先解除冷却，不要再触发下一次传送。
    // 只有"Token 真的站在到达站点 Region 内"才提前返回；仅仅存在同名 Region 不算。
    // 并且只在**同场景**时判定：跨场景时 Token 的坐标还留在原场景，
    // 拿它去测目标场景的同名 Region 会误判成"已到达"从而取消传送。
    const sameScene = !!targetScene && (token.parent?.id === targetScene.id);
    if ( this.consume && sameScene && findDestinationRegion(targetScene, token, destinationRegion) ) {
      if ( last ) await token.unsetFlag(MODULE_ID, TELEPORT_COOLDOWN_FLAG);
      return;
    }
    if ( last && ((Date.now() - last) < cooldown) ) return;

    if ( !targetScene ) {
      ui.notifications.warn(localize("ERQOL.REGION_TELEPORT.NOTIFY.noScene",
        "Region Teleport: destination scene not found."));
      return;
    }

    const regionName = this.behavior?.parent?.name ?? "";
    const tokenName = token.name ?? "";
    const message = (this.message && this.message.trim().length)
      ? format(this.message, {token: tokenName, region: regionName})
      : format("ERQOL.NOTIFY.teleported", {token: tokenName, region: regionName});

    // 跨场景：删除原 Token 并在目标场景创建一份新的。
    if ( token.parent?.id !== targetScene.id ) {
      // 创建 Token 需要 TOKEN_CREATE 权限（默认只有 ASSISTANT/GM 有），玩家客户端做不到，
      // 因此这里只对 GM 生效；否则给出明确提示，而不是静默失败。
      if ( !game.user?.isGM ) {
        ui.notifications.warn(localize("ERQOL.REGION_TELEPORT.NOTIFY.needGm",
          "Region Teleport: changing scene requires the GM."));
        return;
      }
      const createData = token.toObject();
      delete createData._id;
      createData.x = this.x;
      createData.y = this.y;
      createData.elevation = this.elevation ?? 0;
      await targetScene.createEmbeddedDocuments("Token", [createData]);
      await token.delete();
      _notifyTeleport(this.notify, message, token);
      return;
    }

    const updates = {x: this.x, y: this.y};
    if ( Number.isFinite(this.elevation) ) updates.elevation = this.elevation;
    await token.update(updates);

    if ( cooldown > 0 ) {
      await token.setFlag(MODULE_ID, TELEPORT_COOLDOWN_FLAG, Date.now());
      if ( this.consume ) {
        // 兜底：若到达站点判定没能解除冷却，冷却结束后自动清掉，避免 Token 被永久锁死。
        setTimeout(() => {
          token.unsetFlag(MODULE_ID, TELEPORT_COOLDOWN_FLAG).catch(() => {});
        }, Math.max(250, cooldown));
      }
    }
    _notifyTeleport(this.notify, message, token);
  }
}

/**
 * 播放 Announce 配置的提示音（若启用）。
 *
 * 与聊天消息分开处理：聊天消息只由 Active GM 创建（去重），
 * 但提示音应该在每个"能收到这条播报"的客户端各自播放。
 *
 * @param {object} sound `system.sound`，含 `enabled` / `src` / `volume`
 * @returns {void}
 */
function playAnnounceSound(sound) {
  if ( !sound?.enabled || !sound.src ) return;
  // Foundry v13+ 走 foundry.audio.AudioHelper，旧版本仍有全局 AudioHelper。
  const AudioHelper = globalThis.foundry?.audio?.AudioHelper ?? globalThis.AudioHelper;
  try {
    AudioHelper?.play?.({
      src: sound.src,
      volume: sound.volume ?? 0.6,
      autoplay: true,
      loop: false
    }, false);
  } catch ( err ) {
    console.warn(`${MODULE_ID} | announce sound failed`, err);
  }
}

/**
 * 在目的地场景里按名字查找"到达站点 Region"，并确认 Token 确实站在它里面。
 *
 * 只按名字存在性判断是不够的——那会把"场景里恰好有同名 Region"误判成"已经到达"，
 * 从而把正常的传送静默取消。因此这里优先用 `TokenDocument#testInsideRegion()`，
 * 退化时用 Region 的 `testPoint()` 加 Token 当前坐标判断。
 *
 * @param {Scene} destinationScene 目的地场景
 * @param {TokenDocument} token 被传送的 Token
 * @param {string} regionName 到达站点 Region 的名称
 * @returns {RegionDocument|null} 命中的到达站点 Region，未命中为 null
 */
function findDestinationRegion(destinationScene, token, regionName) {
  if ( !regionName || !destinationScene?.regions ) return null;

  for ( const region of destinationScene.regions ) {
    if ( region.name !== regionName ) continue;
    if ( typeof token.testInsideRegion === "function" ) {
      if ( token.testInsideRegion(region) ) return region;
      continue;
    }
    const point = {x: token.x, y: token.y, elevation: token.elevation ?? 0};
    if ( region.testPoint?.(point) ) return region;
  }
  return null;
}

/**
 * 按需给触发的用户发提示。
 * @param {boolean} enabled 是否启用提示
 * @param {string} message 提示文本
 * @param {TokenDocument} token 触发传送的 Token
 * @returns {void}
 */
function _notifyTeleport(enabled, message, token) {
  if ( !enabled ) return;
  if ( !game.user?.isGM && !token?.isOwner ) return;
  ui.notifications.info(message);
}

/**
 * 注册「区域传送」Behavior 的 type 键。
 * @returns {void}
 */
export function registerTeleportBehaviorTypes() {
  CONFIG.RegionBehavior.dataModels[TELEPORT_TYPE] = RegionTeleportBehaviorType;
  CONFIG.RegionBehavior.typeLabels[TELEPORT_TYPE] = "ERQOL.REGION_TELEPORT.label";
  CONFIG.RegionBehavior.typeHints[TELEPORT_TYPE] = "ERQOL.REGION_TELEPORT.hint";
  CONFIG.RegionBehavior.typeIcons[TELEPORT_TYPE] = "fa-solid fa-door-open";
}

/* -------------------------------------------------------------------------- */
/*  悬停高亮 + 区域信息                                                          */
/* -------------------------------------------------------------------------- */

/** 高亮图层容器，`null` 表示尚未创建。 */
let highlightLayer = null;

/** 当前高亮的 Region id，`null` 表示没有。 */
let highlightedRegionId = null;

/** 绑定过交互事件的 Region 对象，用于避免重复绑定。 */
const boundRegionObjects = new WeakSet();

const HIGHLIGHT_NAME = "erqolHoverHighlight";

/**
 * 取得（必要时创建）高亮图层。
 * @returns {PIXI.Container|null} 图层容器
 */
function getHighlightLayer() {
  if ( highlightLayer && !highlightLayer.destroyed ) return highlightLayer;

  let parent = null;
  try {
    parent = canvas?.regions ?? canvas?.interface ?? canvas?.stage ?? null;
  } catch ( err ) {
    parent = null;
  }
  if ( !parent ) return null;

  const layer = new PIXI.Container();
  layer.name = HIGHLIGHT_NAME;
  layer.eventMode = "none";
  layer.interactiveChildren = false;
  layer.zIndex = 9999;
  parent.addChild(layer);
  highlightLayer = layer;
  return layer;
}

/**
 * 清空高亮。
 * @returns {void}
 */
function clearHighlight() {
  highlightedRegionId = null;
  if ( !highlightLayer || highlightLayer.destroyed ) return;
  highlightLayer.removeChildren().forEach(child => child.destroy?.({children: true}));
}

/**
 * 用 Region 的多边形树绘制一次性高亮轮廓 + 半透明填充。
 * @param {RegionDocument} region Region 文档
 * @returns {void}
 */
function drawHighlight(region) {
  const layer = getHighlightLayer();
  if ( !layer ) return;

  const graphics = new PIXI.Graphics();
  graphics.eventMode = "none";
  let drew = false;

  for ( const node of getRegionPolygonTree(region) ) {
    const points = Array.isArray(node.path) ? node.path : null;
    if ( !points || (points.length < 3) ) continue;
    graphics.beginFill(0x66ccff, 0.16);
    graphics.lineStyle(3, 0x66ccff, 0.85);
    graphics.moveTo(points[0].x, points[0].y);
    for ( let i = 1; i < points.length; i++ ) graphics.lineTo(points[i].x, points[i].y);
    graphics.closePath();
    graphics.endFill();
    drew = true;
  }

  if ( !drew ) {
    graphics.destroy();
    return;
  }

  clearHighlight();
  highlightedRegionId = region.id;
  layer.addChild(graphics);
}

/**
 * 在屏幕上显示区域信息提示。
 * @param {RegionDocument} region Region 文档
 * @param {PIXI.FederatedPointerEvent|PointerEvent} event 指针事件
 * @returns {void}
 */
function showRegionInfo(region, event) {
  const elevation = region.elevation ?? {};
  const behaviorNames = [...(region.behaviors ?? [])]
    .map(behavior => {
      const key = `TYPES.RegionBehavior.${behavior.type}`;
      // 本地化失败时回退到 type 键里最后一段（例如 `er-qol.regionWall` → `regionWall`），
      // 避免直接显示整串 type 键。
      const fallback = String(behavior.type ?? "").split(".").pop() || behavior.type;
      return localize(key, fallback);
    });

  const html = [
    `<div class="erqol-region-info">`,
    `<strong>${foundry.utils.escapeHTML(region.name || localize("ERQOL.NOTIFY.unnamedRegion", "Region"))}</strong>`,
    `<div>${localize("ERQOL.INFO.behaviors", "Behaviors")}: ${behaviorNames.length
      ? foundry.utils.escapeHTML(behaviorNames.join(", ")) : "-"}</div>`,
    `<div>${localize("ERQOL.INFO.elevation", "Elevation")}: ${elevation.bottom ?? "-"} ~ ${elevation.top ?? "-"}</div>`,
    `<div>${localize("ERQOL.INFO.shapes", "Shapes")}: ${[...getRegionPolygonTree(region)].length}</div>`,
    `</div>`
  ].join("");

  const position = (event && "clientX" in event)
    ? {left: event.clientX + 12, top: event.clientY + 12}
    : undefined;
  ui.notifications?.info?.(html, {permanent: false, ...(position ?? {})});
}

/**
 * 给单个 Region 的画布对象绑定悬停交互。
 * @param {Region} regionObject Region 画布对象
 * @returns {void}
 */
function bindRegionHover(regionObject) {
  if ( !regionObject || boundRegionObjects.has(regionObject) ) return;

  const onOver = event => {
    const region = regionObject.document;
    if ( !region ) return;
    if ( getBoolSetting(SETTINGS.HOVER_HIGHLIGHT) ) drawHighlight(region);
    if ( getBoolSetting(SETTINGS.HOVER_INFO) ) showRegionInfo(region, event?.data?.originalEvent ?? event);
  };

  const onOut = () => {
    clearHighlight();
  };

  // 只监听 pointer* 事件：本机 Foundry 打包的 PIXI 7.4.3 对鼠标/触控笔会**同时**派发
  // 等价的 mouse* 事件，两个都绑会导致一次悬停触发两遍（区域信息重复弹出）。
  regionObject.on("pointerover", onOver);
  regionObject.on("pointerout", onOut);

  // Region 对象默认 `eventMode` 由核心按 `isInteractable` 管理；只有在它明确不可交互时
  // 才补一次，既保证我们的悬停回调能收到事件，又不去覆盖核心的状态机。
  if ( (regionObject.eventMode === "none") || (regionObject.eventMode === undefined) ) {
    regionObject.eventMode = "static";
  }

  boundRegionObjects.add(regionObject);
}

/**
 * 在 Region 绘制完成后绑定悬停交互。
 * @param {Region} regionObject Region 画布对象
 * @returns {void}
 */
export function onDrawRegion(regionObject) {
  if ( !getBoolSetting(SETTINGS.HOVER_HIGHLIGHT) && !getBoolSetting(SETTINGS.HOVER_INFO) ) return;
  bindRegionHover(regionObject);
}

/**
 * 重新绘制时清掉旧的高亮（Region 可能已被删除）。
 * @param {Region} regionObject Region 画布对象
 * @returns {void}
 */
export function onRefreshRegion(regionObject) {
  if ( highlightedRegionId && (regionObject?.document?.id === highlightedRegionId) ) clearHighlight();
}

/**
 * 销毁画布级缓存（切换场景时调用）。
 * @returns {void}
 */
export function onCanvasTearDown() {
  clearHighlight();
  highlightLayer = null;
}

/**
 * 注册悬停相关钩子。
 * @returns {void}
 */
export function registerHoverFeatures() {
  Hooks.on("drawRegion", onDrawRegion);
  Hooks.on("refreshRegion", onRefreshRegion);
  Hooks.on("canvasTearDown", onCanvasTearDown);
  Hooks.on("closeSettingsConfig", () => clearHighlight());
}

/**
 * 汇总所有新功能的注册（设置 + Behavior type）。
 * 必须在 `Hooks.once("init")` 中调用。
 * @returns {void}
 */
export function registerFeatureTypes() {
  registerFeatureSettings();
  registerAnnounceBehaviorTypes();
  registerTeleportBehaviorTypes();
}

// 把新增功能一并挂到模组 API 上，方便宏里复用。
Object.assign(erqol, {
  ANNOUNCE_TYPE,
  TELEPORT_TYPE,
  SETTINGS,
  clearHighlight,
  getProbeElevation,
  getRegionSampleElevation
});
