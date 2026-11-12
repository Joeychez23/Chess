/*
 *  monitorPrefs.test.js  --  chess frontend tests
 *	The CRT monitor's settings (client/src/js/gameplay/three/monitor/prefs.js): loading, cleaning & saving them.
 *	Run with npm run test:client
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { defaults, clean, loadPrefs, savePrefs } = require("../src/js/gameplay/three/monitor/prefs.js");

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */

// A PLAIN OBJECT STANDING IN FOR localStorage
function fakeStorage(initial = {}) {
	const data = { ...initial };
	return {
		getItem(key) { return Object.hasOwn(data, key) ? data[key] : null; },
		setItem(key, value) { data[key] = String(value); },
	};
}

/* ---------------------------------------------------------------- */
// Tests
/* ---------------------------------------------------------------- */

test("round trip", () => {
	const store = fakeStorage();
	const prefs = { version: 1, defaultChannel: "moves", enabled: ["face", "moves", "setup"], idle: "pipes" };
	assert.equal(savePrefs(prefs, store), true);
	assert.deepEqual(loadPrefs(store), prefs);
});
test("broken JSON, an old version, null and an array fall back to defaults", () => {
	for (const raw of ["{", JSON.stringify({ version: 0, enabled: [] }), "null", "[]"]) {
		assert.deepEqual(loadPrefs(fakeStorage({ MONITOR: raw })), defaults());
	}
});
test("an unknown channel id is dropped, face and setup can't be turned off", () => {
	assert.deepEqual(clean({ version: 1, defaultChannel: "radio", enabled: ["radio", "moves"], idle: "x" }),
		{ version: 1, defaultChannel: null, enabled: ["face", "moves", "setup"], idle: "card" });
});
test("a disabled default channel becomes null", () => {
	assert.equal(clean({ version: 1, defaultChannel: "eval", enabled: ["moves"], idle: "card" }).defaultChannel, null);
});
test("a throwing storage is handled", () => {
	const bad = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
	assert.deepEqual(loadPrefs(bad), defaults());
	assert.equal(savePrefs(defaults(), bad), false);
});
test("a throwing accessor is handled", () => {
	Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("denied"); } });
	assert.deepEqual(loadPrefs(), defaults());
	delete globalThis.localStorage;
});
