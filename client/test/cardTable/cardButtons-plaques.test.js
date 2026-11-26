// The brass plaque buttons on the table: their placement beside the duel & hand cards (tableLayout.js buttonLayout), createCardTable's showButtons, hit, focusButton & dispose, & staying clear of the desk's taken pieces & decks, with real three.js in node, as cardTable-duel.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { THREE, buttonLayout, duelLayout, DUEL_STACK, BOARD_RECT, HAND_Z, CARD_SIZE, DECK, GREEN_DECK, setup, view, rayDown, plaques, cardRect, overlaps, box, clear, LIST, watchFree, DESK_THINGS, laidBoxes } = require("../helpers/cardButtons.js");

test("placement beside the duel cards: clear of the board, the duel cards & the stacked hands", () => {
	const duel = { player: "w", piece: "w12", step: "decide", round: 1, hands: { w: [null, null, null], b: [null, null, null] }, picked: { w: [], b: [] }, spades: null };
	const avoid = [BOARD_RECT, ...duelLayout(duel, "w").map(cardRect), cardRect(DUEL_STACK.mine), cardRect(DUEL_STACK.his)];
	const right = Math.max(...duelLayout(duel, "w").map((d) => d.x));
	for (const side of ["right", "left", "below"]) {
		const laid = buttonLayout(LIST, { x: right + CARD_SIZE.w / 2, z: HAND_Z, side }, avoid);
		assert.equal(laid.length, 2);
		assert.deepEqual(laid.map((p) => p.id), ["stop", "go"]);
		clear(laid, avoid);
	}
});

test("placement beside a hand card: clear of the board & both hand rows, shifted along its side when the first place is covered", () => {
	const row = (z) => Array.from({ length: 9 }, (_, i) => cardRect({ x: (i - 4) * 4.6, z }));
	const avoid = [BOARD_RECT, ...row(HAND_Z), ...row(-HAND_Z)];
	const list = [{ id: "both", label: "Discard both (draw 1)" }, { id: "cancel", label: "Cancel" }];
	for (const side of ["below", "right", "left"]) { clear(buttonLayout(list, { x: 0, z: HAND_Z, side }, avoid), avoid); }
});

test("a long label: two lines on a wider plaque, the text no smaller", () => {
	const [short] = buttonLayout([{ id: "a", label: "Stop" }], { x: 0, z: 25, side: "below" }, []);
	const [long] = buttonLayout([{ id: "b", label: "Discard both (draw 1)" }], { x: 0, z: 25, side: "below" }, []);
	assert.deepEqual(short.lines, ["STOP"]);
	assert.deepEqual(long.lines, ["DISCARD BOTH", "(DRAW 1)"]);
	assert.ok(long.w > short.w && long.d > short.d);
	const { room, table } = setup();
	table.showButtons([{ id: "a", label: "Stop" }, { id: "b", label: "Discard both (draw 1)" }], { x: 0, z: 25, side: "below" });
	const fonts = plaques(room).map((m) => m.material[0].map.image.getContext("2d").font);
	assert.equal(fonts.length, 2);
	assert.ok(fonts[0] && fonts[0] === fonts[1], "the same text height");
});

test("a ray on a plaque reports its button, in front of a card under it; between plaques it doesn't", () => {
	const { room, run, table } = setup();
	table.showButtons(LIST, { x: 0, z: HAND_Z, side: "below" }); // AN EMPTY TABLE: NOTHING TO AVOID BUT THE BOARD
	const laid = buttonLayout(LIST, { x: 0, z: HAND_Z, side: "below" }, [BOARD_RECT]);
	table.set(view(), {}); // THE HAND CARD m1 COMES TO x 0, UNDER THE PLAQUES
	run();
	assert.equal(table.buttonCount(), 2);
	assert.ok(overlaps(box(laid[0]), cardRect({ x: 0, z: HAND_Z })), "a card under the first plaque");
	for (const p of laid) { assert.deepEqual(table.hit(rayDown(p.x, p.z)), { kind: "button", id: p.id }); }
	const between = table.hit(rayDown((laid[0].x + laid[0].w / 2 + laid[1].x - laid[1].w / 2) / 2, laid[0].z));
	assert.ok(!between || between.kind !== "button");
	assert.ok(table.covers(rayDown(laid[1].x, laid[1].z)), "a press on a plaque never moves the camera");
});

