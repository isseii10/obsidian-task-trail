// @ts-check
/* Task Trail: cycle task checkboxes and stamp times.
   - Clicking a checkbox (Live Preview, Reading view) or running the command moves the task to the next state
     in the cycle. By default: [ ] -> [~] -> [x] -> [-] -> [ ]
   - A state can have a mark: switching to it appends "<mark> <time>" (not added again if the mark already
     has a time). By default [~] has 🛫 and [x] has ✅
   - Times are not removed automatically by default, so a misclick never loses a record. Optionally, they are
     removed when a task goes back to [ ]
   - The states and their order, the marks, the time format and click interception are configurable
   Written in plain JavaScript (CommonJS) so that it runs without a build step: this file is what gets released
   and copied into a vault. It is type-checked with TypeScript through JSDoc (see tsconfig.json) instead.
   Compatibility: minAppVersion is 1.4.0. Every Obsidian API used here exists in 1.4.0, checked against the
   @since tags in obsidian.d.ts; APIs added later are avoided (see getAbstractFileByPath below). The plugin
   also runs on mobile (isDesktopOnly: false), where there is no Node, so no Node API is used. */
const { Plugin, PluginSettingTab, Setting, MarkdownView, Notice, TFile, moment: obsidianMoment } = require("obsidian");
const { EditorView } = require("@codemirror/view");

// obsidian.d.ts types `moment` as the module namespace, which is not callable under TypeScript's module
// interop. At runtime it is the moment function itself
const moment = /** @type {typeof import("moment")} */ (/** @type {unknown} */ (obsidianMoment));

/** @typedef {{ symbol: string, mark: string }} State A checkbox state: the character between the brackets,
    and the mark added with the time when a task switches to it ("" = no time) */
/** @typedef {{ states: State[], dateFormat: string, clearOnUncheck: boolean,
    interceptLivePreview: boolean, interceptReading: boolean, checkboxStyles: boolean }} Settings */

// The class on <body> that turns on styles.css, so that the styles can be switched off from the settings
const STYLES_CLASS = "task-trail-checkboxes";

// `u` so that a state can be any single character, including ones outside the BMP
const TASK = /^(\s*(?:[-*+]|\d+[.)]) \[)(.)(\])/u;

/** @type {Settings} */
const DEFAULT_SETTINGS = {
  // The cycle, in order. `mark` is added with the time when a task switches to that state ("" = no time).
  // 🛫 and ✅ are the same emoji as the Tasks plugin's start and done dates
  states: [
    { symbol: " ", mark: "" },
    { symbol: "~", mark: "🛫" },
    { symbol: "x", mark: "✅" },
    { symbol: "-", mark: "" },
  ],
  dateFormat: "YYYY-MM-DD HH:mm",
  clearOnUncheck: false,
  interceptLivePreview: true,
  interceptReading: true,
  // Draw each state differently (styles.css). Off by default: these rules are more specific than most themes
  // and CSS snippets, so turning them on silently overrides a user's own styling of the same states
  checkboxStyles: false,
};

/** Length of the time at the start of `rest` (the text after a mark, leading whitespace already skipped),
    or 0 if it does not start with a time. The longest prefix that parses with the format counts. Failing
    that, a run of digit groups (digits and - / . :, separated by spaces) counts, so that times written in an
    earlier format, and incomplete ones, are recognized as a whole
    @param {string} rest
    @param {string} format
    @returns {number} */
function timeLength(rest, format) {
  for (let k = Math.min(rest.length, 64); k > 0; k--) {
    if (moment(rest.slice(0, k), format, true).isValid()) return k;
  }
  const m = rest.match(/^\d[\d\-\/.:]*(?:[ \t]+\d[\d\-\/.:]*)*/);
  return m ? m[0].length : 0;
}

/** Remove every "mark time" of the given marks from `from` on. A mark not followed by a time is left alone,
    since it may be ordinary text. Known limitation: after a time in an earlier format, a following number
    is taken as part of the time ("12/31 10:00 3 items" -> "items"), since timeLength cannot tell where such
    a time ends
    @param {string} line
    @param {string[]} marks
    @param {string} format
    @param {number} from
    @returns {string} */
