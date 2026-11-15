const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseList, pieceFacing, knightFacing } = require("../src/js/gameplay/draw/facing.js");

test("parseList caches by name and raw value, and recovers after invalid JSON", () => {
	const first = parseList("cache", '[{"to":"a1"}]');
	assert.equal(parseList("cache", '[{"to":"a1"}]'), first);
	assert.notEqual(parseList("cache", '[{"to":"b1"}]'), first);
	assert.throws(() => parseList("broken", "{"), SyntaxError);
	assert.deepEqual(parseList("broken", '[]'), []);
});

test("pieceFacing handles moved, sliding, unmoved, taken, and landed pieces", () => {
	assert.deepEqual(pieceFacing([{ from: "a2", to: "a4" }], "a4", { viewColor: "w", slide: null, landed: null }), { yFrom: 6, yTo: 4 });
	assert.deepEqual(pieceFacing([{ from: "a2", to: "a4" }], "a4", { viewColor: "b", slide: null, landed: null }), { yFrom: 1, yTo: 3 });
	assert.deepEqual(pieceFacing([{ from: "a7", to: "a5" }], "a5", { viewColor: "w", slide: null, landed: null }), { yFrom: 1, yTo: 3 });
	assert.deepEqual(pieceFacing([{ from: "a7", to: "a5" }], "a5", { viewColor: "b", slide: null, landed: null }), { yFrom: 6, yTo: 4 });
	assert.deepEqual(pieceFacing([{ from: "a1", to: "a2" }], "a2", { viewColor: "w", slide: { from: "b2", to: "c2" }, landed: null }), { yFrom: 7, yTo: 6 });
	assert.deepEqual(pieceFacing([{ from: "a1", to: "a2" }], "a2", { viewColor: "w", slide: { from: "b2", to: "b4" }, landed: null }), { yFrom: 6, yTo: 4 });
	assert.deepEqual(pieceFacing([{ from: null, to: "a1" }], "a1", { viewColor: "w", slide: null, landed: null }), { yFrom: null, yTo: null });
	assert.equal(pieceFacing([{ from: null, to: null }], "a1", { viewColor: "w", slide: null, landed: null }), null);
	assert.equal(pieceFacing([], "a1", { viewColor: "w", slide: { from: "a1", to: "a2" }, landed: null }), null);
	assert.deepEqual(pieceFacing([{ from: "b1", to: "b3" }], "a1", { viewColor: "w", slide: null, landed: { from: "a1", to: "b3" } }), { yFrom: 7, yTo: 5 });
	assert.deepEqual(pieceFacing([{ from: null, to: "b3" }], "a1", { viewColor: "w", slide: null, landed: { from: "a1", to: "b3" } }), { yFrom: undefined, yTo: undefined });
	assert.equal(pieceFacing([{ from: "b1", to: "b3" }], "a1", { viewColor: "w", slide: null, landed: null }), null);
});

test("knightFacing handles starting sides, moves, slides, landed moves, and the skipped branch", () => {
	const start = (square, color, viewColor) => knightFacing([{ from: null, to: square }], square, color, { viewColor, slide: null, landed: null });
	assert.deepEqual(start("b1", "w", "w"), { kind: "side", side: "right" });
	assert.deepEqual(start("b1", "w", "b"), { kind: "side", side: "left" });
	assert.deepEqual(start("g1", "w", "w"), { kind: "side", side: "left" });
	assert.deepEqual(start("g1", "w", "b"), { kind: "side", side: "right" });
	assert.deepEqual(start("b8", "b", "w"), { kind: "side", side: "right" });
	assert.deepEqual(start("b8", "b", "b"), { kind: "side", side: "left" });
	assert.deepEqual(start("g8", "b", "w"), { kind: "side", side: "left" });
	assert.deepEqual(start("g8", "b", "b"), { kind: "side", side: "right" });
	assert.deepEqual(knightFacing([{ from: "b1", to: "c3" }], "c3", "w", { viewColor: "w", slide: null, landed: null }), { kind: "dir", xFrom: 1, xTo: 2 });
	for (const color of ["w", "b"]) for (const viewColor of ["w", "b"]) {
		const expected = color === "b" && viewColor === "b" ? [6, 5] : [1, 2];
		assert.deepEqual(knightFacing([{ from: null, to: null }], "c3", color, { viewColor, slide: { from: "b1", to: "c3" }, landed: null }), { kind: "dir", xFrom: expected[0], xTo: expected[1] });
	}
	assert.deepEqual(knightFacing([{ from: null, to: "h8" }, { from: "b1", to: "c3" }], "a1", "w", { viewColor: "w", slide: null, landed: { from: "a1", to: "c3" } }), { kind: "dir", xFrom: 1, xTo: 2 });
	assert.deepEqual(knightFacing([{ from: "a7", to: "a8" }], "a8", "w", { viewColor: "b", slide: null, landed: null }), { kind: "dir", xFrom: 0, xTo: 0 });
	assert.equal(knightFacing([], "a1", "w", { viewColor: "w", slide: { from: "a1", to: "b3" }, landed: null }), null);
});
