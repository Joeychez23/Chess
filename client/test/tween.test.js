const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTweens } = require("../src/js/gameplay/three/tween.js");

test("a tween runs from its first step, eased, and ends once", () => {
	let asked = 0; const seen = []; let ended = 0;
	const tweens = createTweens(() => { asked++; });
	tweens.add({ duration: 100, delay: 50, update: (k) => seen.push(k), onEnd: () => { ended++; } });
	assert.equal(asked, 1);
	assert.equal(tweens.step(1000), true); // CLOCK STARTS: 1050
	assert.equal(seen.at(-1), 0);
	tweens.step(1100);
	assert.ok(seen.at(-1) > 0.4 && seen.at(-1) < 0.6);
	assert.equal(tweens.step(1150), false);
	assert.equal(seen.at(-1), 1);
	assert.equal(ended, 1);
	assert.equal(tweens.active(), false);
});
test("finish lands everything at once, a zero duration lands on its first step", () => {
	const seen = []; let ended = 0;
	const tweens = createTweens(() => {});
	tweens.add({ duration: 500, update: (k) => seen.push(k), onEnd: () => { ended++; } });
	tweens.finish();
	assert.deepEqual([seen.at(-1), ended, tweens.active()], [1, 1, false]);
	tweens.add({ duration: 0, update: (k) => seen.push(k) });
	assert.equal(tweens.step(5), false);
	assert.equal(seen.at(-1), 1);
});
