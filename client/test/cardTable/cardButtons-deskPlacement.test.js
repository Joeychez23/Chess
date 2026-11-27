// The brass plaque buttons on the table: landing clear of the books, monitor & lamp & on the desk, keeping focus & hover through a rebuild, & the nearest clear spot when the asked side is blocked, with real three.js in node, as cardTable-duel.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buttonLayout, BOARD_RECT, DESK_AVOID, HAND_Z, PILE_AREA, setup, view, plaques, cardRect, box, clear, LIST, DESK_THINGS, laidAt, handRows } = require("../helpers/cardButtons.js");

// THE CABLES LEFT THE ROOM. THE BOOKS, FROM build_library.py build_props, IN ROOM SPACE (z = -bake y).
// THE BOOKS: THREE STACKED ROUND (35, bake y 21), THE BIGGEST 16 x 11 TURNED 0.10 RAD, SO x 35 ± 8.51, z -21 ± 6.27. THE DESK: DESK x -48 .. 48, bake y -32 .. 40
const BOOKS = { x0: 26.49, x1: 43.51, z0: -27.27, z1: -14.73 };
const DESK = { x0: -48, x1: 48, z0: -40, z1: 32 };
// THE MONITOR'S CABINET (build_library.py MON_W 17, FRONT AT MON_Y 22.5, 13.6 DEEP) & THE LAMP'S FOOT (RADIUS 4.4 AT (-35, bake y 25)), WHICH THE NEAREST-SPOT SEARCH CAN REACH
const MONITOR = { x0: -8.5, x1: 8.5, z0: -39.6, z1: -22.5 }, LAMP = { x0: -39.4, x1: -30.6, z0: -29.4, z1: -20.6 };
function clearOfAll(laid, avoid = []) { // CLEAR OF THE BOARD, WHAT ELSE IS ON THE DESK, THE BOOKS & avoid, & ALL ON THE DESK
	clear(laid, [BOARD_RECT, ...DESK_THINGS, BOOKS, MONITOR, LAMP, ...avoid]);
	for (const p of laid) {
		const b = box(p);
		assert.ok(b.x0 >= DESK.x0 && b.x1 <= DESK.x1 && b.z0 >= DESK.z0 && b.z1 <= DESK.z1, `${p.id} on the desk: ${JSON.stringify(b)}`);
	}
}

test("plaques 'right' of a piece on the right half land clear & on the desk", () => {
	const { room, table } = setup();
	table.showButtons(LIST, { x: 10.5, z: -7.5, side: "right" });
	assert.equal(table.buttonCount(), 2);
	clearOfAll(laidAt(room));
});

test("plaques 'right' of a piece far up the right half land clear & on the desk, two plaques or four long ones", (t) => {
	const warn = t.mock.method(console, "warn", () => {});
	const four = [{ id: "a", label: "Discard the active (draw 1)" }, { id: "b", label: "Discard both (draw 1)" }, { id: "c", label: "With the card" }, { id: "x", label: "Cancel" }];
	for (const list of [LIST, four]) {
		for (const z of [-13.5, -10.5]) {
			const { room, table } = setup();
			table.showButtons(list, { x: 10.5, z, side: "right" });
			assert.equal(table.buttonCount(), list.length);
			clearOfAll(laidAt(room));
		}
	}
	assert.equal(warn.mock.callCount(), 0);
});

test("every piece's square, every side, one to four plaques: clear of everything & on the desk", (t) => {
	const warn = t.mock.method(console, "warn", () => {});
	const row = (z) => Array.from({ length: 9 }, (_, i) => cardRect({ x: (i - 4) * 4.6, z }));
	const hands = [...row(HAND_Z), ...row(-HAND_Z)];
	const labels = ["Stop", "Continue", "Move (costs a skull)", "Discard the active (draw 1)", "Cancel"];
	for (let n = 1; n <= 4; n++) {
		const list = Array.from({ length: n }, (_, i) => ({ id: `b${i}`, label: labels[(i * 3 + n) % labels.length] }));
		for (let x = -10.5; x <= 10.5; x += 3) {
			for (let z = -10.5; z <= 10.5; z += 3) {
				for (const side of ["left", "right", "below"]) { const laid = buttonLayout(list, { x, z, side }, [BOARD_RECT, ...DESK_AVOID, ...hands]); assert.ok(!laid.blocked); clearOfAll(laid, hands); }
			}
		}
	}
	assert.equal(warn.mock.callCount(), 0);
});

