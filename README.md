# TODO State

Obsidian のチェックボックスを `[ ]` → `[~]` → `[x]` → `[-]` → `[ ]` の順に切り替え、着手・完了の時刻を行末に付けるプラグイン。Neovim（obsidian.nvim）側の設定と同じ動きにするために作った。

- クリック（Live Preview・Reading）と、コマンド「TODO State: Cycle checkbox state」で切り替える
- `[~]` にすると `󱓞 YYYY-MM-DD HH:mm`、`[x]` にすると `󰈼 YYYY-MM-DD HH:mm` を行末に付ける（同じ印が既にあれば付けない）
- 時刻は自動では消さない

アイコンは Nerd Font の文字なので、表示には Nerd Font が要る。

## インストール

[BRAT](https://github.com/TfTHacker/obsidian42-brat) で `isseii10/obsidian-todo-state` を追加する。

## リリース

`manifest.json` の `version` を上げ、同じ名前のタグでリリースを作り、`main.js` と `manifest.json` を添付する。

```sh
gh release create X.Y.Z main.js manifest.json --title X.Y.Z --notes "..."
```
