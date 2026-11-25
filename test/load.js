// Load main.js outside Obsidian. "obsidian" and "@codemirror/view" only exist inside the app, so they are
// replaced with stubs; moment is the real one, because the time checks depend on its strict parsing.
// It is one version ahead of the one Obsidian 1.15.1 bundles (2.30.1), for a security fix that does not
// touch formatting or parsing.
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
