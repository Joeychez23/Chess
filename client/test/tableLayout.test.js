const { test } = require("node:test");
const assert = require("node:assert/strict");
const { tableSpots, columnStep, columnBox, pileCards, placeAt, PILES, DISCARD, ASKEW } = require("../src/js/gameplay/three/tableLayout.js");
const { PILE_AREA } = require("../src/js/gameplay/three/piles.js");
const { CARD_SIZE } = require("../src/js/gameplay/three/cardLayout.js");
const S = require("../src/js/gameplay/cards/select.js");

const Y = { base: 0, layer: 1 };
const move = (id, piece = "n") => ({ id, key: "move", piece });
const view = (w = {}, b = {}, effects = []) => ({
	you: "w", effects,
	players: {
		w: { king: true, moves: [], actives: [], passive: null, curses: [], spot: [], pile: { n: 0, top: null }, kept: null, ...w },
		b: { king: true, hand: { count: 0, shown: [] }, spot: [], pile: { n: 0, top: null }, kept: null, ...b },
	},
});
const passive = (owner, id) => ({ id, owner, card: { id, key: "spite" } });

test("the places: the player's as ruled, Card Guy's active spot & its column clear of the taken pieces & the lamp's foot", () => {
	assert.deepEqual([PILES.mine.x, PILES.mine.z], [-24.5, 9.5]);
	assert.deepEqual([PILES.mineSpot.x, PILES.mineSpot.z], [-29.4, 9.5]);
	assert.deepEqual([DISCARD.mine.x, DISCARD.mine.z], [24.5, 9.5]);
	assert.deepEqual([PILES.his.x, PILES.his.z, DISCARD.his.x, DISCARD.his.z], [-24.5, -9.86, 24.5, -9.86]);
	assert.ok(PILES.hisSpot.x + CARD_SIZE.w / 2 < PILE_AREA.x0); // LEFT OF THE TAKEN PIECES
	for (let n = 1; n <= 7; n++) {
		const box = columnBox("hisSpot", n);
		assert.ok(box.z0 >= -20.6 && box.x1 < PILE_AREA.x0, `${n} cards`); // THE LAMP'S FOOT: RADIUS 4.4 ROUND (-35, -25)
		assert.ok(columnBox("mine", n).z1 <= 32 && columnBox("mineSpot", n).z1 <= 32 && columnBox("his", n).z0 >= -40); // ON THE DESK
	}
});

test("columnStep: whole cards while they fit, else they overlap in the room there is, never under a name bar", () => {
	assert.equal(columnStep(1, 22), 6.3);
	assert.equal(columnStep(4, 22), 6.3); // 3 x 6.3 + 3 = 21.9
	assert.ok(Math.abs(columnStep(5, 22) - 4.75) < 1e-9); // (22 - 3) / 4
	assert.equal(columnStep(40, 22), 1.2);
});

test("a closed pile peeks its older cards toward its owner, an opened one lays them out whole, the newest at the pile on top", () => {
	const v = view({}, {}, [passive("w", "p1"), passive("w", "p2"), passive("b", "q1"), passive("b", "q2")]);
	const shut = tableSpots(v, Y), open = tableSpots(v, { ...Y, open: "mine" }), his = tableSpots(v, { ...Y, open: "his" });
	assert.deepEqual([shut.get("w:p2").z, shut.get("w:p1").z], [9.5, 10.7]);
	assert.deepEqual([open.get("w:p2").z, open.get("w:p1").z], [9.5, 15.8]);
	assert.deepEqual([open.get("w:p2").y, open.get("w:p1").y], [1, 0]);
	assert.ok(open.get("w:p2").top && !open.get("w:p1").top && open.get("w:p1").pile === "mine" && open.get("w:p1").barBottom);
	assert.equal(open.get("b:q1").z, shut.get("b:q1").z); // THE OTHER PILE STAYS SHUT
	assert.ok(Math.abs(his.get("b:q1").z - (-9.86 - 6.3)) < 1e-9 && !his.get("b:q1").barBottom && his.get("b:q1").from === "hand");
	assert.deepEqual(columnBox("mine", 2), { x0: -24.5 - 2.15, x1: -24.5 + 2.15, z0: 6.5, z1: 18.8 });
});

