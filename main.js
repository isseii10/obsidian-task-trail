/* TODO State: cycle task checkboxes and stamp times, matching the author's Neovim (obsidian.nvim) setup.
   - Clicking a checkbox (Live Preview, Reading view) or running the command moves the task to the next state
     in the cycle. By default: [ ] -> [~] -> [x] -> [-] -> [ ]
   - A state can have a mark: switching to it appends "<mark> <time>" (not added again if the mark already
     has a time). By default [~] has 🛫 and [x] has ✅
   - Times are never removed automatically, so a misclick never loses a record. Remove them by hand to redo
   - The states and their order, the marks, the time format and click interception are configurable
   Written in plain JavaScript (CommonJS) so that it runs without a build step. */
const { Plugin, PluginSettingTab, Setting, MarkdownView, Notice, moment } = require("obsidian");
const { EditorView } = require("@codemirror/view");

// `u` so that a state can be any single character, including ones outside the BMP
const TASK = /^(\s*(?:[-*+]|\d+[.)]) \[)(.)(\])/u;

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
  interceptLivePreview: true,
  interceptReading: true,
};

/** Whether the text after a mark (leading whitespace already skipped) is a time.
    Anything starting with a digit counts, so times written in an earlier format still count.
    For formats that do not start with a digit (e.g. MMM D), check whether it parses with the format */
function startsWithTime(rest, format) {
  if (/^\d/.test(rest)) return true;
  for (let k = Math.min(rest.length, 64); k > 0; k--) {
    if (moment(rest.slice(0, k), format, true).isValid()) return true;
  }
  return false;
}

/** Add "mark time" to a line.
    - If the mark is followed by a time, it is already stamped: leave the line as is
    - If only the mark is left (its time was deleted), insert the time right after that mark
    - If the mark is missing, append "mark time" to the end of the line
    Only the text from `from` on (after the checkbox) is searched, so a mark equal to the state symbol is not
    mistaken for one */
function stamp(line, mark, format, from) {
  const time = moment().format(format);
  let orphan = -1;
  for (let i = line.indexOf(mark, from); i !== -1; i = line.indexOf(mark, i + mark.length)) {
    const rest = line.slice(i + mark.length).replace(/^\s+/, "");
    if (startsWithTime(rest, format)) return line;
    if (orphan === -1) orphan = i;
  }
  if (orphan === -1) return line + " " + mark + " " + time;
  const end = orphan + mark.length;
  const rest = line.slice(end).replace(/^\s+/, "");
  return line.slice(0, end) + " " + time + (rest ? " " + rest : "");
}

/** Return the line switched to the next state, or null if it is not a task line.
    A task whose state is not in the cycle goes to the first state. No time is added for a state whose
    mark is empty */
function nextLine(line, settings) {
  const m = line.match(TASK);
  if (!m) return null;
  const states = settings.states;
  const next = states[(states.findIndex((st) => st.symbol === m[2]) + 1) % states.length];
  const head = m[1] + next.symbol + m[3];
  const out = head + line.slice(m[0].length);
  return next.mark ? stamp(out, next.mark, settings.dateFormat || DEFAULT_SETTINGS.dateFormat, head.length) : out;
}

/** Why a state symbol cannot be used, or null if it can */
function symbolError(symbol, states, index) {
  if ([...symbol].length !== 1) return "Use exactly one character";
  if (symbol === "[" || symbol === "]") return "Brackets cannot be used";
  if (states.some((st, i) => i !== index && st.symbol === symbol)) return "Already in the cycle";
  return null;
}

