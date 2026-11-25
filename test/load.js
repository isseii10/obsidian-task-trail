// Load main.js outside Obsidian. "obsidian" and "@codemirror/view" only exist inside the app, so they are
// replaced with stubs; moment is the real one, because the time checks depend on its strict parsing.
// It is 2.31.0 (for GHSA-4p3w-j4w9-5jqw), while Obsidian 1.15.1 bundles 2.30.1. 2.31.0 also changes
// internals such as validity checks, so the cases were also run inside Obsidian with 2.30.1 (all pass).
const Module = require("node:module");
const path = require("node:path");
const moment = require("moment");

const stubs = {
  obsidian: {
    Plugin: class {},
    PluginSettingTab: class {},
    Setting: class {},
    MarkdownView: class {},
    Notice: class {},
    moment,
  },
  "@codemirror/view": { EditorView: {} },
};

const load = Module._load;
Module._load = function (request, ...rest) {
  return request in stubs ? stubs[request] : load.call(this, request, ...rest);
};
const plugin = require(path.join(__dirname, "..", "main.js"));
Module._load = load;

module.exports = { ...plugin.internals, moment };
