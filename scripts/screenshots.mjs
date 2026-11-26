// Takes the README screenshots (images/*.png) in a throwaway Obsidian, never the one you use.
//
//   npm run screenshots
//
// Needs macOS with Obsidian in /Applications (or set OBSIDIAN_APP). Your own Obsidian can stay open.
//
// - A second Obsidian is started with its own --user-data-dir, so it has its own vault list, language and
//   window state, and nothing of yours (vaults, settings, plugins, theme) is read or written. It opens a temp
//   vault holding this repo's plugin files and the demo note, and everything is deleted at the end
// - It is driven over the Chrome DevTools Protocol (--remote-debugging-port), as `obsidian eval` would talk to
//   your running Obsidian instead
// - Fixed language (English), theme (Obsidian's default light), zoom (100%) and viewport size, and fixed
//   times in the note, so rerunning the script gives the same images on any machine
// - Uses Node APIs: it is a dev script, not part of the plugin (main.js must not use them, see CLAUDE.md)
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = process.env.OBSIDIAN_APP ?? "/Applications/Obsidian.app";
const port = 9333;
const width = 720; // CSS pixels of each capture's viewport; images are 2x this
const note = "Task Trail demo.md";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The default settings with checkbox styles on, which the README describes and the images should show
const settings = {
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
  checkboxStyles: true,
};

// The default cycle plus [>], with fixed times. The trailing empty line takes the cursor, so Live Preview
// shows no task line as source
const noteText = [
  "- [x] Write the release notes 🛫 2026-11-24 09:12 ✅ 2026-11-24 10:40",
  "- [~] Review the pull request 🛫 2026-11-24 11:05",
  "- [ ] Reply to the issue",
  "- [-] Book the venue 🛫 2026-11-23 14:20",
  "- [>] Move the meeting to Friday",
  "",
].join("\n");

/** Connects to the page whose title starts with `prefix` (each Obsidian window is its own page) */
async function connect(prefix) {
  for (let i = 0; i < 60; i++) {
    const list = await fetch(`http://localhost:${port}/json/list`).then((r) => r.json(), () => []);
    const page = list.find((t) => t.type === "page" && t.title.startsWith(prefix));
    if (page) {
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve);
        ws.addEventListener("error", reject);
      });
      let id = 0;
      const pending = new Map();
      ws.addEventListener("message", (e) => {
        const m = JSON.parse(String(e.data));
        pending.get(m.id)?.(m);
      });
      /** @param {string} method @param {object} [params] */
      const send = (method, params = {}) =>
        new Promise((resolve, reject) => {
          pending.set(++id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
          ws.send(JSON.stringify({ id, method, params }));
        });
      /** Runs `code` (an expression, may be a promise) in the page and returns its value */
      const run = async (code) => {
        const r = await send("Runtime.evaluate", { expression: code, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
      };
      return { send, run, close: () => ws.close() };
    }
    await sleep(500);
  }
  throw new Error(`no Obsidian window titled ${prefix}… on port ${port}`);
}

/** Lays the page out at `width` x `height` CSS pixels at 2x, whatever the window and display, so the images
    keep their size. A tall viewport also fits the whole settings pane, which a window could not, since macOS
    keeps windows within the screen */
async function viewport(page, height) {
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
  await sleep(500);
}

/** Saves the part of the page that `selector` covers, cut at `bottom` (CSS pixels from the top) if given */
async function capture(page, selector, file, bottom) {
  const r = await page.run(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  const clip = { ...r, height: bottom === undefined ? r.height : bottom - r.y, scale: 1 };
  const { data } = await page.send("Page.captureScreenshot", { format: "png", clip });
  await writeFile(join(repo, "images", file), Buffer.from(data, "base64"));
  console.log(`wrote images/${file}`);
}

const tmp = await mkdtemp(join(tmpdir(), "task-trail-screenshots-"));
let main;
try {
  // The temp vault: this repo's plugin, enabled, with the settings above, and the demo note
  const vault = join(tmp, "vault");
  const plugin = join(vault, ".obsidian", "plugins", "task-trail");
  await mkdir(plugin, { recursive: true });
  for (const f of ["main.js", "manifest.json", "styles.css"]) await copyFile(join(repo, f), join(plugin, f));
  await writeFile(join(plugin, "data.json"), JSON.stringify(settings));
  await writeFile(join(vault, ".obsidian", "community-plugins.json"), JSON.stringify(["task-trail"]));
  await writeFile(join(vault, note), noteText);
  // The temp Obsidian's own vault list, with only the temp vault, open, so it starts in it
  const data = join(tmp, "data");
  await mkdir(data);
  await writeFile(join(data, "obsidian.json"), JSON.stringify({ vaults: { "0000000000000001": { path: vault, ts: 1, open: true } } }));
  await mkdir(join(repo, "images"), { recursive: true });

  // open -n starts a second Obsidian next to yours (the app binary alone would act as the CLI instead), and -g
  // keeps it in the background
  await promisify(execFile)("open", ["-n", "-g", "-a", app, "--args", `--user-data-dir=${data}`, `--remote-debugging-port=${port}`]);

  // A fresh Obsidian starts in the system language and in restricted mode (community plugins off). English
  // needs a reload; restricted mode is turned off for this temp instance only
  main = await connect("");
  await main.run(`localStorage.setItem("language", "en"); setTimeout(() => location.reload(), 100); true`);
  main.close();
  await sleep(1000);
  main = await connect("");
  // The time format setting shows the current time, so fix it too (moment.now is moment's hook for that)
  await main.run(`moment.now = () => new Date("2026-11-24T12:00:00").getTime(); true`);
  await main.run(`(async () => {
    await app.plugins.setEnable(true);
    await app.plugins.enablePluginAndSave("task-trail");
    // The "Do you trust the author of this vault?" dialog of a vault opened for the first time; plugins are
    // already on, so close it rather than answer it
    for (const m of document.querySelectorAll(".modal-container")) m.remove();
  })()`);

  // The note in Live Preview, down to the last task and a margin rather than the empty rest of the pane
  await viewport(main, 400);
  await main.run(`(async () => {
    app.workspace.leftSplit.collapse();
    app.workspace.rightSplit.collapse();
    const leaf = app.workspace.getLeaf();
    await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(note)}), { state: { mode: "source", source: false } });
    leaf.view.editor.setCursor({ line: 5, ch: 0 });
  })()`);
  await sleep(800);
  const bottom = await main.run(`(() => {
    const lines = [...document.querySelectorAll(".workspace-leaf.mod-active .cm-line")];
    return lines[lines.length - 2].getBoundingClientRect().bottom + 24;
  })()`);
  await capture(main, ".workspace-leaf.mod-active .view-content", "note.png", bottom);

  // The plugin's settings pane. Since Obsidian 1.15 settings open in a window of their own
  await main.run(`app.setting.open(); app.setting.openTabById("task-trail"); true`);
  const settingsPage = await connect("Settings");
  // Laid out taller than the pane needs, then cut below the last setting
  await viewport(settingsPage, 2000);
  const end = await settingsPage.run(`(() => {
    const items = document.querySelectorAll(".vertical-tab-content .setting-item");
    return items[items.length - 1].getBoundingClientRect().bottom + 24;
  })()`);
  await capture(settingsPage, ".vertical-tab-content", "settings.png", end);
  settingsPage.close();
} finally {
  // Quit the temp Obsidian (all its windows), then delete its data and vault
  await main?.run(`require("@electron/remote").app.quit(); true`).catch(() => {});
  main?.close();
  await sleep(1500);
  await rm(tmp, { recursive: true, force: true });
}
