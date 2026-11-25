# TODO State

An Obsidian plugin that cycles task checkboxes through `[ ]` → `[~]` → `[x]` → `[-]` → `[ ]` and stamps start and done times at the end of the line. It was made to match the author's Neovim (obsidian.nvim) setup.

- Cycle by clicking a checkbox (Live Preview and Reading view) or with the command "TODO State: Cycle checkbox state"
- Switching to `[~]` appends `󱓞 YYYY-MM-DD HH:mm`, and switching to `[x]` appends `󰈼 YYYY-MM-DD HH:mm`
  - If the mark is already followed by a time, nothing is added, so cycling repeatedly never adds duplicates
  - If only the mark is left (its time was deleted), the time is inserted right after that mark
- Times are never removed automatically. To redo one, delete the mark together with its time (if you delete only the mark and keep the time, a new "mark time" is appended and you end up with two times)

The default marks are Nerd Font glyphs and show up as boxes (tofu) without a Nerd Font. In that case, switch to emoji or other marks in the settings.

## Settings

Open Settings → Community plugins → TODO State. The defaults give the behavior described above.

| Setting | Default | Description |
| --- | --- | --- |
| Preset | Nerd Font | Sets both marks at once: Nerd Font (`󱓞` / `󰈼`) or Emoji (`🛫` / `✅`). Editing a mark by hand switches this to "Custom" |
| In progress `[~]` mark | `󱓞` | Added before the time when a task becomes `[~]`. Leave empty to add no time for `[~]` |
| Done `[x]` mark | `󰈼` | Added before the time when a task becomes `[x]`. Leave empty to add no time for `[x]` |
| Time format | `YYYY-MM-DD HH:mm` | A [moment.js format](https://momentjs.com/docs/#/displaying/format/). Empty resets it to the default |
| Checkbox clicks: Live Preview | On | When off, clicking a checkbox in Live Preview gets Obsidian's default behavior (or another plugin's, such as Tasks) |
| Checkbox clicks: Reading view | On | The same for Reading view |

- Whether a line already has a time is checked using the configured marks: a mark counts as stamped when the text after it (ignoring spaces) starts with a digit or parses with the configured format. Because anything starting with a digit counts, changing the format does not add a second time to lines stamped in the old format
- After changing a mark, lines that only have the old mark get a new stamp with the new mark
- The command "Cycle checkbox state" works even with checkbox clicks turned off (assigning it a hotkey is handy)
- Checkbox clicks are handled by stopping `mousedown` / `click` on `document` in the capture phase, so they conflict with other plugins that handle checkbox clicks, such as Tasks. Turn them off when using such a plugin

## Installation

Add `isseii10/obsidian-todo-state` in [BRAT](https://github.com/TfTHacker/obsidian42-brat).

## Releasing

Bump `version` in `manifest.json`, create a release with a tag of the same name, and attach `main.js` and `manifest.json`.

```sh
gh release create X.Y.Z main.js manifest.json --title X.Y.Z --notes "..."
```