test("the same list twice rebuilds nothing; a new list frees the old plaques", () => {
	const { room, table } = setup();
	const anchor = { x: 0, z: 25, side: "below" };
	table.showButtons(LIST, anchor);
	const before = plaques(room);
	const freed = watchFree(before);
	table.showButtons(LIST.map((b) => ({ ...b })), { side: "below", z: 25, x: 0 }); // THE SAME ANCHOR, ITS KEYS IN ANOTHER ORDER
	assert.deepEqual(plaques(room), before, "the same meshes");
	assert.equal(freed.n, 0);
	table.showButtons([{ id: "k", label: "Knight" }, { id: "b", label: "Bishop" }, { id: "x", label: "Cancel" }], anchor);
	assert.equal(freed.n, 2 * 4, "the old textures, top materials & both geometries disposed");
	assert.equal(plaques(room).length, 3);
	assert.ok(before.every((m) => !room.children.includes(m)));
	table.showButtons([]);
	assert.equal(plaques(room).length, 0);
	assert.equal(table.buttonCount(), 0);
});

test("the focus frame on exactly one plaque; null clears it; hover & press keep the plaque", () => {
	const { room, run, step, table } = setup();
	table.showButtons([...LIST, { id: "x", label: "Cancel" }], { x: 0, z: 25, side: "below" });
	const framed = () => plaques(room).filter((m) => m.children.some((f) => f.visible)).map((m) => m.userData.button);
	assert.deepEqual(framed(), []);
	table.focusButton(1);
	assert.deepEqual(framed(), ["go"]);
	table.focusButton(2);
	assert.deepEqual(framed(), ["x"]);
	table.focusButton(null);
	assert.deepEqual(framed(), []);
	const m = plaques(room)[0], y = m.position.y, tint = m.material[0].color.getHex();
	table.hoverButton("stop");
	assert.ok(m.material[0].color.r > new THREE.Color(tint).r, "hover brightens it");
	table.hoverButton(null);
	assert.equal(m.material[0].color.getHex(), tint);
	table.focusButton(0);
	const ring = m.children[0], ringY = y + ring.position.y;
	table.pressButton("stop");
	step(16);
	step(112);
	assert.ok(m.position.y < y - 0.1, "it sinks");
	assert.ok(Math.abs(m.position.y + ring.position.y - ringY) < 1e-9, "its focus frame stays on the baize");
	run();
	assert.ok(Math.abs(m.position.y - y) < 1e-9, "it rises back");
	assert.ok(Math.abs(m.position.y + ring.position.y - ringY) < 1e-9);
});

test("under reduced motion a press doesn't move the plaque", () => {
	const { room, step, table } = setup(() => true);
	table.showButtons(LIST, { x: 0, z: 25, side: "below" });
	const m = plaques(room)[0], y = m.position.y;
	table.pressButton("stop");
	step(112);
	assert.equal(m.position.y, y);
});

test("dispose frees the plaques' textures, top materials & geometries", () => {
	const { room, table } = setup();
	table.showButtons(LIST, { x: 0, z: 25, side: "below" });
	const freed = watchFree(plaques(room));
	table.dispose();
	assert.equal(freed.n, 2 * 4);
	assert.equal(plaques(room).length, 0);
});

test("covers: a ray on a plaque with no card under it", () => {
	const { room, table } = setup();
	table.showButtons(LIST, { x: 0, z: 25, side: "below" }); // AN EMPTY TABLE: NO CARD ANYWHERE
	const m = plaques(room)[0];
	room.updateMatrixWorld(true); // AS A RENDER DOES
	assert.ok(table.covers(rayDown(m.position.x, m.position.z)));
	assert.ok(!table.covers(rayDown(m.position.x, m.position.z + 6)), "the baize beside it isn't covered");
});