function clearStamps(line, marks, format, from) {
  for (const mark of new Set(marks.filter(Boolean))) {
    let i = line.indexOf(mark, from);
    while (i !== -1) {
      const after = line.slice(i + mark.length);
      const rest = after.replace(/^\s+/, "");
      const len = timeLength(rest, format);
      if (len === 0) {
        i = line.indexOf(mark, i + mark.length);
        continue;
      }
      let start = i;
      while (start > from && /\s/.test(line[start - 1])) start--;
      const end = i + mark.length + (after.length - rest.length) + len;
      line = `${line.slice(0, start)}${line.slice(end)}`;
      i = line.indexOf(mark, Math.max(start, from));
    }
  }
  return line;
}

/** Add "mark time" to a line.
    - If the mark is followed by a time, it is already stamped: leave the line as is. This includes an
      incomplete time (e.g. "2026-01-0"): it cannot be told apart from a time in an earlier format, and
      overwriting would rewrite every old record after a format change, so the user fixes it by hand
    - If only the mark is left (its time was deleted), insert the time right after that mark
    - If the mark is missing, append "mark time" to the end of the line
    Only the text from `from` on (after the checkbox) is searched, so a mark equal to the state symbol is not
    mistaken for one
    @param {string} line
    @param {string} mark
    @param {string} format
    @param {number} from
    @param {import("moment").Moment} now
    @returns {string} */
function stamp(line, mark, format, from, now) {
  const time = now.format(format);
  let orphan = -1;
  for (let i = line.indexOf(mark, from); i !== -1; i = line.indexOf(mark, i + mark.length)) {
    const rest = line.slice(i + mark.length).replace(/^\s+/, "");
    if (timeLength(rest, format) > 0) return line;
    if (orphan === -1) orphan = i;
  }
  if (orphan === -1) return `${line} ${mark} ${time}`;
  const end = orphan + mark.length;
  const rest = line.slice(end).replace(/^\s+/, "");
  return `${line.slice(0, end)} ${time}${rest ? ` ${rest}` : ""}`;
}

/** Return the line switched to the next state, or null if it is not a task line.
    A task whose state is not in the cycle goes to the first state. No time is added for a state whose
    mark is empty. `now` is the time to stamp, so that tests can fix it
    @param {string} line
    @param {Settings} settings
    @param {import("moment").Moment} [now]
    @returns {string | null} */
function nextLine(line, settings, now = moment()) {
  const m = line.match(TASK);
  if (!m) return null;
  const states = settings.states;
  const next = states[(states.findIndex((st) => st.symbol === m[2]) + 1) % states.length];
  const format = settings.dateFormat || DEFAULT_SETTINGS.dateFormat;
  const head = `${m[1]}${next.symbol}${m[3]}`;
  let out = head + line.slice(m[0].length);
  if (next.symbol === " " && settings.clearOnUncheck) {
    out = clearStamps(out, states.map((st) => st.mark), format, head.length);
  }
  return next.mark ? stamp(out, next.mark, format, head.length, now) : out;
}

/* The settings offer states and marks only from these lists, rather than free text. Free text let through
   values that break the plugin: a mark containing digits is mistaken for a time, a mark made of letters
   matches ordinary words (and "Clear times when unchecked" would then delete text), and some characters are
   not rendered as a checkbox by Obsidian. A value already saved outside the lists (e.g. edited in data.json)
   is kept and shown as custom, so an existing setup keeps working. */

/** Characters between the brackets. Only states a task moves through belong in a cycle: to do, in progress,
    done, and the endings cancelled, forwarded (moved to another day) and scheduled (moved to a future date),
    the last two as in Bullet Journal. Markers that say nothing about progress, such as [!] important, [*]
    star or [?] question, are left to themes and other plugins, to keep this plugin about the cycle */
const SYMBOL_OPTIONS = [
  { value: " ", label: "[ ] to do" },
  { value: "x", label: "[x] done" },
  { value: "~", label: "[~] in progress" },
  { value: "/", label: "[/] in progress" },
  { value: "-", label: "[-] cancelled" },
  { value: ">", label: "[>] forwarded" },
  { value: "<", label: "[<] scheduled" },
];

