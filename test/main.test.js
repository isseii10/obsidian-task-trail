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
