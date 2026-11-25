/* TODO State: cycle task checkboxes and stamp start/done times, matching the author's Neovim
   (obsidian.nvim) setup.
   - Clicking a checkbox (Live Preview, Reading view) or running the command cycles [ ] -> [~] -> [x] -> [-] -> [ ]
   - Switching to [~] appends "<in-progress mark> <time>", switching to [x] appends "<done mark> <time>"
     (not added again if the mark already has a time)
   - Times are never removed automatically, so a misclick never loses a record. Remove them by hand to redo
   - The marks, the time format and click interception are configurable. Defaults match the Neovim setup
   Written in plain JavaScript (CommonJS) so that it runs without a build step. */
const { Plugin, PluginSettingTab, Setting, MarkdownView, Notice, moment } = require("obsidian");
const { EditorView } = require("@codemirror/view");

const ORDER = [" ", "~", "x", "-"];
const TASK = /^(\s*(?:[-*+]|\d+[.)]) \[)(.)(\])/;

const PRESETS = {
  nerd: { name: "Nerd Font (󱓞 / 󰈼)", inProgress: "󱓞", done: "󰈼" },
  emoji: { name: "Emoji (🛫 / ✅)", inProgress: "🛫", done: "✅" },
};

const DEFAULT_SETTINGS = {
  stampInProgress: PRESETS.nerd.inProgress,
  stampDone: PRESETS.nerd.done,
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
    - If the mark is missing, append "mark time" to the end of the line */
function stamp(line, mark, format) {
  const time = moment().format(format);
  let orphan = -1;
  for (let i = line.indexOf(mark); i !== -1; i = line.indexOf(mark, i + mark.length)) {
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
    No time is added for a state whose mark is empty */
function nextLine(line, settings) {
  const m = line.match(TASK);
  if (!m) return null;
  const next = ORDER[(ORDER.indexOf(m[2]) + 1) % ORDER.length];
  const out = m[1] + next + m[3] + line.slice(m[0].length);
  const mark = next === "~" ? settings.stampInProgress : next === "x" ? settings.stampDone : "";
  return mark ? stamp(out, mark, settings.dateFormat || DEFAULT_SETTINGS.dateFormat) : out;
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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

    new Setting(containerEl).setName("Marks").setHeading();

    const presetOf = () =>
      Object.keys(PRESETS).find((k) => PRESETS[k].inProgress === s.stampInProgress && PRESETS[k].done === s.stampDone) ||
      "custom";
    let dropdown;
    new Setting(containerEl)
      .setName("Preset")
      .setDesc("Fills in both marks below. Choose Emoji if you do not have a Nerd Font installed.")
      .addDropdown((d) => {
        for (const [k, p] of Object.entries(PRESETS)) d.addOption(k, p.name);
        d.addOption("custom", "Custom");
        d.setValue(presetOf());
        dropdown = d;
        d.onChange(async (k) => {
          if (!PRESETS[k]) return;
          s.stampInProgress = PRESETS[k].inProgress;
          s.stampDone = PRESETS[k].done;
          await save();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("In progress [~] mark")
      .setDesc("Added before the time when a task becomes [~]. Leave empty to add no time for [~].")
      .addText((t) =>
        t.setValue(s.stampInProgress).onChange(async (v) => {
          s.stampInProgress = v.trim();
          dropdown.setValue(presetOf());
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("Done [x] mark")
      .setDesc("Added before the time when a task becomes [x]. Leave empty to add no time for [x].")
      .addText((t) =>
        t.setValue(s.stampDone).onChange(async (v) => {
          s.stampDone = v.trim();
          dropdown.setValue(presetOf());
          await save();
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
