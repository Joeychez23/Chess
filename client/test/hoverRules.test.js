const { test } = require("node:test");
const assert = require("node:assert/strict");
const { tileAt, canAct, pickable, hoverOn, fadeList, fadeMs, REST_MS, FADE_OPACITY, FADE_OUT_MS, FADE_IN_MS } = require("../src/js/gameplay/three/hoverRules.js");

test("a point on the board is its tile: a1 at White's left, h8 across", () => {
	assert.equal(tileAt(-11.9, 11.9, 24), "a1");
	assert.equal(tileAt(11.9, -11.9, 24), "h8");
	assert.equal(tileAt(1.5, 1.5, 24), "e4"); // JUST RIGHT & BELOW THE CENTER
	assert.equal(tileAt(-0.1, -0.1, 24), "d5");
});

test("a point on the board's very edge stays on the edge tile", () => {
	assert.equal(tileAt(12, -12, 24), "h8");
	assert.equal(tileAt(-12, 12, 24), "a1");
});

test("a tile can be acted on only while the player can act: a marked target, or a piece they can pick up", () => {
	assert.equal(canAct({ acting: true, marked: true, pickable: false }), true);
	assert.equal(canAct({ acting: true, marked: false, pickable: true }), true);
	assert.equal(canAct({ acting: true, marked: false, pickable: false }), false);
	assert.equal(canAct({ acting: false, marked: true, pickable: true }), false); // OFF TURN, AFTER THE GAME: NOTHING FADES
});

const piece = (square, color) => ({ square, color, type: "p" });
const board = [[piece("a8", "b"), null], [null, piece("e2", "w")], [piece("a1", "w"), null]]; // AS chess.js board(): ROWS OF PIECES & nulls

test("the pieces the player can pick up are their own colour's on their turn, whichever side the camera is on", () => {
	assert.deepEqual(pickable({ board, player: "w", turn: "w", open: true }), ["e2", "a1"]);
	assert.deepEqual(pickable({ board, player: "b", turn: "b", open: true }), ["a8"]);
});

test("off turn or with the board closed (game over, replay, a move sent, promoting) the player can't act", () => {
	assert.equal(pickable({ board, player: "w", turn: "b", open: true }), null);
	assert.equal(pickable({ board, player: "w", turn: "w", open: false }), null);
});

test("the board keeps its hover through a press: only a camera gesture or something over the tile takes it", () => {
	assert.equal(hoverOn({ pointer: true, gesture: false, covered: false }), true); // A PRESS ON AN EMPTY TILE HAS THE CAMERA CONTROLS ACTIVE BUT IS NO GESTURE UNTIL PAST DRAG_PX
	assert.equal(hoverOn({ pointer: true, gesture: true, covered: false }), false);
	assert.equal(hoverOn({ pointer: true, gesture: false, covered: true }), false);
	assert.equal(hoverOn({ pointer: false, gesture: false, covered: false }), false);
});

test("the pieces covering the pointer fade once it has rested on a tile the player can act on", () => {
	assert.deepEqual(fadeList({ tile: "e4", rested: true, actionable: true, bodies: ["e2", "e1"], held: null }), ["e2", "e1"]);
});

test("a sweeping pointer, an idle tile & no tile fade nothing", () => {
	assert.deepEqual(fadeList({ tile: "e4", rested: false, actionable: true, bodies: ["e2"], held: null }), []);
	assert.deepEqual(fadeList({ tile: "e4", rested: true, actionable: false, bodies: ["e2"], held: null }), []);
	assert.deepEqual(fadeList({ tile: null, rested: true, actionable: true, bodies: ["e2"], held: null }), []);
});

test("the piece on the hovered tile & the piece in hand never fade", () => {
	assert.deepEqual(fadeList({ tile: "e4", rested: true, actionable: true, bodies: ["e4", "g1", "e2"], held: "g1" }), ["e2"]);
});

test("the rest is about 0.15 s, & a piece fades out slower than it comes back", () => {
	assert.equal(REST_MS, 150);
	assert.ok(FADE_OUT_MS > FADE_IN_MS);
	assert.equal(fadeMs(1, FADE_OPACITY, false), FADE_OUT_MS);
	assert.equal(fadeMs(FADE_OPACITY, 1, false), FADE_IN_MS);
});

test("a fade turned round halfway takes half the time, & reduced motion takes none", () => {
	const half = (1 + FADE_OPACITY) / 2;
	assert.equal(fadeMs(half, 1, false), FADE_IN_MS / 2);
	assert.equal(fadeMs(half, FADE_OPACITY, false), FADE_OUT_MS / 2);
	assert.equal(fadeMs(1, FADE_OPACITY, true), 0);
});
