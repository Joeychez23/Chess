const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAnimations } = require("../../src/js/gameplay/three/animations.js");

test("an animation runs from its first step, eased, and ends once", () => {
	let asked = 0; const seen = []; let ended = 0;
	const animations = createAnimations(() => { asked++; });
	animations.add({ duration: 100, delay: 50, update: (k) => seen.push(k), onEnd: () => { ended++; } });
	assert.equal(asked, 1);
	assert.equal(animations.step(1000), true); // CLOCK STARTS: 1050
	assert.equal(seen.at(-1), 0);
	animations.step(1100);
	assert.ok(seen.at(-1) > 0.4 && seen.at(-1) < 0.6);
	assert.equal(animations.step(1150), false);
	assert.equal(seen.at(-1), 1);
	assert.equal(ended, 1);
	assert.equal(animations.active(), false);
});
test("finish lands everything at once, a zero duration lands on its first step", () => {
	const seen = []; let ended = 0;
	const animations = createAnimations(() => {});
	animations.add({ duration: 500, update: (k) => seen.push(k), onEnd: () => { ended++; } });
	animations.finish();
	assert.deepEqual([seen.at(-1), ended, animations.active()], [1, 1, false]);
	animations.add({ duration: 0, update: (k) => seen.push(k) });
	assert.equal(animations.step(5), false);
	assert.equal(seen.at(-1), 1);
});