test("the actives in effect lie on the active spot, a card the view hides face down", () => {
	const v = view({ spot: [{ id: "a1", key: "x" }] }, { spot: [{ id: "a2", key: "y" }, { down: true }] });
	const want = tableSpots(v, { ...Y, open: "hisSpot" });
	assert.deepEqual([want.get("w:a1").x, want.get("w:a1").z, want.get("w:a1").pile], [-29.4, 9.5, "mineSpot"]);
	assert.equal(want.get("b:a2").x, PILES.hisSpot.x);
	const down = want.get("b:hisSpot1");
	assert.ok(down.faceDown && down.card === null && down.top);
	assert.deepEqual(pileCards(v, "hisSpot").length, 2);
});

test("the discard pile: its top card on a block as thick as the cards under it, the remembered card askew on top", () => {
	const v = view({ pile: { n: 5, top: move("m7") }, kept: move("m9") }, { pile: { n: 2, top: { down: true } }, kept: { down: true } });
	const want = tableSpots(v, Y);
	assert.deepEqual([want.get("w:m7").x, want.get("w:m7").z, want.get("w:m7").y, want.get("w:m7").faceDown], [24.5, 9.5, 4, false]);
	assert.deepEqual([want.get("w:#under").thick, want.get("w:#under").faceDown, want.get("w:#under").y], [4, true, 0]);
	assert.deepEqual([want.get("w:m9").y, want.get("w:m9").yaw], [5, ASKEW]);
	assert.ok(want.get("b:#top2").faceDown && want.get("b:#top2").card === null && want.get("b:#top2").z === -9.86);
	assert.ok(want.get("b:#kept").faceDown && want.get("b:#kept").yaw === ASKEW);
	assert.equal(want.get("b:#under").thick, 1);
	assert.ok([...want.values()].filter((s) => s.discard).every((s) => !s.pile && !s.hand)); // NOT OPENED, NOT PICKED
	const empty = tableSpots(view(), Y);
	assert.deepEqual([...empty.keys()], ["w:king", "b:king"]);
});

test("a card keeps its key from the hand to its place, so it's the same card that slides there", () => {
	const before = tableSpots(view({ moves: [move("m1")], actives: [{ id: "a1", key: "x" }] }), Y);
	const after = tableSpots(view({ spot: [{ id: "a1", key: "x" }], pile: { n: 1, top: move("m1") } }), Y);
	assert.ok(before.get("w:m1").hand && before.get("w:a1").hand);
	assert.ok(after.get("w:m1").discard === "mine" && after.get("w:a1").pile === "mineSpot");
});

test("placeAt: the place under a point of the desk, empty or not", () => {
	assert.deepEqual(placeAt(24, 10), { side: "mine", place: "discard" });
	assert.deepEqual(placeAt(-29, 8), { side: "mine", place: "spot" });
	assert.deepEqual(placeAt(-24.5, 9.5), { side: "mine", place: "passive" });
	assert.deepEqual(placeAt(PILES.hisSpot.x, -9.86), { side: "his", place: "spot" });
	assert.equal(placeAt(0, 0), null);
});

test("focusList: an active spot that holds a card is a keyboard stop after the Board Effects piles", () => {
	const v = { ...view({ spot: [{ id: "a1", key: "x" }] }, { spot: [{ id: "a2", key: "y" }] }, [passive("b", "q1")]), board: { sq: [] } };
	assert.deepEqual(S.focusList([], v, false).filter((x) => x.kind === "pile").map((x) => x.pile), ["his", "mineSpot", "hisSpot"]);
});
