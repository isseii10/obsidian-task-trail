/* TODO State: チェックボックスの状態の切り替えと時刻の付与を、Neovim（dotfiles の
   nvim/lua/user/extras/obsidian.lua）と同じ動きにする。
   - クリック（Live Preview・Reading）とコマンドで [ ]→[~]→[x]→[-]→[ ] の順に切り替える
   - [~] にしたら「<着手の印> <時刻>」、[x] にしたら「<完了の印> <時刻>」を行末に付ける（同じ印が既にあれば付けない）
   - 時刻は自動では消さない（誤操作で記録を失わないため。やり直すときは手で消す）
   - 印・時刻の書式・クリックの横取りは設定で変えられる。デフォルトは Neovim 側と同じ
   ビルドなしで動くように、素の JavaScript（CommonJS）で書いている。 */
const { Plugin, PluginSettingTab, Setting, MarkdownView, Notice, moment } = require("obsidian");
const { EditorView } = require("@codemirror/view");

const ORDER = [" ", "~", "x", "-"];
const TASK = /^(\s*(?:[-*+]|\d+[.)]) \[)(.)(\])/;

const PRESETS = {
  nerd: { name: "Nerd Font（󱓞 / 󰈼）", inProgress: "󱓞", done: "󰈼" },
  emoji: { name: "絵文字（🛫 / ✅）", inProgress: "🛫", done: "✅" },
};

const DEFAULT_SETTINGS = {
  stampInProgress: PRESETS.nerd.inProgress,
  stampDone: PRESETS.nerd.done,
  dateFormat: "YYYY-MM-DD HH:mm",
  interceptLivePreview: true,
  interceptReading: true,
};

/** 印の後ろ（空白を飛ばした先）が時刻か。数字で始まれば時刻とみなす（書式を変える前の時刻も含めるため）。
    数字で始まらない書式（MMM D など）は、書式どおりに読めるかで見る */
function startsWithTime(rest, format) {
  if (/^\d/.test(rest)) return true;
  for (let k = Math.min(rest.length, 64); k > 0; k--) {
    if (moment(rest.slice(0, k), format, true).isValid()) return true;
  }
  return false;
}

/** 行に「印＋時刻」を付ける。
    - 印の後に時刻があれば、付いているので何もしない
    - 印だけ残っていれば（時刻を消した）、その印のすぐ後に時刻を補う
    - 印がなければ、行末に「印 時刻」を付ける */
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

/** 1行を次の状態にした行を返す。タスク行でなければ null。
    印が空の状態では時刻を付けない */
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

    // Reading view のチェックボックス → 描画元（セクション）を覚えておき、クリック時に行番号を出す
    this.reading = new WeakMap();
    this.registerMarkdownPostProcessor((el, ctx) => {
      el.querySelectorAll("input.task-list-item-checkbox").forEach((input) => {
        this.reading.set(input, { el, ctx });
      });
    });

    // 本体の切り替え（[ ]⇔[x]）より先に拾って止める。本体が mousedown で切り替える場合に備えて両方止める。
    // 設定で横取りをオフにした表示では何もせず、本体（と他のプラグイン）の動作に任せる
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
    // Live Preview / Source: CodeMirror から行を取る。findFromDOM はエディタの外側の要素（.cm-editor）を
    // 渡さないと見つけられないので、チェックボックスから辿る
    const editorEl = input.closest(".cm-editor");
    const cm = editorEl && EditorView.findFromDOM(editorEl);
    if (cm) {
      const line = cm.state.doc.lineAt(cm.posAtDOM(input));
      const updated = nextLine(line.text, this.settings);
      if (updated === null) return;
      cm.dispatch({ changes: { from: line.from, to: line.to, insert: updated } });
      // click を preventDefault したので、ブラウザはこの後で checked をクリック前の値に戻す。
      // Obsidian は同じ input を使い回すことがあり、戻された値のまま残って CSS（:checked）がずれるので、
      // 戻された後で新しい状態に合わせ直す
      const checked = updated.match(TASK)[2] !== " ";
      setTimeout(() => {
        if (input.isConnected) input.checked = checked;
      });
      return;
    }

    // Reading view: セクションの開始行＋ li の data-line で、ファイルの行を出す
    const entry = this.reading.get(input);
    const li = input.closest("li[data-line]");
    const info = entry && entry.ctx.getSectionInfo(entry.el);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = (view && view.file) || (entry && this.app.vault.getFileByPath(entry.ctx.sourcePath));
    if (!li || !info || !file) {
      new Notice("TODO State: この位置のチェックボックスは切り替えられない");
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

    new Setting(containerEl).setName("時刻の印").setHeading();

    const presetOf = () =>
      Object.keys(PRESETS).find((k) => PRESETS[k].inProgress === s.stampInProgress && PRESETS[k].done === s.stampDone) ||
      "custom";
    let dropdown;
    new Setting(containerEl)
      .setName("プリセット")
      .setDesc("選ぶと下の2つの印に入る。Nerd Font がない環境では絵文字にする")
      .addDropdown((d) => {
        for (const [k, p] of Object.entries(PRESETS)) d.addOption(k, p.name);
        d.addOption("custom", "カスタム");
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
      .setName("着手 [~] の印")
      .setDesc("空にすると [~] では時刻を付けない")
      .addText((t) =>
        t.setValue(s.stampInProgress).onChange(async (v) => {
          s.stampInProgress = v.trim();
          dropdown.setValue(presetOf());
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("完了 [x] の印")
      .setDesc("空にすると [x] では時刻を付けない")
      .addText((t) =>
        t.setValue(s.stampDone).onChange(async (v) => {
          s.stampDone = v.trim();
          dropdown.setValue(presetOf());
          await save();
        }),
      );

    new Setting(containerEl).setName("時刻の書式").setHeading();

    const fmt = new Setting(containerEl).setName("書式");
    const preview = () => {
      fmt.setDesc("moment.js の書式。今の時刻だと: " + moment().format(s.dateFormat || DEFAULT_SETTINGS.dateFormat));
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
      .setName("クリックの横取り")
      .setDesc("オフにした表示では、クリックは本体（や Tasks など他のプラグイン）の標準動作になる。コマンドはいつでも使える")
      .setHeading();

    new Setting(containerEl)
      .setName("Live Preview")
      .setDesc("Live Preview のチェックボックスのクリックで状態を切り替える")
      .addToggle((t) =>
        t.setValue(s.interceptLivePreview).onChange(async (v) => {
          s.interceptLivePreview = v;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("Reading")
      .setDesc("Reading view のチェックボックスのクリックで状態を切り替える")
      .addToggle((t) =>
        t.setValue(s.interceptReading).onChange(async (v) => {
          s.interceptReading = v;
          await save();
        }),
      );
  }
}
