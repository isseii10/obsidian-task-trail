/* TODO State: チェックボックスの状態の切り替えと時刻の付与を、Neovim（dotfiles の
   nvim/lua/user/extras/obsidian.lua）と同じ動きにする。
   - クリック（Live Preview・Reading）とコマンドで [ ]→[~]→[x]→[-]→[ ] の順に切り替える
   - [~] にしたら「󱓞 YYYY-MM-DD HH:mm」、[x] にしたら「󰈼 YYYY-MM-DD HH:mm」を行末に付ける（既にあれば付けない）
   - 時刻は自動では消さない（誤操作で記録を失わないため。やり直すときは手で消す）
   ビルドなしで動くように、素の JavaScript（CommonJS）で書いている。 */
const { Plugin, MarkdownView, Notice, moment } = require("obsidian");
const { EditorView } = require("@codemirror/view");

const ORDER = [" ", "~", "x", "-"];
const STAMP = { "~": "󱓞", x: "󰈼" };
const TASK = /^(\s*(?:[-*+]|\d+[.)]) \[)(.)(\])/;

/** 1行を次の状態にした行を返す。タスク行でなければ null */
function nextLine(line) {
  const m = line.match(TASK);
  if (!m) return null;
  const next = ORDER[(ORDER.indexOf(m[2]) + 1) % ORDER.length];
  let out = m[1] + next + m[3] + line.slice(m[0].length);
  const mark = STAMP[next];
  if (mark && !out.includes(mark)) {
    out += " " + mark + " " + moment().format("YYYY-MM-DD HH:mm");
  }
  return out;
}

module.exports = class TodoStatePlugin extends Plugin {
  onload() {
    // Reading view のチェックボックス → 描画元（セクション）を覚えておき、クリック時に行番号を出す
    this.reading = new WeakMap();
    this.registerMarkdownPostProcessor((el, ctx) => {
      el.querySelectorAll("input.task-list-item-checkbox").forEach((input) => {
        this.reading.set(input, { el, ctx });
      });
    });

    // 本体の切り替え（[ ]⇔[x]）より先に拾って止める。本体が mousedown で切り替える場合に備えて両方止める
    const onCheckbox = (evt) => {
      const target = evt.target;
      if (!(target instanceof HTMLInputElement) || !target.matches("input.task-list-item-checkbox")) return;
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
          const updated = nextLine(editor.getLine(n));
          if (updated !== null) editor.setLine(n, updated);
        }
      },
    });
  }

  cycleFromCheckbox(input) {
    // Live Preview / Source: CodeMirror から行を取る
    const cm = EditorView.findFromDOM(input);
    if (cm) {
      const line = cm.state.doc.lineAt(cm.posAtDOM(input));
      const updated = nextLine(line.text);
      if (updated !== null) cm.dispatch({ changes: { from: line.from, to: line.to, insert: updated } });
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
      const updated = n < lines.length ? nextLine(lines[n]) : null;
      if (updated === null) return text;
      lines[n] = updated;
      return lines.join("\n");
    });
  }
};