test("plaques 'left' of a mid-row card of Card Guy's 9-card row stay off the far taken pieces", () => {
	const row = Array.from({ length: 9 }, (_, i) => cardRect({ x: (i - 4) * 4.6, z: -HAND_Z }));
	const laid = buttonLayout(LIST, { x: -2.15, z: -HAND_Z, side: "left" }, [BOARD_RECT, ...DESK_AVOID, ...row]);
	clear(laid, [PILE_AREA, ...row]);
});

test("a card moving elsewhere rebuilds nothing; a rebuild keeps the focused & hovered plaque", () => {
	const { room, run, table } = setup();
	const framed = () => plaques(room).filter((m) => m.children.some((f) => f.visible)).map((m) => m.userData.button);
	const lit = () => plaques(room).filter((m) => m.material[0].color.getHex() !== m.material[1].color.getHex()).map((m) => m.userData.button);
	table.showButtons(LIST, { x: 0, z: 25, side: "below" });
	table.focusButton(1);
	table.hoverButton("go");
	const before = plaques(room);
	table.set(view(), {}); // THE HAND CARD m1 COMES TO (0, HAND_Z), NOWHERE NEAR THEM
	run();
	table.showButtons(LIST, { x: 0, z: 25, side: "below" });
	assert.deepEqual(plaques(room), before, "the same meshes");
	const anchor = { x: 0, z: HAND_Z, side: "below" };
	const { room: room2, run: run2, table: table2 } = setup();
	table2.showButtons(LIST, anchor); // AN EMPTY TABLE
	table2.focusButton(1);
	table2.hoverButton("go");
	const first = plaques(room2);
	table2.set(view(), {}); // NOW UNDER THEM
	run2();
	table2.showButtons(LIST, anchor);
	assert.ok(first.every((m) => !room2.children.includes(m)), "laid out again");
	const framed2 = plaques(room2).filter((m) => m.children.some((f) => f.visible)).map((m) => m.userData.button);
	const lit2 = plaques(room2).filter((m) => m.material[0].color.getHex() !== m.material[1].color.getHex()).map((m) => m.userData.button);
	assert.deepEqual(framed2, ["go"], "the focus carried over");
	assert.deepEqual(lit2, ["go"], "the hover carried over");
	assert.deepEqual(framed(), ["go"]);
	assert.deepEqual(lit(), ["go"]);
	table2.showButtons([{ id: "k", label: "Knight" }, { id: "x", label: "Cancel" }], anchor);
	assert.deepEqual(plaques(room2).filter((m) => m.children.some((f) => f.visible)), [], "an id that's gone: no focus");
	table.showButtons([]);
	table.showButtons(LIST, { x: 0, z: 25, side: "below" });
	assert.deepEqual([framed(), lit()], [[], []], "taken away & laid again: unfocused & unhovered");
});

// THE ASKED SIDE WHEN ITS CLEAR SPOT IS WITHIN ABOUT 6 OF THE ANCHOR, ELSE THE NEAREST CLEAR SPOT ON THE DESK. THE BOUNDS ARE THE ONES THE DESK PLACEMENT REVIEW SET
// NEAREST CLEAR SPOTS (nearest.txt: ITS GAP, ANCHOR TO THE NEAREST PLAQUE EDGE, FOR THE ASKED SHAPE SLID ON A 0.25 GRID), PLUS 0.05 FOR ROUNDING
const gapTo = (laid, a) => Math.min(...laid.map((p) => { const b = box(p); return Math.hypot(Math.max(b.x0 - a.x, 0, a.x - b.x1), Math.max(b.z0 - a.z, 0, a.z - b.z1)); }));
const FOUR_LONG = [{ id: "a", label: "Discard the active (draw 1)" }, { id: "b", label: "Discard both (draw 1)" }, { id: "c", label: "With the card" }, { id: "x", label: "Cancel" }];
const PLAY = [{ id: "p", label: "Play" }, { id: "x", label: "Cancel" }];

test("far-right piece prompts land at the nearest clear spot, not across the desk", (t) => {
	const warn = t.mock.method(console, "warn", () => {});
	const cases = [ // [list, anchor z, cards (a hand of n each side), bound]
		[PLAY, -13.5, 0, 6], [PLAY, -13.5, 9, 6], // WITHOUT THE CABLES EVERY CASE KEEPS ITS ASKED RIGHT WITHIN PLAQUE_NEAR (6)
		[FOUR_LONG, -10.5, 0, 6], [FOUR_LONG, -10.5, 5, 6], [FOUR_LONG, -10.5, 9, 6],
		[PLAY, -7.5, 0, 6], [PLAY, -7.5, 9, 6], [PLAY, -4.5, 0, 6], [PLAY, -4.5, 9, 6],
	];
	for (const [list, z, n, bound] of cases) {
		const cards = n ? handRows(n) : [], anchor = { x: 10.5, z, side: "right" };
		const laid = buttonLayout(list, anchor, [BOARD_RECT, ...DESK_AVOID, ...cards]);
		assert.ok(!laid.blocked);
		assert.ok(gapTo(laid, anchor) <= bound, `${list.length} plaques at (10.5, ${z}) with ${n}+${n} cards: gap ${gapTo(laid, anchor).toFixed(2)} <= ${bound}`);
		clearOfAll(laid, cards);
	}
	assert.equal(warn.mock.callCount(), 0);
});

