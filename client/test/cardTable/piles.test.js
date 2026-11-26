const { test } = require("node:test");
const assert = require("node:assert/strict");
const { pileSpots, PILE_AREA, PILE_GAP } = require("../../src/js/gameplay/three/cardTable/takenPiles.js");

const many = (color, n) => Array.from({ length: n }, (_, i) => ({ type: "pnbrq"[i % 5], color }));
const inArea = (s, sign) => s.x * sign >= PILE_AREA.x0 && s.x * sign <= PILE_AREA.x1 && s.z * sign >= PILE_AREA.z0 && s.z * sign <= PILE_AREA.z1;

test("the player's lost pieces go far-left, the pieces they took near-right", () => {
	const spots = pileSpots([{ type: "p", color: "w" }, { type: "n", color: "b" }], "w");
	assert.equal(spots[0].key, "far0");
	assert.ok(inArea(spots[0], 1));
	assert.equal(spots[1].key, "near0");
	assert.ok(inArea(spots[1], -1));
});
test("a Black player's corners are the 180 degree turn, no colour counts as White", () => {
	const taken = [{ type: "p", color: "b" }];
	assert.ok(inArea(pileSpots(taken, "b")[0], -1)); // BLACK LOST IT: FAR FROM BLACK = +x, +z
	assert.equal(pileSpots(taken, "b")[0].key, "far0");
	assert.deepEqual(pileSpots(taken, null), pileSpots(taken, "w"));
	assert.deepEqual(pileSpots(taken, undefined), pileSpots(taken, "w"));
});
test("15 in a pile: inside the area, apart, off the lamp foot, the deck and the green", () => {
	for (const player of ["w", "b"]) {
		for (const color of ["w", "b"]) {
			const spots = pileSpots(many(color, 15), player);
			const sign = spots[0].x < 0 ? 1 : -1;
			spots.forEach(function (a, i) {
				assert.ok(inArea(a, sign), `${player}${color} slot ${i}`);
				assert.ok(Math.hypot(Math.abs(a.x) - 35, Math.abs(a.z) - 25) > 4.3 + 1.2); // LAMP FOOT, EITHER WAY THE ROOM IS TURNED
				assert.ok(Math.abs(a.x) > 22.5); // PAST THE GREEN & ITS LEATHER EDGE
				assert.ok(!(Math.abs(a.x) < 27.9 && Math.abs(a.z) < 4.2)); // THE DECK (±24.5, 0), 4.3 x 6, PLUS A PIECE
				spots.slice(i + 1).forEach((b) => assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= PILE_GAP));
			});
		}
	}
});
test("the same captures always lay out the same, earlier pieces never move", () => {
	const six = many("b", 6);
	assert.deepEqual(pileSpots(six, "w"), pileSpots(six, "w"));
	assert.deepEqual(pileSpots(six, "w").slice(0, 5), pileSpots(six.slice(0, 5), "w"));
	const mixed = [{ type: "p", color: "b" }, { type: "q", color: "w" }, { type: "r", color: "b" }];
	assert.deepEqual(pileSpots(mixed, "w")[2].key, "near1"); // SLOTS COUNT PER PILE
});
test("pieces face the player within 30 degrees, set down loosely", () => {
	const spots = pileSpots(many("b", 15).filter((p) => p.type !== "n"), "w");
	spots.forEach((s) => assert.ok(Math.abs(s.yaw) <= Math.PI / 6 + 1e-9));
	assert.ok(new Set(spots.map((s) => s.yaw.toFixed(3))).size > 5); // NOT ALL THE SAME TURN
	const knight = pileSpots([{ type: "n", color: "b" }], "w")[0];
	assert.ok(Math.abs(knight.yaw + Math.PI / 2) <= Math.PI / 6 + 1e-9);
	const black = pileSpots([{ type: "q", color: "w" }], "b")[0];
	assert.ok(Math.abs(black.yaw - Math.PI) <= Math.PI / 6 + 1e-9);
});
