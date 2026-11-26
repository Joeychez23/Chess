const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cardSpots, nextCard, drawCardFace, CARD_SIZE } = require("../../src/js/gameplay/three/cardLayout.js");

test("four cards, queen at the top, in a column inside the green strip", () => {
	const spots = cardSpots();
	assert.deepEqual(spots.map((s) => s.type), ["q", "r", "b", "n"]);
	assert.deepEqual(spots.map((s) => s.z), [-9.75, -3.25, 3.25, 9.75]);
	spots.forEach((s) => { assert.equal(s.x, -17.7); assert.ok(s.x - CARD_SIZE.w / 2 > -21.2 && s.x + CARD_SIZE.w / 2 < -14.25); });
	assert.ok(spots[1].z - spots[0].z > CARD_SIZE.h); // NO OVERLAP
});
test("arrow keys walk the cards and stop at the ends", () => {
	assert.equal(nextCard(null, "ArrowDown"), 0);
	assert.equal(nextCard(0, "ArrowDown"), 1);
	assert.equal(nextCard(3, "ArrowDown"), 3);
	assert.equal(nextCard(0, "ArrowUp"), 0);
	assert.equal(nextCard(2, "ArrowLeft"), 1);
	assert.equal(nextCard(2, "ArrowRight"), 3);
	assert.equal(nextCard(2, "Enter"), 2);
});
test("a face is drawn in the player's colour: solid for Black, outlined for White", () => {
	const record = () => { const calls = []; const ctx = new Proxy({ calls }, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); }), set: (t, k, v) => { calls.push(["set", k, v]); return true; } }); return ctx; };
	const black = record(), white = record();
	drawCardFace(black, "q", "b", 256, 358);
	drawCardFace(white, "n", "w", 256, 358);
	assert.ok(black.calls.some((c) => c[0] === "fillText" && c[1] === "♛"));
	assert.ok(black.calls.filter((c) => c[0] === "fillText" && c[1] === "Q").length === 2); // BOTH CORNERS
	assert.ok(white.calls.some((c) => c[0] === "strokeText" && c[1] === "♞"));
	assert.ok(!black.calls.some((c) => c[0] === "strokeText" && c[1] === "♛"));
});
test("the corner glyphs follow the player's colour too, the corner letters stay solid", () => {
	const record = () => { const calls = []; const ctx = new Proxy({ calls }, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); }), set: (t, k, v) => { calls.push(["set", k, v]); return true; } }); return ctx; };
	const black = record(), white = record();
	drawCardFace(black, "q", "b", 256, 358);
	drawCardFace(white, "q", "w", 256, 358);
	assert.equal(white.calls.filter((c) => c[0] === "strokeText" && c[1] === "♛").length, 3); // CENTRE + TWO CORNERS
	assert.equal(white.calls.filter((c) => c[0] === "fillText" && c[1] === "Q").length, 2);
	assert.equal(white.calls.filter((c) => c[0] === "strokeText" && c[1] === "Q").length, 0);
	assert.equal(black.calls.filter((c) => c[0] === "strokeText").length, 0);
});
