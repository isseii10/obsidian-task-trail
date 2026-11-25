# TODO State

Obsidian のチェックボックスを `[ ]` → `[~]` → `[x]` → `[-]` → `[ ]` の順に切り替え、着手・完了の時刻を行末に付けるプラグイン。Neovim（obsidian.nvim）側の設定と同じ動きにするために作った。

- クリック（Live Preview・Reading）と、コマンド「TODO State: Cycle checkbox state」で切り替える
- `[~]` にすると `󱓞 YYYY-MM-DD HH:mm`、`[x]` にすると `󰈼 YYYY-MM-DD HH:mm` を行末に付ける
  - 印の後に時刻があれば付けない（何度切り替えても増えない）
  - 印だけ残っていれば（時刻を消した）、その印のすぐ後に時刻を補う
- 時刻は自動では消さない。やり直すときは印ごと消す（時刻だけ残して印を消すと、新しい「印 時刻」が行末に付き、時刻が2つ並ぶ）

デフォルトの印は Nerd Font の文字なので、Nerd Font がない環境では豆腐（□）になる。その場合は設定で絵文字などに変える。

## 設定

設定 → コミュニティプラグイン → TODO State で変えられる。デフォルトは上に書いた動き（Neovim 側と同じ）。

| 設定 | デフォルト | 説明 |
| --- | --- | --- |
| プリセット | Nerd Font | 印をまとめて選ぶ。Nerd Font（`󱓞` / `󰈼`）か絵文字（`🛫` / `✅`）。下の印を手で変えると「カスタム」になる |
| 着手 `[~]` の印 | `󱓞` | `[~]` にしたとき時刻の前に付ける文字。空にすると `[~]` では時刻を付けない |
| 完了 `[x]` の印 | `󰈼` | `[x]` にしたとき時刻の前に付ける文字。空にすると `[x]` では時刻を付けない |
| 時刻の書式 | `YYYY-MM-DD HH:mm` | [moment.js の書式](https://momentjs.com/docs/#/displaying/format/)。空にするとデフォルトに戻る |
| クリックの横取り: Live Preview | オン | オフにすると、Live Preview のチェックボックスのクリックは本体（や Tasks など他のプラグイン）の標準動作になる |
| クリックの横取り: Reading | オン | 同じく Reading view 用 |

- 「時刻が付いているか」の判定は、設定した印で行う。印の後（空白は飛ばす）が数字で始まるか、設定した書式として読めれば「付いている」とみなす。数字で始まれば付いているとみなすので、書式を変えても前の書式の時刻に二重には付かない
- 印を変えると、前の印が付いた行にも新しい印で時刻が付く
- クリックの横取りをオフにしても、コマンド「Cycle checkbox state」はいつでも使える（ホットキーを割り当てると便利）
- クリックの横取りは `document` の `mousedown` / `click` を capture で止めて行うので、Tasks などチェックボックスのクリックを扱う他のプラグインとはぶつかる。併用するときはオフにする

## インストール

[BRAT](https://github.com/TfTHacker/obsidian42-brat) で `isseii10/obsidian-todo-state` を追加する。

## リリース

`manifest.json` の `version` を上げ、同じ名前のタグでリリースを作り、`main.js` と `manifest.json` を添付する。

```sh
gh release create X.Y.Z main.js manifest.json --title X.Y.Z --notes "..."
```
