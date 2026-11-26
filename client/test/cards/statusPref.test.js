/*
 *  statusPref.test.js  --  chess frontend tests
 *	The Status display setting (client/src/js/gameplay/cards/statusPref.js): seeding it, applying it at once & when it's saved (a fake clock & a fake fetch).
 *	Run with npm run test:client
 *
 */

const { test, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const statusPref = require("../../src/js/gameplay/cards/statusPref.js");

const FIVE_MIN = 5 * 60 * 1000;
const GAP = FIVE_MIN + 10 * 1000; // THE SERVER'S 5 MINUTES & THE CLIENT'S 10 s MARGIN

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */

// A FAKE fetch THAT KEEPS EVERY CALL'S URL, METHOD & BODY. ITS ANSWERS: ONE STATUS PER CALL (THE LAST REPEATS), "reject" REJECTS
function fakeFetch(...statuses) {
	if (!statuses.length) { statuses = [200]; }
	const calls = [];
	const fn = async (url, options) => {
		calls.push({ url, method: options.method, body: JSON.parse(options.body) });
		const status = statuses[Math.min(calls.length, statuses.length) - 1];
		if (status === "reject") { throw new Error("offline"); }
		return { status };
	};
	return { fn, calls };
}

const flush = () => new Promise((resolve) => setImmediate(resolve)); // LETS THE FAKE fetch ANSWER (setImmediate ISN'T FAKED)

// A PLAIN OBJECT STANDING IN FOR localStorage
function fakeStorage(initial = {}) {
	const data = { ...initial };
	return { data, getItem(key) { return Object.hasOwn(data, key) ? data[key] : null; }, setItem(key, value) { data[key] = String(value); } };
}

beforeEach(() => { mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 }); }); // THE CLOCK: Date.now & setTimeout
afterEach(() => { mock.timers.reset(); });

/* ---------------------------------------------------------------- */
// Tests
/* ---------------------------------------------------------------- */

test("the first change saves at once, a second waits until 5 minutes & 10 s after it", async () => {
	const f = fakeFetch();
	statusPref.init({ signedIn: true, saved: "effects", fetch: f.fn });
	statusPref.set("badges");
	await flush(); // THE SERVER SAYS 200: SAVED
	assert.equal(statusPref.current(), "badges");
	assert.deepEqual(f.calls, [{ url: "/api/user/settings/status-display", method: "PUT", body: { status_display: "badges" } }]);
	mock.timers.tick(60 * 1000);
	statusPref.set("effects");
	assert.equal(statusPref.current(), "effects"); // APPLIED AT ONCE, SAVED LATER
	assert.equal(f.calls.length, 1);
	mock.timers.tick(FIVE_MIN - 60 * 1000);
	assert.equal(f.calls.length, 1); // NOT AT 5 MINUTES: THE SERVER'S BUCKET MAY NOT HAVE REFILLED
	mock.timers.tick(10 * 1000 - 1);
	assert.equal(f.calls.length, 1);
	mock.timers.tick(1);
	assert.equal(f.calls.length, 2);
	assert.deepEqual(f.calls[1].body, { status_display: "effects" });
});

test("a third change before the deferred save collapses into it, which carries the last value", async () => {
	const f = fakeFetch();
	statusPref.init({ signedIn: true, saved: "effects", fetch: f.fn });
	statusPref.set("badges"); // SAVED
	await flush();
	statusPref.set("effects"); // DEFERRED
	statusPref.set("badges"); // BACK TO THE SAVED VALUE...
	statusPref.set("effects"); // ...& AWAY AGAIN
	mock.timers.tick(GAP);
	assert.equal(f.calls.length, 2);
	assert.deepEqual(f.calls[1].body, { status_display: "effects" });
	mock.timers.tick(FIVE_MIN * 2);
	assert.equal(f.calls.length, 2); // ONE DEFERRED SAVE, NOT ONE PER CHANGE
});

test("a change back to the saved value before the deferred save: no save", async () => {
	const f = fakeFetch();
	statusPref.init({ signedIn: true, saved: "effects", fetch: f.fn });
	statusPref.set("badges");
	await flush();
	statusPref.set("effects");
	statusPref.set("badges");
	mock.timers.tick(FIVE_MIN * 2);
	assert.equal(f.calls.length, 1);
	assert.equal(statusPref.current(), "badges");
});