test("an asked side clear within about 6 of the anchor keeps its side, though another is nearer", () => {
	const anchor = { x: 0, z: 25, side: "right" }, block = { x0: 0.1, x1: 3, z0: 20, z1: 30 }; // THE RIGHT PUSHED ABOUT 3.3 OUT; THE LEFT IS CLEAR AT 0.3
	const laid = buttonLayout(LIST, anchor, [block]);
	assert.ok(laid.every((p) => p.x - p.w / 2 >= block.x1), "still on the right, past what's in the way");
	assert.ok(gapTo(laid, anchor) <= 6);
	const far = buttonLayout(LIST, anchor, [{ x0: 0.1, x1: 8, z0: 20, z1: 30 }]); // THE RIGHT'S CLEAR SPOT 8 OUT: THE NEARER LEFT
	assert.ok(gapTo(far, anchor) < 1, `gap ${gapTo(far, anchor).toFixed(2)}`);
});

test("a new list comes up unhovered; the same list laid again keeps its hover & focus", () => {
	const { room, run, table } = setup();
	const lit = () => plaques(room).filter((m) => m.material[0].color.getHex() !== m.material[1].color.getHex()).map((m) => m.userData.button);
	const framed = () => plaques(room).filter((m) => m.children.some((f) => f.visible)).map((m) => m.userData.button);
	const anchor = { x: 0, z: HAND_Z, side: "below" };
	table.showButtons([{ id: "k", label: "Knight" }, { id: "x", label: "Cancel" }], anchor);
	table.hoverButton("x");
	table.showButtons([{ id: "b", label: "Bishop" }, { id: "x", label: "Cancel" }], anchor); // ANOTHER PROMPT WITH ITS OWN Cancel
	assert.deepEqual(lit(), [], "another list: nothing lit under no pointer");
	table.hoverButton("x");
	table.showButtons([{ id: "b", label: "Bishop" }, { id: "x", label: "Back" }], anchor); // THE SAME ids, ANOTHER LABEL
	assert.deepEqual(lit(), [], "another label: unhovered");
	table.hoverButton("x");
	table.focusButton(1);
	table.set(view(), {}); // THE HAND CARD m1 COMES UNDER THEM: LAID AGAIN
	run();
	table.showButtons([{ id: "b", label: "Bishop" }, { id: "x", label: "Back" }], anchor);
	assert.deepEqual([lit(), framed()], [["x"], ["x"]], "the same list re-laid: hover & focus carried");
	table.showButtons([{ id: "b", label: "Bishop" }, { id: "x", label: "Back" }], { x: -6, z: HAND_Z, side: "below" }); // THE SAME LABELS, ANOTHER PROMPT'S ANCHOR
	assert.deepEqual([lit(), framed()], [[], []], "another anchor: neither lit nor framed");
	table.focusButton(0);
	table.showButtons([{ id: "b", label: "Play" }, { id: "x", label: "Cancel" }], anchor);
	assert.deepEqual(framed(), [], "another list: no focus carried, so a held Enter can't press its Play");
});

test("the same list, anchor & cards again lays nothing out (a blocked desk's search is slow)", (t) => {
	t.mock.method(console, "warn", () => {});
	const { room, table } = setup();
	const anchor = { x: 0, z: HAND_Z, side: "below" };
	table.showButtons(LIST, anchor);
	const was = plaques(room)[0].position.clone();
	table.showButtons(LIST, { ...anchor }); // A NEW OBJECT, THE SAME ASK
	assert.ok(plaques(room)[0].position.equals(was));
	const started = performance.now();
	for (let i = 0; i < 50; i++) { table.showButtons(LIST, { ...anchor }); }
	assert.ok(performance.now() - started < 5, "50 repeats cost nothing");
});

test("no clear place warns once per rebuild, not on every showButtons", (t) => {
	const warn = t.mock.method(console, "warn", () => {});
	const { table } = setup();
	const many = Array.from({ length: 40 }, (_, i) => ({ id: `b${i}`, label: "Stop" })); // A ROW WIDER THAN THE DESK
	table.showButtons(many, { x: 0, z: 25, side: "below" });
	table.showButtons(many, { x: 0, z: 25, side: "below" });
	assert.equal(warn.mock.callCount(), 1);
});
