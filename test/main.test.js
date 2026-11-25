const test = require("node:test");
const assert = require("node:assert/strict");
const { nextLine, symbolError, DEFAULT_SETTINGS, moment } = require("./load");
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

test("symbolError", () => {
  const states = DEFAULT_SETTINGS.states;
  assert.equal(symbolError("?", states, 0), null);
  assert.equal(symbolError("🔥", states, 0), null);
  assert.equal(symbolError("ab", states, 0), "Use exactly one character");
  assert.equal(symbolError("[", states, 0), "Brackets cannot be used");
  assert.equal(symbolError("x", states, 0), "Already in the cycle");
  assert.equal(symbolError("x", states, 2), null, "a state's own symbol is not a duplicate");
});