test("a change more than 5 minutes & 10 s after the last save saves at once", async () => {
	const f = fakeFetch();
	statusPref.init({ signedIn: true, saved: "effects", fetch: f.fn });
	statusPref.set("badges");
	await flush();
	mock.timers.tick(GAP + 1);
	statusPref.set("effects");
	assert.equal(f.calls.length, 2);
});

test("a 429 then a success: saved on the retry, 5 minutes & 10 s later", async () => {
	const f = fakeFetch(429, 200);
	statusPref.init({ signedIn: true, saved: "effects", fetch: f.fn });
	statusPref.set("badges");
	await flush();
	assert.equal(f.calls.length, 1);
	mock.timers.tick(GAP - 1);
	assert.equal(f.calls.length, 1);
	mock.timers.tick(1);
	assert.equal(f.calls.length, 2);
	assert.deepEqual(f.calls[1].body, { status_display: "badges" });
	await flush();
	statusPref.set("effects"); // DEFERRED...
	statusPref.set("badges"); // ...& BACK TO WHAT THE RETRY SAVED: NOTHING TO SEND
	mock.timers.tick(GAP * 3);
	assert.equal(f.calls.length, 2);
});

test("two failures: one retry, then it gives up quietly (no third send)", async () => {
	const f = fakeFetch(429, "reject");
	const escaped = [];
	const trap = (err) => escaped.push(err);
	process.on("unhandledRejection", trap);
	try {
		statusPref.init({ signedIn: true, saved: "effects", fetch: f.fn });
		statusPref.set("badges");
		await flush();
		mock.timers.tick(GAP);
		assert.equal(f.calls.length, 2);
		await flush();
		mock.timers.tick(GAP * 5);
		await flush();
		assert.equal(f.calls.length, 2);
		assert.equal(statusPref.current(), "badges"); // STILL APPLIED ON THIS PAGE
		assert.deepEqual(escaped, []);
	} finally { process.off("unhandledRejection", trap); }
});

test("a 429 is ignored quietly", async () => {
	const f = fakeFetch(429);
	statusPref.init({ signedIn: true, saved: "effects", fetch: f.fn });
	assert.doesNotThrow(() => statusPref.set("badges"));
	await Promise.resolve();
	assert.equal(statusPref.current(), "badges");
});

test("a guest: localStorage only, never a fetch, & init reads it back", () => {
	const f = fakeFetch();
	const storage = fakeStorage();
	statusPref.init({ signedIn: false, fetch: f.fn, storage });
	assert.equal(statusPref.current(), "effects");
	statusPref.set("badges");
	statusPref.set("effects");
	statusPref.set("badges");
	mock.timers.tick(FIVE_MIN * 2);
	assert.equal(f.calls.length, 0);
	assert.equal(storage.data.STATUS_DISPLAY, "badges");
	statusPref.init({ signedIn: false, fetch: f.fn, storage });
	assert.equal(statusPref.current(), "badges");
});

test("a guest whose storage throws still gets the mode, unsaved", () => {
	const storage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
	statusPref.init({ signedIn: false, storage });
	assert.equal(statusPref.current(), "effects");
	assert.doesNotThrow(() => statusPref.set("badges"));
	assert.equal(statusPref.current(), "badges");
});

test("init with an invalid or missing value gives effects", () => {
	for (const saved of ["sparkles", undefined, null, 3]) {
		statusPref.init({ signedIn: true, saved, fetch: fakeFetch().fn });
		assert.equal(statusPref.current(), "effects");
	}
	statusPref.init({ signedIn: false, storage: fakeStorage({ STATUS_DISPLAY: "nope" }) });
	assert.equal(statusPref.current(), "effects");
	statusPref.init({ signedIn: true, saved: "badges", fetch: fakeFetch().fn });
	assert.equal(statusPref.current(), "badges");
});

test("onChange fires on set with the new mode, an invalid mode changes nothing", () => {
	const f = fakeFetch();
	statusPref.init({ signedIn: true, saved: "effects", fetch: f.fn });
	const seen = [];
	statusPref.onChange((mode) => seen.push(mode));
	statusPref.set("badges");
	statusPref.set("sparkles");
	assert.deepEqual(seen, ["badges"]);
	assert.equal(statusPref.current(), "badges");
	assert.equal(f.calls.length, 1);
});