/** Marks, from the Tasks plugin's date emoji. Only those that mean "this happened at this time" fit a stamp
    added when a state is reached; ➕ created, ⏳ scheduled and 📅 due mean other dates and are left out */
const MARK_OPTIONS = [
  { value: "", label: "No time" },
  { value: "🛫", label: "🛫 start" },
  { value: "✅", label: "✅ done" },
  { value: "❌", label: "❌ cancelled" },
];

/** Whether a state symbol is usable: one character that Obsidian reads as a task, and that cannot break the
    line. Brackets and backslashes would end or escape "[ ]"; whitespace other than the space of "[ ]", control
    and invisible format characters would turn the line into something that is no longer a task
    @param {unknown} symbol */
function isValidSymbol(symbol) {
  if (typeof symbol !== "string" || [...symbol].length !== 1) return false;
  if (symbol === " ") return true;
  return !/[\[\]\\\s\p{Cc}\p{Cf}]/u.test(symbol);
}

/** Whether a mark is usable. Digits would be mistaken for a time (see timeLength), control characters (e.g. a
    newline) would split the line, and surrounding spaces would never match the stamp written back
    @param {unknown} mark */
function isValidMark(mark) {
  return typeof mark === "string" && mark === mark.trim() && !/[\p{Nd}\p{Cc}]/u.test(mark);
}

/** Settings from data.json, checked. The settings UI only offers valid values, but data.json can be edited by
    hand (the way to use a mark outside the lists), so anything invalid is replaced with its default instead of
    being written into notes. Returns the settings and a description of what was ignored
    @param {unknown} raw what loadData returned
    @returns {{ settings: Settings, ignored: string[] }} */
function sanitizeSettings(raw) {
  /** @type {Record<string, any>} */
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
  /** @type {string[]} */
  const ignored = [];
  // 0.2.0 development builds stored the [~] and [x] marks separately
  if (!data.states && ("stampInProgress" in data || "stampDone" in data)) {
    data.states = DEFAULT_SETTINGS.states.map((st) => ({ ...st }));
    if ("stampInProgress" in data) data.states[1].mark = data.stampInProgress;
    if ("stampDone" in data) data.states[2].mark = data.stampDone;
  }

  /** @type {State[]} */
  let states = [];
  if (Array.isArray(data.states)) {
    for (const st of data.states) {
      const ok =
        st &&
        typeof st === "object" &&
        isValidSymbol(st.symbol) &&
        isValidMark(st.mark) &&
        !states.some((o) => o.symbol === st.symbol);
      if (ok) states.push({ symbol: st.symbol, mark: st.mark });
      else ignored.push(`state ${JSON.stringify(st)}`);
    }
  } else if (data.states !== undefined) {
    ignored.push("states (not a list)");
  }
  if (states.length < 2) {
    if (data.states !== undefined) ignored.push("states (fewer than two valid states; using the default)");
    states = DEFAULT_SETTINGS.states.map((st) => ({ ...st }));
  }

  let dateFormat = DEFAULT_SETTINGS.dateFormat;
  if (typeof data.dateFormat === "string" && data.dateFormat.trim() && !/\p{Cc}/u.test(data.dateFormat)) {
    dateFormat = data.dateFormat;
  } else if (data.dateFormat !== undefined) {
    ignored.push("dateFormat");
  }

  /** @param {"clearOnUncheck" | "interceptLivePreview" | "interceptReading" | "checkboxStyles"} key */
  const flag = (key) => {
    if (typeof data[key] === "boolean") return data[key];
    if (data[key] !== undefined) ignored.push(key);
    return DEFAULT_SETTINGS[key];
  };

  return {
    settings: {
      states,
      dateFormat,
      clearOnUncheck: flag("clearOnUncheck"),
      interceptLivePreview: flag("interceptLivePreview"),
      interceptReading: flag("interceptReading"),
      checkboxStyles: flag("checkboxStyles"),
    },
    ignored,
  };
}

class TaskTrailPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.applyStyles();
    this.addSettingTab(new TaskTrailSettingTab(this.app, this));

    // Remember which rendered section each Reading view checkbox belongs to, to find its line on click
    /** @type {WeakMap<Element, { el: HTMLElement, ctx: import("obsidian").MarkdownPostProcessorContext }>} */
    this.reading = new WeakMap();
    this.registerMarkdownPostProcessor((el, ctx) => {
      el.querySelectorAll("input.task-list-item-checkbox").forEach((input) => {
        this.reading.set(input, { el, ctx });
      });
    });

    // Catch the event before Obsidian's own toggle ([ ] <-> [x]) and stop it. Stop mousedown too, in case
    // Obsidian toggles on mousedown. Where interception is turned off, do nothing and leave the click to
    // Obsidian (and other plugins)
    /** @param {MouseEvent} evt */
    const onCheckbox = (evt) => {
      const target = evt.target;
      if (!(target instanceof HTMLInputElement) || !target.matches("input.task-list-item-checkbox")) return;
      // Leave checkboxes inside an embedded note (![[note]]) to Obsidian. Their line numbers are relative to the
      // embedded note, but the line lookup below resolves them against the note being viewed: in Reading view a
      // click rewrote an unrelated task of the host note, and in Live Preview it did nothing at all
      if (target.closest(".internal-embed, .markdown-embed")) return;
      // Live Preview checkboxes are inside CodeMirror; everything else is Reading view
      const inEditor = !!target.closest(".cm-editor");
      if (inEditor ? !this.settings.interceptLivePreview : !this.settings.interceptReading) return;
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();
      if (evt.type === "click") this.cycleFromCheckbox(target);
    };
    this.registerDomEvent(document, "mousedown", onCheckbox, { capture: true });
    this.registerDomEvent(document, "click", onCheckbox, { capture: true });

    this.addCommand({
      id: "cycle",
      name: "Cycle checkbox state",
      editorCallback: (editor) => {
        const lines = new Set();
        for (const sel of editor.listSelections()) {
          const [a, b] = [sel.anchor.line, sel.head.line].sort((x, y) => x - y);
          for (let n = a; n <= b; n++) lines.add(n);
        }
        for (const n of lines) {
          const updated = nextLine(editor.getLine(n), this.settings);
          if (updated !== null) editor.setLine(n, updated);
        }
      },
    });
  }

  async loadSettings() {
    const raw = await this.loadData();
    const { settings, ignored } = sanitizeSettings(raw);
    /** @type {Settings} */
    this.settings = settings;
    if (ignored.length > 0) {
      new Notice(`Task Trail: ignored invalid settings in data.json: ${ignored.join(", ")}`, 0);
    }
    // Write back only the 0.2.0 development format, so that data.json is not rewritten behind the user's back
    // when it only has invalid values (they stay in the file to be fixed by hand)
    if (raw && typeof raw === "object" && ("stampInProgress" in raw || "stampDone" in raw)) {
      await this.saveSettings();
    }
  }

  onunload() {
    document.body.classList.remove(STYLES_CLASS);
  }

  applyStyles() {
    document.body.classList.toggle(STYLES_CLASS, this.settings.checkboxStyles);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** @param {HTMLInputElement} input */
  cycleFromCheckbox(input) {
    // Live Preview: get the line from CodeMirror. findFromDOM only finds the editor from its outer element
    // (.cm-editor), so walk up from the checkbox
    // (closest() is typed as Element, but these are always HTMLElements)
    const editorEl = /** @type {HTMLElement | null} */ (input.closest(".cm-editor"));
    const cm = editorEl ? EditorView.findFromDOM(editorEl) : null;
    if (cm) {
      const line = cm.state.doc.lineAt(cm.posAtDOM(input));
      const updated = nextLine(line.text, this.settings);
      if (updated === null) return;
      cm.dispatch({ changes: { from: line.from, to: line.to, insert: updated } });
      // Because the click was preventDefault-ed, the browser restores `checked` to its pre-click value
      // after this handler. Obsidian may reuse the same input, which would then keep the stale value and
      // break :checked styling, so set it to match the new state once the browser is done
      const checked = updated.match(TASK)?.[2] !== " ";
      setTimeout(() => {
        if (input.isConnected) input.checked = checked;
      });
      return;
    }

    // Reading view: the file line is the section's first line plus the li's data-line
    const entry = this.reading.get(input);
    const li = /** @type {HTMLElement | null} */ (input.closest("li[data-line]"));
    const info = entry?.ctx.getSectionInfo(entry.el);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    // getAbstractFileByPath rather than getFileByPath, which needs Obsidian 1.5.7 (minAppVersion is 1.4.0)
    const source = entry ? this.app.vault.getAbstractFileByPath(entry.ctx.sourcePath) : null;
    const file = view?.file ?? (source instanceof TFile ? source : null);
    if (!li || !info || !file) {
      new Notice("Task Trail: cannot toggle the checkbox at this position");
      return;
    }
    const n = info.lineStart + Number(li.dataset.line);
    this.app.vault.process(file, (text) => {
      const lines = text.split("\n");
      const updated = n < lines.length ? nextLine(lines[n], this.settings) : null;
      if (updated === null) return text;
      lines[n] = updated;
      return lines.join("\n");
    });
  }
}

