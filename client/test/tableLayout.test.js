const { test } = require("node:test");
const assert = require("node:assert/strict");
const { tableSpots, columnStep, columnBox, pileCards, placeAt, deskPoint, PILES, DISCARD, ASKEW, HAND_Z } = require("../src/js/gameplay/three/tableLayout.js");
const { PILE_AREA } = require("../src/js/gameplay/three/piles.js");
const { CARD_SIZE, DECK, cardSpots } = require("../src/js/gameplay/three/cardLayout.js");
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
	assert.deepEqual([DISCARD.mine.x, DISCARD.mine.z], [34, 9.5]); // MOVED OFF THE TAKEN PIECES (TASK 20e D2, cardDrop.test.js)
	assert.deepEqual([PILES.his.x, PILES.his.z, DISCARD.his.x, DISCARD.his.z], [-24.5, -22, 34, -9.86]); // HIS PASSIVE PILE: BEYOND THE TAKEN PIECES (FIX ROUND 1 OF TASK 20e D, I3)
	assert.equal(PILES.hisSpot.z, -9.86);
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
	assert.ok(Math.abs(his.get("b:q1").z - (-22 - 6.3)) < 1e-9 && !his.get("b:q1").barBottom && his.get("b:q1").from === "hand");
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
	assert.deepEqual([want.get("w:m7").x, want.get("w:m7").z, want.get("w:m7").y, want.get("w:m7").faceDown], [34, 9.5, 4, false]);
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
	assert.deepEqual(placeAt(34, 10), { side: "mine", place: "discard" });
	assert.deepEqual(placeAt(-29, 8), { side: "mine", place: "spot" });
	assert.deepEqual(placeAt(-24.5, 9.5), { side: "mine", place: "passive" });
	assert.deepEqual(placeAt(PILES.hisSpot.x, -9.86), { side: "his", place: "spot" });
	assert.equal(placeAt(0, 0), null);
});

test("placeAt: where the active spot and the passive pile overlap the nearer place wins, and a place reaches 0.5 round its card (final review F-M3)", () => {
	const z = PILES.mine.z, spot = PILES.mineSpot, w = CARD_SIZE.w / 2, h = CARD_SIZE.h / 2;
	assert.ok(spot.x + w + 0.5 > PILES.mine.x - w - 0.5); // THE TWO PLACES' REACHES OVERLAP (x -27.15 .. -26.75)
	assert.deepEqual(placeAt(-27.1, z), { side: "mine", place: "spot" }); // 2.3 FROM THE SPOT, 2.6 FROM THE PILE
	assert.deepEqual(placeAt(-26.8, z), { side: "mine", place: "passive" }); // 2.6 FROM THE SPOT, 2.3 FROM THE PILE: PLACING THE PASSIVE USES THE TURN
	assert.deepEqual(placeAt(spot.x - w - 0.49, z), { side: "mine", place: "spot" }); // PLACE_REACH, ACROSS
	assert.equal(placeAt(spot.x - w - 0.51, z), null);
	assert.deepEqual(placeAt(spot.x, z + h + 0.49), { side: "mine", place: "spot" }); // AND ALONG
	assert.equal(placeAt(spot.x, z + h + 0.51), null);
});

test("focusList: an active spot that holds a card is a keyboard stop after the Board Effects piles", () => {
	const v = { ...view({ spot: [{ id: "a1", key: "x" }] }, { spot: [{ id: "a2", key: "y" }] }, [passive("b", "q1")]), board: { sq: [] } };
	assert.deepEqual(S.focusList([], v, false).filter((x) => x.kind === "pile").map((x) => x.pile), ["his", "mineSpot", "hisSpot"]);
});

test("Card Guy's passive pile, shut & opened as a column of 3: on his side by the red deck's x, clear of the taken pieces, the deck, his hand row, the promotion cards, his active spot's column & the lamp's foot", () => {
	const p = PILES.his, w = CARD_SIZE.w / 2, h = CARD_SIZE.h / 2;
	const shut = { x0: p.x - w, x1: p.x + w, z0: p.z - 2 * 1.2 - h, z1: p.z + h }; // 3 CARDS, THE OLDER TWO PEEKING TOWARD HIM
	const apart = (a, b) => a.x1 < b.x0 || b.x1 < a.x0 || a.z1 < b.z0 || b.z1 < a.z0;
	const card = (x, z) => ({ x0: x - w, x1: x + w, z0: z - h, z1: z + h });
	const others = { taken: PILE_AREA, deck: { x0: DECK.x - w, x1: DECK.x + w, z0: -3.36, z1: 3 }, hand: { x0: -4 * 4.6 - w, x1: 4 * 4.6 + w, z0: -HAND_Z - h, z1: -HAND_Z + h }, spot: columnBox("hisSpot", 7) };
	cardSpots().forEach((c, i) => { others[`promotion${i}`] = card(c.x, c.z); });
	for (const box of [shut, columnBox("his", 3)]) {
		for (const [name, o] of Object.entries(others)) { assert.ok(apart(box, o), `${name} ${JSON.stringify(box)}`); }
		const dx = Math.max(box.x0 - -35, 0, -35 - box.x1), dz = Math.max(box.z0 - -25, 0, -25 - box.z1);
		assert.ok(Math.hypot(dx, dz) > 4.4, "the lamp's foot"); // RADIUS 4.4 ROUND (-35, -25)
		assert.ok(box.z0 >= -40 && box.z1 < 0, "on the desk, his side");
	}
	assert.equal(p.x, DECK.x);
	assert.ok(PILE_AREA.z0 - shut.z1 < 1, "as near the red deck as the taken pieces allow");
});

test("deskPoint: where the pointer's ray meets the desk, not where the dragged card floats above it", () => {
	const origin = { x: 0, y: 30, z: 40 }, to = { x: 32.5, y: -0.76, z: 9.5 }; // THE POINTER ON THE INNER PART OF THE DISCARD PILE'S FRAME
	const dir = { x: to.x - origin.x, y: to.y - origin.y, z: to.z - origin.z };
	const desk = deskPoint(origin, dir, -0.76), float = deskPoint(origin, dir, 0.49);
	assert.ok(Math.abs(desk.x - 32.5) < 1e-9 && Math.abs(desk.z - 9.5) < 1e-9);
	assert.deepEqual(placeAt(desk.x, desk.z), { side: "mine", place: "discard" });
	assert.equal(placeAt(float.x, float.z), null); // THE CARD FLOATS 1.25 HIGHER, SO NEARER THE CAMERA: MEASURED THERE THE DROP WAS REFUSED (REVIEW I2)
	assert.equal(deskPoint(origin, { x: 1, y: 0, z: 0 }, -0.76), null); // ALONG THE DESK
	assert.equal(deskPoint(origin, { x: 0, y: 1, z: 0 }, -0.76), null); // UP, AWAY FROM IT
});