test("the plaques are lit brass with a real bevel, the engraving on the top face, few polygons", () => {
	const { room, table } = setup();
	table.showButtons([{ id: "a", label: "Stop" }], { x: 0, z: 25, side: "below" });
	const [m] = plaques(room), [p] = buttonLayout([{ id: "a", label: "Stop" }], { x: 0, z: 25, side: "below" }, [BOARD_RECT]);
	assert.ok(m.material.every((x) => x.isMeshStandardMaterial), "lit by the room's lights");
	assert.equal(m.material[0].color.getHex(), m.material[1].color.getHex(), "the top & the sides the same brass");
	const g = m.geometry, pos = g.attributes.position, uv = g.attributes.uv;
	g.computeBoundingBox();
	assert.ok(Math.abs(g.boundingBox.max.x - g.boundingBox.min.x - p.w) < 1e-6 && Math.abs(g.boundingBox.max.z - g.boundingBox.min.z - p.d) < 1e-6, "its footprint is the layout's");
	assert.ok(pos.count / 3 <= 64, "a small polygon count");
	const top = g.boundingBox.max.y, texture = m.material[0].map, at = new THREE.Vector2();
	texture.updateMatrix();
	const tops = [];
	for (const grp of g.groups.filter((x) => x.materialIndex === 0)) {
		for (let i = grp.start; i < grp.start + grp.count; i++) { if (Math.abs(pos.getY(i) - top) < 1e-6) { tops.push({ x: pos.getX(i), z: pos.getZ(i), uv: at.fromBufferAttribute(uv, i).applyMatrix3(texture.matrix).clone() }); } }
	}
	assert.ok(tops.length >= 3, "the textured material on the top face");
	assert.ok(Math.max(...tops.map((v) => v.x)) < p.w / 2 - 0.02, "the top is narrower than the footprint: a bevel");
	const farLeft = tops.reduce((a, v) => (v.x + v.z < a.x + a.z ? v : a));
	assert.ok(Math.abs(farLeft.uv.x) < 1e-6 && Math.abs(farLeft.uv.y - 1) < 1e-6, "the canvas's top-left corner at the far left");
	const nearRight = tops.reduce((a, v) => (v.x + v.z > a.x + a.z ? v : a));
	assert.ok(Math.abs(nearRight.uv.x - 1) < 1e-6 && Math.abs(nearRight.uv.y) < 1e-6);
});

// WHAT ELSE LIES ON THE DESK, IN ROOM SPACE, FROM THE CODE THAT PLACES IT. THE TAKEN PIECES: takenPiles.js PILE_AREA & ITS 180° TURN;
// THE DECKS: A CARD'S FOOTPRINT AT DECK & GREEN_DECK
const clearOfDesk = (room) => { for (const b of laidBoxes(room)) { for (const r of DESK_THINGS) { assert.ok(!overlaps(b, r), `${JSON.stringify(b)} clear of ${JSON.stringify(r)}`); } } };

test("plaques 'right' of a piece on the right half stay clear of the desk's things", () => {
	const { room, table } = setup();
	table.showButtons(LIST, { x: 10.5, z: -7.5, side: "right" });
	assert.equal(table.buttonCount(), 2);
	clearOfDesk(room);
});

test("plaques 'right' of a mid-row card of a 9-card hand stay off the near taken pieces", () => {
	const { room, run, table } = setup();
	const v = view();
	v.players.w.moves = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, key: "move", piece: "n" }));
	table.set(v, {});
	run();
	table.showButtons(LIST, { x: 2.15, z: HAND_Z, side: "right" });
	assert.equal(table.buttonCount(), 2);
	clearOfDesk(room);
});

test("a row 'below' a point just beyond either deck stays off the deck", () => {
	const { room, table } = setup();
	for (const x of [DECK.x, GREEN_DECK.x]) {
		table.showButtons([{ id: "k", label: "Knight" }, { id: "x", label: "Cancel" }], { x, z: -4.5, side: "below" });
		clearOfDesk(room);
	}
});

test("a second call after the cards moved under the plaques lays them out again, clear of the cards", () => {
	const { room, run, table } = setup();
	const anchor = { x: 0, z: HAND_Z, side: "below" };
	table.showButtons(LIST, anchor); // AN EMPTY TABLE
	const before = plaques(room);
	table.set(view(), {}); // THE HAND CARD m1 COMES TO x 0, UNDER THEM
	run();
	table.showButtons(LIST, anchor);
	assert.ok(before.every((m) => !room.children.includes(m)), "laid out again");
	for (const b of laidBoxes(room)) { assert.ok(!overlaps(b, cardRect({ x: 0, z: HAND_Z })), "clear of the card"); }
	const now = plaques(room);
	table.showButtons(LIST, anchor);
	assert.deepEqual(plaques(room), now, "nothing changed: nothing rebuilt");
});

test("no clear place on the desk: buttonLayout says so", () => {
	assert.equal(buttonLayout(LIST, { x: 0, z: 0, side: "right" }, [{ x0: -1000, x1: 1000, z0: -1000, z1: 1000 }]).blocked, true);
	assert.equal(buttonLayout(LIST, { x: 0, z: 25, side: "below" }, [BOARD_RECT]).blocked, undefined, "silent when it found one");
});
