# TODO State

An Obsidian plugin that cycles task checkboxes through states (by default `[ ]` → `[~]` → `[x]` → `[-]` → `[ ]`) and stamps start and done times at the end of the line. It was made to match the author's Neovim (obsidian.nvim) setup.

- Cycle by clicking a checkbox (Live Preview and Reading view) or with the command "TODO State: Cycle checkbox state"
- By default, switching to `[~]` appends `🛫 YYYY-MM-DD HH:mm`, and switching to `[x]` appends `✅ YYYY-MM-DD HH:mm` (the same emoji as the start and done dates of the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin)
  - If the mark is already followed by a time, nothing is added, so cycling repeatedly never adds duplicates
  - If only the mark is left (its time was deleted), the time is inserted right after that mark
- By default, times are never removed automatically, so a misclick never loses a record. To redo one, delete the mark together with its time (if you delete only the mark and keep the time, a new "mark time" is appended and you end up with two times). To remove them when a task goes back to `[ ]`, turn on "Clear times when unchecked"

## Settings

Open Settings → Community plugins → TODO State. The defaults give the behavior described above.

| Setting | Default | Description |
| --- | --- | --- |
| States | `[ ]`, `[~]` 🛫, `[x]` ✅, `[-]` | The cycle, in order. Each state has a symbol (the character between the brackets) and a mark (see below), both chosen from a list. Reorder with the arrows, add with "Add state", remove with the trash icon. "Reset to default" restores the default cycle |
| Time format | `YYYY-MM-DD HH:mm` | A [moment.js format](https://momentjs.com/docs/#/displaying/format/). Empty resets it to the default |
| Clear times when unchecked | Off | When a task goes back to `[ ]`, remove every "mark time" added with the configured marks. A mark not followed by a time, and text such as other plugins' dates, is left alone |
| Checkbox styles | Off | Draws each state differently (see below). Leave off if your theme or a CSS snippet already styles these states, since these styles would override it |
| Checkbox clicks: Live Preview | On | When off, clicking a checkbox in Live Preview gets Obsidian's default behavior (or another plugin's, such as Tasks) |
| Checkbox clicks: Reading view | On | The same for Reading view |

- Clicking a checkbox (or running the command) moves the task to the next state in the list, and from the last state back to the first. A task whose symbol is not in the list goes to the first state
- A state's mark is added with the time when a task switches to that state. Choose "No time" to add none
- Symbols: `[ ]` to do, `[x]` done, `[~]` in progress, `[/]` in progress, `[-]` cancelled, `[>]` forwarded, `[<]` scheduled, `[?]` question, `[!]` important, `[*]` star
- Marks: 🛫 start, ✅ done, ❌ cancelled, ➕ created, ⏳ scheduled, 📅 due (the Tasks plugin's date emoji)
- A symbol or mark already used by another state cannot be chosen. The cycle needs at least two states
- The lists keep out values that break the plugin: a mark with digits is mistaken for a time, and a mark made of letters matches ordinary words. A value set outside the lists by editing `data.json` is kept and shown as "(custom)"
- Whether a line already has a time is checked using the configured marks: a mark counts as stamped when the text after it (ignoring spaces) starts with a digit or parses with the configured format. Because anything starting with a digit counts, changing the format does not add a second time to lines stamped in the old format
- After changing a mark, lines that only have the old mark get a new stamp with the new mark
- An incomplete time right after a mark (e.g. `🛫 2026-01-0`) still counts as a time, so no new time is added; fix it by hand. It cannot be told apart from a time in an earlier format, which must not be overwritten. "Clear times when unchecked" removes incomplete times as well
- The command "Cycle checkbox state" works even with checkbox clicks turned off (assigning it a hotkey is handy)
- Checkbox clicks are handled by stopping `mousedown` / `click` on `document` in the capture phase, so they conflict with other plugins that handle checkbox clicks, such as Tasks. Turn them off when using such a plugin

## Checkbox styles

Obsidian draws the checkbox of every state other than `[ ]` like `[x]`, and strikes through only `[x]` lines. Turn on "Checkbox styles" to use `styles.css`:

| State | Checkbox | Text |
| --- | --- | --- |
| `[~]` `[/]` | Left half filled | Normal |
| `[-]` | Grey, minus sign | Struck through, faint |
| `[>]` | Cyan, right arrow | Normal |
| `[<]` | Blue, left arrow | Normal |
| `[?]` | Purple, question mark | Normal |
| `[!]` | Red, exclamation mark | Normal |
| `[*]` | Yellow, star | Normal |

`[x]` and other symbols keep Obsidian's look.

## Installation

Add `isseii10/obsidian-todo-state` in [BRAT](https://github.com/TfTHacker/obsidian42-brat).

## Development

The plugin is `main.js` itself and needs no build. It is type-checked with TypeScript (`// @ts-check` and JSDoc, against the `obsidian` type definitions) without being compiled. The tests check the line editing (cycling, stamping, clearing) with Node's test runner. `test/cases.json` lists the cases as input and expected output.

Use the same Node as Obsidian (24, pinned in `mise.toml`).

```sh
npm install        # dev tools only: moment, typescript and type definitions
npm run typecheck
npm test
```

CI (`.github/workflows/test.yml`) runs the same checks on every push and pull request, and on a tag also checks that the tag matches `manifest.json`'s `version`.

## Releasing

Bump `version` in `manifest.json`, create a release with a tag of the same name, and attach `main.js`, `manifest.json` and `styles.css`.

```sh
gh release create X.Y.Z main.js manifest.json styles.css --title X.Y.Z --notes "..."
```