class TaskTrailSettingTab extends PluginSettingTab {
  /**
   * @param {import("obsidian").App} app
   * @param {TaskTrailPlugin} plugin
   */
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    containerEl.empty();

    // Draw the mark dropdowns in the same font as notes, so marks that rely on a font set up for notes
    // (theme, CSS snippet) look the same here instead of showing as boxes in the settings UI font
    const noteEl = document.querySelector(".markdown-source-view.mod-cm6 .cm-scroller, .markdown-rendered");
    const markFont = noteEl ? getComputedStyle(noteEl).fontFamily : "var(--font-text)";

    new Setting(containerEl)
      .setName("States")
      .setDesc(
        "Clicking a checkbox moves the task to the next state in this list, and from the last back to the first. " +
          "A task in a state not listed goes to the first one. The mark is added with the time when a task switches " +
          "to that state; choose No time to add none.",
      )
      .setHeading();

    const states = s.states;
    /** Fill a dropdown from a list. Values taken by another state are disabled, and a saved value outside the
        list is kept as a custom option
        @param {import("obsidian").DropdownComponent} d
        @param {{ value: string, label: string }[]} options
        @param {string} current
        @param {(value: string) => boolean} taken */
    const addOptions = (d, options, current, taken) => {
      if (!options.some((o) => o.value === current)) d.addOption(current, `${current} (custom)`);
      for (const o of options) d.addOption(o.value, o.label);
      for (const el of Array.from(d.selectEl.options)) el.disabled = el.value !== current && taken(el.value);
      d.setValue(current);
    };
    /** @param {number} from @param {number} to */
    const move = async (from, to) => {
      states.splice(to, 0, states.splice(from, 1)[0]);
      await save();
      this.display();
    };
    states.forEach((st, i) => {
      const row = new Setting(containerEl).setName(`State ${i + 1}`);
      row.addDropdown((d) => {
        addOptions(d, SYMBOL_OPTIONS, st.symbol, (v) => states.some((o, j) => j !== i && o.symbol === v));
        d.selectEl.title = "Character between the brackets";
        d.onChange(async (v) => {
          st.symbol = v;
          await save();
          this.display();
        });
      });
      row.addDropdown((d) => {
        // A mark used by two states would make one state's time count as the other's
        addOptions(d, MARK_OPTIONS, st.mark, (v) => v !== "" && states.some((o, j) => j !== i && o.mark === v));
        d.selectEl.style.fontFamily = markFont;
        d.selectEl.title = "Mark added with the time when a task switches to this state";
        d.onChange(async (v) => {
          st.mark = v;
          await save();
          this.display();
        });
      });
      row.addExtraButton((b) =>
        b
          .setIcon("arrow-up")
          .setTooltip("Move up")
          .setDisabled(i === 0)
          .onClick(() => i > 0 && move(i, i - 1)),
      );
      row.addExtraButton((b) =>
        b
          .setIcon("arrow-down")
          .setTooltip("Move down")
          .setDisabled(i === states.length - 1)
          .onClick(() => i < states.length - 1 && move(i, i + 1)),
      );
      row.addExtraButton((b) =>
        b
          .setIcon("trash")
          .setTooltip(states.length <= 2 ? "The cycle needs at least two states" : "Remove")
          .setDisabled(states.length <= 2)
          .onClick(async () => {
            if (states.length <= 2) return;
            states.splice(i, 1);
            await save();
            this.display();
          }),
      );
    });

