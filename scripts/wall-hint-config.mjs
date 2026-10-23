/**
 * 墙体提示线：**多条线配置**的设置子菜单（ApplicationV2）。
 *
 * 设置面板里只有「墙体提示线」总开关 / 透明度 / 显示范围；"多条线"这种结构化数据
 * 用一个自定义子菜单编辑（`game.settings.registerMenu` 在 `settings.mjs` 里注册）。
 *
 * ## 为什么是自定义菜单而不是普通设置项
 *
 * Foundry 的设置面板对 `type` 是 DataField 实例的项走 `formGroup` 渲染；数组/对象里的
 * 嵌套结构没有一个"一次编辑多行"的通用控件（`ArrayField` 甚至没有 `_toInput`，
 * 会让整个设置项渲染成空白）。所以这里用 ApplicationV2 + 模板自己做表格编辑器：
 * 每行一条线（线型 / 颜色 / 宽度 / 条件 / 优先级），支持增删与恢复默认。
 *
 * ## 与默认值的关系
 *
 * 设置里 `[]` 表示"内置默认线"（实线、`#00e5ff`、宽 2、无条件下所有墙体）。
 * 编辑器打开时若设置为空，会**回填一条可编辑的默认线**；保存时若内容仍等于默认线，
 * 会写回 `[]`，保持"默认 = 统一颜色 + 所有墙体"的语义。
 *
 * @module er-qol/scripts/wall-hint-config
 */

import {MODULE_ID, localize} from "./region-common.mjs";
import {
  MAX_WALL_HINT_PRIORITY,
  MAX_WALL_HINT_WIDTH,
  MIN_WALL_HINT_PRIORITY,
  MIN_WALL_HINT_WIDTH,
  WALL_HINT_BLOCKING_TYPES,
  WALL_HINT_LINE_STYLES,
  isDefaultWallLine,
  makeDefaultWallLine,
  normalizeWallLine,
  toWallLineDraft
} from "./wall-hint-lines.mjs";

/** `wallHintLines` 设置键（`settings.mjs` 从这里引用，避免两处字面量漂移）。 */
export const WALL_HINT_LINES_SETTING = "wallHintLines";

/** 编辑器模板路径（随模组目录发布；Foundry 会按 `modules/<id>/...` 直接取）。 */
const TEMPLATE_PATH = `modules/${MODULE_ID}/templates/wall-hint-lines.hbs`;

/** 线型下拉框的本地化键前缀。 */
const STYLE_LOC = "ERQOL.SETTINGS.wallLineStyles";

/* -------------------------------------------------------------------------- */
/*  与 DOM 无关的小工具（也便于 Node 自测）                                        */
/* -------------------------------------------------------------------------- */

/**
 * 把设置值整理成编辑器要显示的草稿数组。
 *
 * - 空数组 / 非法值 → 一条默认线（让用户能直接看到并修改默认值）；
 * - 其它 → 逐条规范化（非法条目用默认线兜底）。
 *
 * @param {*} raw `wallHintLines` 设置值
 * @returns {Array<object>} 草稿数组（`toWallLineDraft` 形状）
 */
export function toEditorDrafts(raw) {
  const list = Array.isArray(raw) ? raw : [];
  if ( !list.length ) return [toWallLineDraft(makeDefaultWallLine())];
  const drafts = [];
  for ( let index = 0; index < list.length; index += 1 ) {
    const line = normalizeWallLine(list[index], index);
    if ( line ) drafts.push(toWallLineDraft(line));
  }
  return drafts.length ? drafts : [toWallLineDraft(makeDefaultWallLine())];
}

/**
 * 把编辑器草稿数组整理成要保存的设置值。
 *
 * 只有一条且等于默认线时保存 `[]`（回到"内置默认"语义），否则保存规范化后的数组。
 *
 * @param {Array<object>} drafts 草稿数组
 * @returns {Array<object>} 要保存的设置值
 */
export function toSettingValue(drafts) {
  const cleaned = (Array.isArray(drafts) ? drafts : []).map(line => toWallLineDraft(line));
  if ( !cleaned.length ) return [];
  if ( (cleaned.length === 1) && isDefaultWallLine(cleaned[0]) ) return [];
  return cleaned;
}

/**
 * 一次性把"草稿"补成模板可直接渲染的形状。
 *
 * @param {object[]} drafts 草稿数组
 * @returns {object[]} 模板行数据
 */
function buildRows(drafts) {
  return drafts.map((draft, index) => {
    const normalized = normalizeWallLine(draft, index) ?? makeDefaultWallLine();
    return {
      index,
      number: index + 1,
      style: normalized.style,
      color: normalized.colorText,
      width: normalized.width,
      priority: normalized.priority,
      styleOptions: WALL_HINT_LINE_STYLES.map(style => ({
        value: style,
        label: localize(`${STYLE_LOC}.${style}`, style),
        selected: style === normalized.style
      })),
      channels: WALL_HINT_BLOCKING_TYPES.map(key => ({
        key,
        label: localize(`ERQOL.SETTINGS.wallHintBlocking.${key}`, key),
        checked: normalized.blocking.includes(key)
      }))
    };
  });
}

/**
 * 从表单 DOM 收集当前编辑中的草稿。
 *
 * 输入框没有 `name`（不参与 `FormData`），一律靠 `data-*` 定位：
 * 这样"新增/删除一行"可以在提交前随时把未保存的修改读回来。
 *
 * @param {HTMLElement} form 表单元素
 * @returns {Array<object>} 草稿数组
 */
