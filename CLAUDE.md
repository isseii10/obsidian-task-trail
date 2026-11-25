# Task Trail

`main.js` is released and copied into vaults as-is. There is no build step.

## Code

- **Scope**: before adding a feature, setting or option, check it against the Scope section of README.md. Leave out what does not fit.
- **Language**: keep `main.js` as plain CommonJS with ES2020 syntax, and use no Node APIs. The plugin also runs on mobile, where there is no Node. `tsconfig.json` catches newer built-ins but not newer syntax.
- **Compatibility**: use only Obsidian APIs available at `minAppVersion` (1.4.0). Check each API's `@since` tag in `node_modules/obsidian/obsidian.d.ts`.
- **Comments**: record the reason behind every decision in a code comment, for example "X needs 1.5.7, so Y". The next reader should not have to rediscover it.
- **English**: write all text in the repo in English: settings, notices, comments, README and commit messages. It is a public plugin.
- **Neovim**: the stamping logic (when a mark counts as stamped, filling in a mark left without its time, appending at the end) matches the author's Neovim config (dotfiles: `nvim/lua/user/extras/obsidian.lua`, function `stamp`). When that logic changes, change both.

## Verifying

1. **Line editing** (cycling, stamping, clearing): add the case to `test/cases.json` and see it go red, then fix the code. Run `npm run typecheck` and `npm test`. Node comes from `mise.toml`, so use `mise exec --` if the shell's `node` is a different version.
2. **Clicks, settings UI, anything that needs Obsidian**:
   - Copy `main.js`, `manifest.json` and `styles.css` to the vault's `.obsidian/plugins/task-trail/`. Ask the user for the vault if you do not know it.
   - Run `obsidian plugin:reload id=task-trail`, then drive the app with `obsidian eval`.
   - Put back any note you edit while testing, and confirm it matches what was there before.
   - The author installs releases with BRAT on each device (their vault sync skips `.obsidian/plugins/`), so a test copy stays on this machine, and BRAT's update at startup may replace it with the latest release.