    new Setting(containerEl)
      .addButton((b) =>
        b
          .setButtonText("Add state")
          .setDisabled(SYMBOL_OPTIONS.every((o) => states.some((st) => st.symbol === o.value)))
          .onClick(async () => {
            // The first symbol not in use, so the new row is valid right away; the user can change it
            const free = SYMBOL_OPTIONS.find((o) => !states.some((st) => st.symbol === o.value));
            if (!free) return;
            states.push({ symbol: free.value, mark: "" });
            await save();
            this.display();
          }),
      )
      .addButton((b) =>
        b.setButtonText("Reset to default").onClick(async () => {
          s.states = DEFAULT_SETTINGS.states.map((st) => ({ ...st }));
          await save();
          this.display();
        }),
      );

    new Setting(containerEl).setName("Time").setHeading();

    const fmt = new Setting(containerEl).setName("Time format");
    const preview = () => {
      fmt.setDesc("A moment.js format. Current time: " + moment().format(s.dateFormat || DEFAULT_SETTINGS.dateFormat));
    };
    fmt.addMomentFormat((m) =>
      m
        .setDefaultFormat(DEFAULT_SETTINGS.dateFormat)
        .setValue(s.dateFormat)
        .onChange(async (v) => {
          // Same rule as sanitizeSettings: a control character would split the line
          s.dateFormat = v.trim() && !/\p{Cc}/u.test(v) ? v.trim() : DEFAULT_SETTINGS.dateFormat;
          preview();
          await save();
        }),
    );
    preview();

    new Setting(containerEl)
      .setName("Clear times when unchecked")
      .setDesc(
        "When a task goes back to [ ], remove the times added with the marks above. Off by default, so that a " +
          "misclick never loses a record. A mark not followed by a time is left alone.",
      )
      .addToggle((t) =>
        t.setValue(s.clearOnUncheck).onChange(async (v) => {
          s.clearOnUncheck = v;
          await save();
        }),
      );

    new Setting(containerEl).setName("Appearance").setHeading();

    new Setting(containerEl)
      .setName("Checkbox styles")
      .setDesc(
        "Draw each state differently (in progress, cancelled, forwarded...). Obsidian alone draws every state " +
          "other than [ ] as done. Leave off if your theme or a CSS snippet already styles these states, since " +
          "these styles would override it.",
      )
      .addToggle((t) =>
        t.setValue(s.checkboxStyles).onChange(async (v) => {
          s.checkboxStyles = v;
          this.plugin.applyStyles();
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("Checkbox clicks")
      .setDesc(
        "Where this is off, clicks get Obsidian's default behavior (or another plugin's, such as Tasks). The command always works.",
      )
      .setHeading();

    new Setting(containerEl)
      .setName("Live Preview")
      .setDesc("Cycle the state when a checkbox is clicked in Live Preview.")
      .addToggle((t) =>
        t.setValue(s.interceptLivePreview).onChange(async (v) => {
          s.interceptLivePreview = v;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("Reading view")
      .setDesc("Cycle the state when a checkbox is clicked in Reading view.")
      .addToggle((t) =>
        t.setValue(s.interceptReading).onChange(async (v) => {
          s.interceptReading = v;
          await save();
        }),
      );
  }
}

// `internals`: the line-editing functions, for the tests (test/). Obsidian only uses the class itself
module.exports = Object.assign(TaskTrailPlugin, {
  internals: { nextLine, stamp, clearStamps, timeLength, sanitizeSettings, DEFAULT_SETTINGS },
});