function collectDrafts(form) {
  if ( !form?.querySelectorAll ) return [];

  const rows = [...form.querySelectorAll("[data-line-index]")];
  return rows.map(row => {
    const style = row.querySelector('[data-field="style"]')?.value;
    const color = row.querySelector('[data-field="color"]')?.value;
    const width = row.querySelector('[data-field="width"]')?.value;
    const priority = row.querySelector('[data-field="priority"]')?.value;
    const blocking = [...row.querySelectorAll("input[data-channel]")]
      .filter(input => input.checked)
      .map(input => input.dataset.channel);
    return toWallLineDraft({style, color, width, priority, blocking});
  });
}

/* -------------------------------------------------------------------------- */
/*  设置子菜单                                                                   */
/* -------------------------------------------------------------------------- */

const applications = globalThis.foundry?.applications?.api;

/**
 * ApplicationV2 的基类。
 *
 * 当 `foundry.applications.api` 不可用时（Node 自测 / 极旧核心）退化为空类，
 * 这样 `settings.mjs` 仍可被自测加载，只是不会注册菜单。
 */
const ApplicationBase = (applications?.ApplicationV2 && applications?.HandlebarsApplicationMixin)
  ? applications.HandlebarsApplicationMixin(applications.ApplicationV2)
  : class {};

/**
 * 编辑"多条墙体提示线"的 ApplicationV2 子菜单。
 */
export class WallHintLinesConfig extends ApplicationBase {

  /** @inheritDoc */
  static DEFAULT_OPTIONS = {
    id: "erqol-wall-hint-lines",
    tag: "form",
    window: {
      title: "ERQOL.SETTINGS.wallHintLines.name",
      icon: "fa-solid fa-pen-ruler",
      contentClasses: ["standard-form"]
    },
    position: {width: 640, height: 560},
    form: {
      closeOnSubmit: true,
      handler: this.#onSubmit
    },
    actions: {
      addLine: this.#onAddLine,
      deleteLine: this.#onDeleteLine,
      resetLines: this.#onResetLines
    }
  };

  /** @inheritDoc */
  static PARTS = {
    body: {template: TEMPLATE_PATH, root: true},
    footer: {template: "templates/generic/form-footer.hbs"}
  };

  /** 编辑器内未保存的草稿（增删行时用来保留用户的输入）。 */
  _drafts = null;

  /* -------------------------------------------- */

  /** @inheritDoc */
  _prepareContext(_options) {
    const raw = game.settings.get(MODULE_ID, WALL_HINT_LINES_SETTING);
    const drafts = this._drafts ?? toEditorDrafts(raw);
    this._drafts = null;
    return {
      lines: buildRows(drafts),
      buttons: [{
        type: "submit",
        icon: "fa-solid fa-floppy-disk",
        label: "ERQOL.SETTINGS.wallHintLines.save"
      }]
    };
  }

  /* -------------------------------------------- */

  /**
   * 点「添加样式」：把当前表单里的未保存内容读回，追加一条默认线后重绘。
   *
   * @this {WallHintLinesConfig}
   * @returns {Promise<void>}
   */
  static async #onAddLine() {
    const drafts = collectDrafts(this.element);
    drafts.push(toWallLineDraft(makeDefaultWallLine()));
    this._drafts = drafts;
    await this.render();
  }

  /* -------------------------------------------- */

  /**
   * 点某一行的「删除」。
   *
   * @this {WallHintLinesConfig}
   * @param {PointerEvent} _event 事件
   * @param {HTMLElement} target 带 `data-index` 的按钮
   * @returns {Promise<void>}
   */
  static async #onDeleteLine(_event, target) {
    const index = Number(target?.dataset?.index);
    const drafts = collectDrafts(this.element);
    if ( Number.isInteger(index) && (index >= 0) && (index < drafts.length) ) drafts.splice(index, 1);
    this._drafts = drafts.length ? drafts : [toWallLineDraft(makeDefaultWallLine())];
    await this.render();
  }

  /* -------------------------------------------- */

  /**
   * 点「恢复默认」：把编辑内容重置成一条内置默认线。
   *
   * @this {WallHintLinesConfig}
   * @returns {Promise<void>}
   */
  static async #onResetLines() {
    this._drafts = [toWallLineDraft(makeDefaultWallLine())];
    await this.render();
  }

  /* -------------------------------------------- */

  /**
   * 保存：从 DOM 收集草稿 → 规范化 → 写回 `wallHintLines`。
   *
   * `game.settings.set` 会触发核心的 `updateSetting` 钩子，`wall-hint.mjs` 收到后立即重绘。
   *
   * @this {WallHintLinesConfig}
   * @param {SubmitEvent} _event 提交事件
   * @param {HTMLFormElement} form 表单
   * @returns {Promise<void>}
   */
  static async #onSubmit(_event, form) {
    const value = toSettingValue(collectDrafts(form));
    await game.settings.set(MODULE_ID, WALL_HINT_LINES_SETTING, value);
  }
}

/** 供设置面板与自测使用的边界值快照。 */
export const WALL_HINT_LINE_BOUNDS = Object.freeze({
  minWidth: MIN_WALL_HINT_WIDTH,
  maxWidth: MAX_WALL_HINT_WIDTH,
  minPriority: MIN_WALL_HINT_PRIORITY,
  maxPriority: MAX_WALL_HINT_PRIORITY
});
