const test = require("node:test");
const assert = require("node:assert/strict");
const { nextLine, DEFAULT_SETTINGS, moment } = require("./load");
const { now, cases } = require("./cases.json");

/** Default settings with a case's overrides. `marks` sets the marks of the default states by symbol */
function settingsFor(overrides = {}) {
  const { marks, ...rest } = overrides;
  const states = DEFAULT_SETTINGS.states.map((st) => ({ ...st }));
  for (const [symbol, mark] of Object.entries(marks || {})) {
    states.find((st) => st.symbol === symbol).mark = mark;
  }
  return { ...DEFAULT_SETTINGS, states, ...rest };
}

const fixedNow = moment(now, "YYYY-MM-DD HH:mm");

for (const c of cases) {
  test(c.name, () => {
    assert.equal(nextLine(c.input, settingsFor(c.settings), fixedNow), c.expected);
  });
}

// data.json can be edited by hand, so invalid values must fall back instead of reaching notes
test("sanitizeSettings", async (t) => {
  const { sanitizeSettings } = require("./load");
  const ok = { symbol: " ", mark: "" };
  const symbols = (raw) => sanitizeSettings(raw).settings.states.map((st) => st.symbol);
  const defaults = DEFAULT_SETTINGS.states.map((st) => st.symbol);

  await t.test("nothing saved: defaults, nothing ignored", () => {
    assert.deepEqual(sanitizeSettings(null), { settings: DEFAULT_SETTINGS, ignored: [] });
  });
  await t.test("not an object: defaults", () => {
    assert.deepEqual(symbols("oops"), defaults);
    assert.deepEqual(symbols([1, 2]), defaults);
  });
  await t.test("custom marks outside the lists are kept", () => {
    const raw = { states: [ok, { symbol: "~", mark: "󱓞" }, { symbol: "x", mark: "󰈼" }] };
    const { settings, ignored } = sanitizeSettings(raw);
    assert.deepEqual(settings.states, raw.states);
    assert.deepEqual(ignored, []);
  });
  for (const [name, bad] of [
    ["number symbol", { symbol: 5, mark: "" }],
    ["missing symbol", { mark: "" }],
    ["two-character symbol", { symbol: "ab", mark: "" }],
    ["bracket symbol", { symbol: "]", mark: "" }],
    ["backslash symbol", { symbol: "\\", mark: "" }],
    ["tab symbol", { symbol: "\t", mark: "" }],
    ["zero-width symbol", { symbol: "​", mark: "" }],
    ["number mark", { symbol: "x", mark: 7 }],
    ["mark with digits", { symbol: "x", mark: "v2" }],
    ["mark with a newline", { symbol: "x", mark: "✅\n" }],
    ["mark with surrounding spaces", { symbol: "x", mark: " ✅" }],
    ["null state", null],
    ["duplicate symbol", { symbol: " ", mark: "" }],
  ]) {
    await t.test(`ignores a ${name}`, () => {
      const { settings, ignored } = sanitizeSettings({ states: [ok, { symbol: "~", mark: "" }, bad] });
      assert.deepEqual(settings.states.map((st) => st.symbol), [" ", "~"]);
      assert.equal(ignored.length, 1);
    });
  }
  await t.test("fewer than two valid states: defaults", () => {
    assert.deepEqual(symbols({ states: [ok, { symbol: "ab", mark: "" }] }), defaults);
  });
  await t.test("emoji symbol is fine", () => {
    assert.deepEqual(symbols({ states: [ok, { symbol: "🔥", mark: "" }] }), [" ", "🔥"]);
  });
  await t.test("dateFormat with a control character, and non-boolean flags, fall back", () => {
    const { settings, ignored } = sanitizeSettings({ dateFormat: "YYYY\nMM", clearOnUncheck: "yes" });
    assert.equal(settings.dateFormat, DEFAULT_SETTINGS.dateFormat);
    assert.equal(settings.clearOnUncheck, DEFAULT_SETTINGS.clearOnUncheck);
    assert.deepEqual(ignored, ["dateFormat", "clearOnUncheck"]);
  });
  await t.test("0.2.0 development format is migrated", () => {
    const { settings } = sanitizeSettings({ stampInProgress: "󱓞", stampDone: "󰈼" });
    assert.deepEqual(settings.states.map((st) => st.mark), ["", "󱓞", "󰈼", ""]);
  });
});