module.exports = class TodoStatePlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new TodoStateSettingTab(this.app, this));

    // Remember which rendered section each Reading view checkbox belongs to, to find its line on click
    this.reading = new WeakMap();
    this.registerMarkdownPostProcessor((el, ctx) => {
      el.querySelectorAll("input.task-list-item-checkbox").forEach((input) => {
        this.reading.set(input, { el, ctx });
      });
    });

    // Catch the event before Obsidian's own toggle ([ ] <-> [x]) and stop it. Stop mousedown too, in case
    // Obsidian toggles on mousedown. Where interception is turned off, do nothing and leave the click to
    // Obsidian (and other plugins)
    const onCheckbox = (evt) => {
      const target = evt.target;
      if (!(target instanceof HTMLInputElement) || !target.matches("input.task-list-item-checkbox")) return;
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
    const data = (await this.loadData()) || {};
    // 0.2.0 development builds stored the [~] and [x] marks separately
    const migrated = !data.states && ("stampInProgress" in data || "stampDone" in data);
    if (migrated) {
      data.states = DEFAULT_SETTINGS.states.map((st) => ({ ...st }));
      if ("stampInProgress" in data) data.states[1].mark = data.stampInProgress;
      if ("stampDone" in data) data.states[2].mark = data.stampDone;
    }
    delete data.stampInProgress;
    delete data.stampDone;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    if (!Array.isArray(this.settings.states) || this.settings.states.length < 2) {
      this.settings.states = DEFAULT_SETTINGS.states;
    }
    this.settings.states = this.settings.states.map((st) => ({ ...st }));
    if (migrated) await this.saveSettings();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  cycleFromCheckbox(input) {
    // Live Preview: get the line from CodeMirror. findFromDOM only finds the editor from its outer element
    // (.cm-editor), so walk up from the checkbox
    const editorEl = input.closest(".cm-editor");
    const cm = editorEl && EditorView.findFromDOM(editorEl);
    if (cm) {
      const line = cm.state.doc.lineAt(cm.posAtDOM(input));
      const updated = nextLine(line.text, this.settings);
      if (updated === null) return;
      cm.dispatch({ changes: { from: line.from, to: line.to, insert: updated } });
      // Because the click was preventDefault-ed, the browser restores `checked` to its pre-click value
      // after this handler. Obsidian may reuse the same input, which would then keep the stale value and
      // break :checked styling, so set it to match the new state once the browser is done
      const checked = updated.match(TASK)[2] !== " ";
      setTimeout(() => {
        if (input.isConnected) input.checked = checked;
      });
      return;
    }

    // Reading view: the file line is the section's first line plus the li's data-line
    const entry = this.reading.get(input);
    const li = input.closest("li[data-line]");
    const info = entry && entry.ctx.getSectionInfo(entry.el);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = (view && view.file) || (entry && this.app.vault.getFileByPath(entry.ctx.sourcePath));
    if (!li || !info || !file) {
      new Notice("TODO State: cannot toggle the checkbox at this position");
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
};

class TodoStateSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    containerEl.empty();

    // Draw the mark inputs in the same font as notes, so marks that rely on a font set up for notes
    // (theme, CSS snippet) look the same here instead of showing as boxes in the settings UI font
    const noteEl = document.querySelector(".markdown-source-view.mod-cm6 .cm-scroller, .markdown-rendered");
    const markFont = noteEl ? getComputedStyle(noteEl).fontFamily : "var(--font-text)";

    new Setting(containerEl)
      .setName("States")
      .setDesc(
        "Clicking a checkbox moves the task to the next state in this list, and from the last back to the first. " +
          "A task in a state not listed goes to the first one. The mark is added with the time when a task switches " +
          "to that state; leave it empty to add no time.",
      )
      .setHeading();

    const states = s.states;
    const move = async (from, to) => {
      states.splice(to, 0, states.splice(from, 1)[0]);
      await save();
      this.display();
    };
    states.forEach((st, i) => {
      const row = new Setting(containerEl).setName(`[${st.symbol}]`);
      row.addText((t) => {
        t.setPlaceholder("Space").setValue(st.symbol === " " ? "" : st.symbol);
        t.inputEl.size = 6;
        t.inputEl.title = "Character between the brackets. Leave empty for a space ([ ])";
        t.onChange(async (v) => {
          const symbol = v === "" ? " " : v;
          const error = symbolError(symbol, states, i);
          t.inputEl.style.borderColor = error ? "var(--text-error)" : "";
          t.inputEl.title = error || "Character between the brackets. Leave empty for a space ([ ])";
          if (error) return;
          st.symbol = symbol;
          row.setName(`[${symbol}]`);
          await save();
        });
      });
      row.addText((t) => {
        t.setPlaceholder("No time").setValue(st.mark);
        t.inputEl.style.fontFamily = markFont;
        t.inputEl.size = 8;
        t.inputEl.title = "Mark added with the time when a task switches to this state";
        t.onChange(async (v) => {
          st.mark = v.trim();
          await save();
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
        b.setButtonText("Add state").onClick(async () => {
          // Pick a free symbol so the new row is valid right away; the user can change it
          const symbol = ["/", ">", "<", "?", "!", "*"].find((c) => !states.some((st) => st.symbol === c));
          if (!symbol) return;
          states.push({ symbol, mark: "" });
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
          s.dateFormat = v.trim() || DEFAULT_SETTINGS.dateFormat;
          preview();
          await save();
        }),
    );
    preview();

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
