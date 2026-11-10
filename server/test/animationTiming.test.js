/*
 *  animationTiming.test.js  --  chess server tests
 *	The animation timings shared by the 2D & 3D boards (client/src/js/gameplay/animate/timing.js)
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SLIDE_MS_PER_SQUARE, KNIGHT_PAUSE_MS, slideDuration, slideDelay, hopArc, easeInOut } = require("../../client/src/js/gameplay/animate/timing.js");

test("a slide takes its time per square, a knight one square after its stop", () => {
	assert.equal(slideDuration(3, false), 3 * SLIDE_MS_PER_SQUARE);
	assert.equal(slideDuration(2, true), SLIDE_MS_PER_SQUARE);
	assert.equal(slideDelay(true), KNIGHT_PAUSE_MS);
	assert.equal(slideDelay(false), 0);
});

test("the knight's hop is on the board at both ends & highest halfway", () => {
	assert.equal(hopArc(0), 0);
	assert.equal(hopArc(1), 0);
	assert.equal(hopArc(0.5), 1);
	assert.equal(hopArc(2), 0);
});

test("the restart slide starts & lands slowly", () => {
	assert.equal(easeInOut(0), 0);
	assert.equal(easeInOut(1), 1);
	assert.ok(Math.abs(easeInOut(0.5) - 0.5) < 1e-9);
	assert.ok(easeInOut(0.1) < 0.1);
});
