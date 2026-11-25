// Task 23 S3: the brass plaque buttons on the table. Their placement (tableLayout.js buttonLayout), & createCardTable's showButtons, hit, focusButton & dispose with real three.js in node, as cardTableDuel.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

function recorder() { // A 2D CONTEXT THAT DRAWS NOTHING BUT KEEPS WHAT IS SET ON IT (ITS font)
	return new Proxy({}, { get: (o, k) => (k === "measureText" ? (t) => ({ width: String(t).length }) : k === "createLinearGradient" ? () => ({ addColorStop() {} }) : k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
}
global.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {} };
global.document = {
	createElement(tag) {
		if (tag !== "canvas") { return { setAttribute() {}, remove() {}, textContent: "" }; }
		const canvas = { width: 0, height: 0 }, ctx = recorder();
		canvas.getContext = () => ctx;
		return canvas;
	},
	body: { append() {} },
};
const THREE = require("../../node_modules/three/build/three.module.js"); // THE SAME COPY cardTable.js IMPORTS
const { createCardTable, deskInView } = require("../src/js/gameplay/three/cardTable.js");
const { createTweens } = require("../src/js/gameplay/three/tween.js");
const { buttonLayout, plaqueAnchor, tableSpots, duelLayout, DUEL_STACK, BOARD_RECT, DESK_AVOID, HAND_Z } = require("../src/js/gameplay/three/tableLayout.js");
const { CARD_SIZE, CARD_Y, DECK, GREEN_DECK } = require("../src/js/gameplay/three/cardLayout.js");
const { openingCamera } = require("../src/js/gameplay/three/openingCamera.js");
const { DESK_Y } = require("../src/js/gameplay/three/constants.js");
const S = require("../src/js/gameplay/cards/select.js");
const { fromFen } = require("../../cards-engine/board.js");
const { PILE_AREA } = require("../src/js/gameplay/three/piles.js");

function template() { // A CARD: ITS FACE ON TOP LOOKING UP, ITS BACK UNDER IT LOOKING DOWN
	const g = new THREE.Group();
	const face = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ name: "cardFace" }));
	face.position.y = 0.03;
	const back = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ name: "cardBack" }));
	g.add(face, back);
	return g;
}
function setup(still, inView, camera) {
	const room = new THREE.Group(), tweens = createTweens(() => {});
	let now = 0;
	const table = createCardTable({ template: template(), room, tweens, requestRender() {}, still, inView, camera });
	const run = () => { while (tweens.step((now += 16))) { /* TO THE END */ } room.updateMatrixWorld(true); };
	const step = (ms) => { for (const end = now + ms; now < end;) { tweens.step((now += 16)); } };
	return { room, run, step, table };
}
const view = () => ({ you: "w", effects: [], players: { w: { king: false, moves: [{ id: "m1", key: "move", piece: "n" }], actives: [], passive: null, curses: [], spot: [], pile: { n: 0, top: null }, kept: null }, b: { king: false, hand: { count: 0, shown: [] }, spot: [], pile: { n: 0, top: null }, kept: null } } });
const rayDown = (x, z) => { const r = new THREE.Raycaster(); r.set(new THREE.Vector3(x, 30, z), new THREE.Vector3(0, -1, 0)); return r; };
const plaques = (room) => room.children.filter((o) => o.userData.button !== undefined);
const cardRect = (p) => ({ x0: p.x - CARD_SIZE.w / 2, x1: p.x + CARD_SIZE.w / 2, z0: p.z - CARD_SIZE.h / 2, z1: p.z + CARD_SIZE.h / 2 });
const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const box = (p) => ({ x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z - p.d / 2, z1: p.z + p.d / 2 });
function clear(laid, avoid) {
	for (const p of laid) { for (const r of avoid) { assert.ok(!overlaps(box(p), r), `${p.id} clear of ${JSON.stringify(r)}`); } }
	laid.forEach((p, i) => laid.slice(i + 1).forEach((q) => assert.ok(!overlaps(box(p), box(q)), `${p.id} & ${q.id} apart`)));
}
const LIST = [{ id: "stop", label: "Stop" }, { id: "go", label: "Continue" }];
function watchFree(meshes) { // COUNTS WHAT A PLAQUE OWNS AS IT'S FREED: ITS TOP'S TEXTURE & MATERIAL, ITS GEOMETRY & ITS FOCUS FRAME'S
	const freed = { n: 0 };
	for (const m of meshes) { for (const x of [m.material[0].map, m.material[0], m.geometry, m.children[0].geometry]) { x.addEventListener("dispose", () => { freed.n++; }); } }
	return freed;
}

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

// TASK 23 S3 FIX ROUND 1, I1 (RULING T23-15): WHAT ELSE LIES ON THE DESK, IN ROOM SPACE, FROM THE CODE THAT PLACES IT. THE TAKEN PIECES: piles.js PILE_AREA & ITS 180° TURN;
// THE DECKS: A CARD'S FOOTPRINT AT DECK & GREEN_DECK
const DESK_THINGS = [PILE_AREA, { x0: -PILE_AREA.x1, x1: -PILE_AREA.x0, z0: -PILE_AREA.z1, z1: -PILE_AREA.z0 }, cardRect(DECK), cardRect(GREEN_DECK)];
const laidBoxes = (room) => plaques(room).map((m) => { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; return { x0: m.position.x + b.min.x, x1: m.position.x + b.max.x, z0: m.position.z + b.min.z, z1: m.position.z + b.max.z }; });
const clearOfDesk = (room) => { for (const b of laidBoxes(room)) { for (const r of DESK_THINGS) { assert.ok(!overlaps(b, r), `${JSON.stringify(b)} clear of ${JSON.stringify(r)}`); } } };

test("I1: plaques 'right' of a piece on the right half stay clear of the desk's things", () => {
	const { room, table } = setup();
	table.showButtons(LIST, { x: 10.5, z: -7.5, side: "right" });
	assert.equal(table.buttonCount(), 2);
	clearOfDesk(room);
});

test("I1: plaques 'right' of a mid-row card of a 9-card hand stay off the near taken pieces", () => {
	const { room, run, table } = setup();
	const v = view();
	v.players.w.moves = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, key: "move", piece: "n" }));
	table.set(v, {});
	run();
	table.showButtons(LIST, { x: 2.15, z: HAND_Z, side: "right" });
	assert.equal(table.buttonCount(), 2);
	clearOfDesk(room);
});

test("I1: a row 'below' a point just beyond either deck stays off the deck", () => {
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

// TASK 23 S3 FIX ROUND 2, N1 (RULING T23-17; THE CABLES LEFT THE ROOM, T23-21): THE BOOKS, FROM build_library.py build_props, IN ROOM SPACE (z = -bake y).
// THE BOOKS: THREE STACKED ROUND (35, bake y 21), THE BIGGEST 16 x 11 TURNED 0.10 RAD, SO x 35 ± 8.51, z -21 ± 6.27. THE DESK: DESK x -48 .. 48, bake y -32 .. 40
const BOOKS = { x0: 26.49, x1: 43.51, z0: -27.27, z1: -14.73 };
const DESK = { x0: -48, x1: 48, z0: -40, z1: 32 };
// FIX ROUND 3: THE MONITOR'S CABINET (build_library.py MON_W 17, FRONT AT MON_Y 22.5, 13.6 DEEP) & THE LAMP'S FOOT (RADIUS 4.4 AT (-35, bake y 25)), WHICH THE NEAREST-SPOT SEARCH CAN REACH
const MONITOR = { x0: -8.5, x1: 8.5, z0: -39.6, z1: -22.5 }, LAMP = { x0: -39.4, x1: -30.6, z0: -29.4, z1: -20.6 };
const laidAt = (room) => laidBoxes(room).map((b, i) => ({ id: `${i}`, x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, w: b.x1 - b.x0, d: b.z1 - b.z0 })); // THE PLAQUES AS THE ROOM HOLDS THEM
function clearOfAll(laid, avoid = []) { // CLEAR OF THE BOARD, WHAT ELSE IS ON THE DESK, THE BOOKS & avoid, & ALL ON THE DESK
	clear(laid, [BOARD_RECT, ...DESK_THINGS, BOOKS, MONITOR, LAMP, ...avoid]);
	for (const p of laid) {
		const b = box(p);
		assert.ok(b.x0 >= DESK.x0 && b.x1 <= DESK.x1 && b.z0 >= DESK.z0 && b.z1 <= DESK.z1, `${p.id} on the desk: ${JSON.stringify(b)}`);
	}
}

test("N1: plaques 'right' of a piece on the right half land clear & on the desk", () => {
	const { room, table } = setup();
	table.showButtons(LIST, { x: 10.5, z: -7.5, side: "right" });
	assert.equal(table.buttonCount(), 2);
	clearOfAll(laidAt(room));
});

test("N1: plaques 'right' of a piece far up the right half land clear & on the desk, two plaques or four long ones", (t) => {
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

test("N1: every piece's square, every side, one to four plaques: clear of everything & on the desk", (t) => {
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

test("N2: plaques 'left' of a mid-row card of Card Guy's 9-card row stay off the far taken pieces", () => {
	const row = Array.from({ length: 9 }, (_, i) => cardRect({ x: (i - 4) * 4.6, z: -HAND_Z }));
	const laid = buttonLayout(LIST, { x: -2.15, z: -HAND_Z, side: "left" }, [BOARD_RECT, ...DESK_AVOID, ...row]);
	clear(laid, [PILE_AREA, ...row]);
});

test("N3: a card moving elsewhere rebuilds nothing; a rebuild keeps the focused & hovered plaque", () => {
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

// TASK 23 S3 FIX ROUND 3, RULING T23-19: THE ASKED SIDE WHEN ITS CLEAR SPOT IS WITHIN ABOUT 6 OF THE ANCHOR, ELSE THE NEAREST CLEAR SPOT ON THE DESK. THE BOUNDS ARE task-23-S3-rereview-2.md's
// NEAREST CLEAR SPOTS (nearest.txt: ITS GAP, ANCHOR TO THE NEAREST PLAQUE EDGE, FOR THE ASKED SHAPE SLID ON A 0.25 GRID), PLUS 0.05 FOR ROUNDING
const gapTo = (laid, a) => Math.min(...laid.map((p) => { const b = box(p); return Math.hypot(Math.max(b.x0 - a.x, 0, a.x - b.x1), Math.max(b.z0 - a.z, 0, a.z - b.z1)); }));
const FOUR_LONG = [{ id: "a", label: "Discard the active (draw 1)" }, { id: "b", label: "Discard both (draw 1)" }, { id: "c", label: "With the card" }, { id: "x", label: "Cancel" }];
const PLAY = [{ id: "p", label: "Play" }, { id: "x", label: "Cancel" }];
const handRows = (n) => [HAND_Z, -HAND_Z].flatMap((z) => Array.from({ length: n }, (_, i) => cardRect({ x: (i - (n - 1) / 2) * 4.6, z })));

test("T23-19: far-right piece prompts land at the nearest clear spot, not across the desk", (t) => {
	const warn = t.mock.method(console, "warn", () => {});
	const cases = [ // [list, anchor z, cards (a hand of n each side), bound]
		[PLAY, -13.5, 0, 6], [PLAY, -13.5, 9, 6], // WITHOUT THE CABLES (T23-21) EVERY CASE KEEPS ITS ASKED RIGHT WITHIN PLAQUE_NEAR (6)
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

test("T23-19: an asked side clear within about 6 of the anchor keeps its side, though another is nearer", () => {
	const anchor = { x: 0, z: 25, side: "right" }, block = { x0: 0.1, x1: 3, z0: 20, z1: 30 }; // THE RIGHT PUSHED ABOUT 3.3 OUT; THE LEFT IS CLEAR AT 0.3
	const laid = buttonLayout(LIST, anchor, [block]);
	assert.ok(laid.every((p) => p.x - p.w / 2 >= block.x1), "still on the right, past what's in the way");
	assert.ok(gapTo(laid, anchor) <= 6);
	const far = buttonLayout(LIST, anchor, [{ x0: 0.1, x1: 8, z0: 20, z1: 30 }]); // THE RIGHT'S CLEAR SPOT 8 OUT: THE NEARER LEFT
	assert.ok(gapTo(far, anchor) < 1, `gap ${gapTo(far, anchor).toFixed(2)}`);
});

test("T23-20: a new list comes up unhovered; the same list laid again keeps its hover & focus", () => {
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
	table.showButtons([{ id: "b", label: "Bishop" }, { id: "x", label: "Back" }], { x: -6, z: HAND_Z, side: "below" }); // THE SAME LABELS, ANOTHER PROMPT'S ANCHOR (RE-REVIEW 3 m1)
	assert.deepEqual([lit(), framed()], [[], []], "another anchor: neither lit nor framed");
	table.focusButton(0);
	table.showButtons([{ id: "b", label: "Play" }, { id: "x", label: "Cancel" }], anchor);
	assert.deepEqual(framed(), [], "another list: no focus carried, so a held Enter can't press its Play");
});

test("re-review 3 m3: the same list, anchor & cards again lays nothing out (a blocked desk's search is slow)", (t) => {
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

test("M3: no clear place warns once per rebuild, not on every showButtons", (t) => {
	const warn = t.mock.method(console, "warn", () => {});
	const { table } = setup();
	const many = Array.from({ length: 40 }, (_, i) => ({ id: `b${i}`, label: "Stop" })); // A ROW WIDER THAN THE DESK
	table.showButtons(many, { x: 0, z: 25, side: "below" });
	table.showButtons(many, { x: 0, z: 25, side: "below" });
	assert.equal(warn.mock.callCount(), 1);
});

// TASK 23 CLOSING REVIEW, FIX ROUND 1 (I1, M1, RULING T23-24): THE PLAQUES LIE INSIDE THE DESK THE CAMERA SHOWS (buttonLayout's within: cardTable.js deskInView), SHIFTED ALONG
// & WRAPPED TO MORE ROWS WHEN TOO WIDE. THE END-TO-END CHECK CHAINS openingCamera -> deskInView -> plaqueAnchor -> buttonLayout WITH THE REAL LABELS (select.js promptButtons) & THE VIEW'S
// REAL CARD FOOTPRINTS, & PROJECTS EVERY PLAQUE CORNER (ON THE DESK & AT THE TOP OF ONE ON THE BAIZE) THROUGH THE CAMERA, AS THE REVIEW'S fuzz2.cjs
const inside = (laid, r) => laid.every((p) => { const b = box(p); return b.x0 >= r.x0 - 1e-5 && b.x1 <= r.x1 + 1e-5 && b.z0 >= r.z0 - 1e-5 && b.z1 <= r.z1 + 1e-5; }); // 1e-5: A MESH'S GEOMETRY IS 32-BIT
const LONG = [{ id: "a", label: "Discard your Pawn card & Knight card (the next one discarded draws 1)" }, { id: "b", label: "Discard your Pawn card & Bishop card (the next one discarded draws 1)" }, { id: "c", label: "Discard your Pawn card (draw 1)" }, { id: "x", label: "Cancel" }];

test("T23-24: a row past the view's side shifts inside it, on one line while it fits", () => {
	const within = { x0: -19, x1: 19, z0: -40, z1: 27 }, anchor = { x: -18.4, z: HAND_Z + CARD_SIZE.h / 2, side: "below" };
	const laid = buttonLayout(LIST, anchor, [BOARD_RECT, ...handRows(9)], within);
	assert.ok(!laid.blocked);
	assert.ok(inside(laid, within), JSON.stringify(laid.map(box)));
	assert.equal(new Set(laid.map((p) => p.z)).size, 1, "one row");
	const free = buttonLayout(LIST, anchor, [BOARD_RECT, ...handRows(9)]), dx = laid[0].x - free[0].x;
	assert.ok(dx > 0 && laid.every((p, i) => Math.abs(p.x - free[i].x - dx) < 1e-9 && p.z === free[i].z), "the same row, moved toward the middle");
	assert.ok(Math.abs(laid[0].x - laid[0].w / 2 - within.x0) < 1e-9, `slid flush to the view's side, not to the nearest-spot search's 0.25 grid: ${laid[0].x - laid[0].w / 2}`); // REVIEW N3
});

test("T23-24: a row wider than the view wraps to two rows, then to a column; in order, inside, clear of the cards", () => {
	const anchor = { x: 0, z: HAND_Z + CARD_SIZE.h / 2, side: "below" }, cards = handRows(9);
	const SHORT = [{ id: "a", label: "Knight" }, { id: "b", label: "Bishop" }, { id: "c", label: "Rook" }, { id: "x", label: "Cancel" }];
	for (const [list, width, rows] of [[LONG, 38, 2], [LONG, 20, 3], [SHORT, 5, 4]]) { // 38: BOTH PAIRS, THEN THE REST. 20: ONE LONG PLAQUE A ROW. 5: A COLUMN
		const within = { x0: -width / 2, x1: width / 2, z0: -40, z1: 32 };
		const laid = buttonLayout(list.map((b, i) => ({ ...b, id: LONG[i].id })), anchor, [BOARD_RECT, ...cards], within);
		assert.ok(!laid.blocked);
		assert.ok(inside(laid, within), `${width} wide: ${JSON.stringify(laid.map(box))}`);
		assert.equal(new Set(laid.map((p) => p.z.toFixed(6))).size, rows, `${width} wide: ${rows} rows`);
		assert.deepEqual(laid.map((p) => p.id), ["a", "b", "c", "x"]);
		clear(laid, cards);
	}
});

test("M1: the nearest-spot search stays inside the view too", () => {
	const duel = { player: "w", piece: "w12", step: "decide", round: 1, hands: { w: [null, null, null], b: [null, null, null] }, picked: { w: [], b: [] }, spades: { hands: { w: [null, null, null], b: [null, null, null] }, picked: { w: [], b: [] } } }; // THE SPADES SET UP: THE ROW'S RIGHT END AT x 15.95
	const cards = [...duelLayout(duel, "w").map(cardRect), cardRect(DUEL_STACK.mine), cardRect(DUEL_STACK.his)];
	const right = Math.max(...duelLayout(duel, "w").map((d) => d.x)) + CARD_SIZE.w / 2, within = { x0: -19, x1: 19, z0: -30, z1: 23.5 };
	const laid = buttonLayout(LIST, { x: right, z: HAND_Z, side: "right" }, [BOARD_RECT, ...DESK_AVOID, ...cards], within);
	assert.ok(!laid.blocked);
	assert.ok(inside(laid, within), JSON.stringify(laid.map(box)));
});

const CATALOG = { veto: { name: "Veto", rarity: "rare" }, foresight: { name: "Foresight", rarity: "common" }, "all-or-nothing": { name: "All or Nothing", rarity: "epic" }, shackles: { name: "Shackles", rarity: "common" }, hunger: { name: "Hunger", rarity: "common" } };
const gameView = (n, more = {}) => ({ you: "w", board: fromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), effects: [],
	players: { w: { king: true, kingSkulls: 2, moves: Array.from({ length: n }, (_, i) => ({ id: `m${i}`, key: "move", piece: "pnbrqk"[i % 6] })), actives: [{ id: "a1", key: "foresight" }], passive: { id: "p1", key: "veto" }, curses: [{ id: "k1", key: "shackles" }, { id: "k2", key: "hunger" }], spot: [], pile: { n: 0, top: null }, kept: null },
		b: { king: true, hand: { count: 9, shown: [] }, spot: [], pile: { n: 0, top: null }, kept: null } }, ...more });
const DUEL_UP = { round: 1, player: "w", piece: "w12", card: "all-or-nothing", step: "decide", hands: { w: [{ r: 9, s: "h" }, { r: 4, s: "d" }, null], b: [{ r: 3, s: "c" }, null, null] }, picked: { w: [0], b: [0] }, spades: null };
const footprints = (v) => [...tableSpots(v, { base: 0, layer: 0 }).values()].map(cardRect).concat(v.duel ? duelLayout(v.duel, v.you, v).map(cardRect) : []);
function promptCases() { // [what, view, at, turned, ask]
	const out = [];
	for (const n of [5, 6]) {
		const v = gameView(n), last = n - 1;
		for (const i of [0, last]) {
			out.push([`move m${i} pair`, v, { card: `m${i}` }, false, { pick: [{ type: "discard", cards: [`m${i}`, `m${(i + 1) % n}`] }, { type: "discard", cards: [`m${i}`] }] }]);
			out.push([`move m${i} two pairs`, v, { card: `m${i}` }, false, { pick: [{ type: "discard", cards: [`m${i}`, `m${(i + 1) % n}`] }, { type: "discard", cards: [`m${i}`, `m${(i + 2) % n}`] }, { type: "discard", cards: [`m${i}`] }] }]);
			out.push([`move m${i} alone`, v, { card: `m${i}` }, false, { pick: [{ type: "discard", cards: [`m${i}`] }] }]);
		}
		out.push(["active", v, { card: "a1" }, false, { pick: [{ type: "discard", cards: ["a1"] }] }]);
		out.push(["passive", v, { card: "p1" }, false, { pick: [{ type: "passive" }, { type: "discard", cards: ["p1"] }] }]);
		const dv = gameView(n, { duel: DUEL_UP });
		out.push(["duel stop", dv, { duel: true }, false, { pick: [{ type: "duel", stop: true }, { type: "duel", stop: false }], choosing: true }]);
		out.push(["duel knight", { ...dv, pending: { card: "all-or-nothing" } }, { duel: true }, false, { pick: [{ type: "choice", option: "n" }, { type: "choice", option: "b" }], choosing: true }]);
		for (const sq of ["a8", "h8", "a1", "h1", "e4"]) {
			for (const turned of [false, true]) { out.push([`skull ${sq}${turned ? " turned" : ""}`, v, { square: sq }, turned, { skull: { type: "move", card: "king", from: sq, to: sq } }]); }
		}
	}
	return out;
}

test("I1 & M1 (T23-24, T23-27): in the opening view at desktop, 4:3 & narrow portrait sizes (FOV 45 & 30) every plaque of a lifted card's free discards & the duel's lies on screen, or none is up", (t) => {
	t.mock.method(console, "warn", () => {});
	const SIZES = [[1920, 1080], [1440, 900], [1024, 768], [540, 1000], [700, 1000]], cases = promptCases();
	// THESE UNPINNED NARROW VIEWS SHOW UNDER 2.5 OF DESK BELOW THE HAND & NO OTHER CLEAR SPOT WIDE ENOUGH: A LIFTED CARD'S PROMPT LAYS NO PLAQUES & KEEPS ITS 2D BUTTONS (RULING T23-27)
	// SINCE THE USER'S PICKED OPENING VIEW (2026-11-25: THE BOTTOM ON THE LEATHER EDGE) THE WIDE DESKTOP VIEWS TOO: UNDER 2.8 OF DESK BELOW THE HAND IS NO ROOM
	const noRoom = (within) => within.z1 - (HAND_Z + CARD_SIZE.h / 2) < 2.8;
	let views = 0, kept2D = 0;
	for (const [w, h] of SIZES) {
		for (const fov of [45, 30]) {
			for (const black of [false, true]) {
				const spot = openingCamera({ fov, width: w, height: h, angle: black ? Math.PI : 0 });
				if (!spot) { continue; } // NO OPENING SPOT (T23-12): camera.js KEEPS ITS NORMAL VIEW
				views++;
				const cam = new THREE.PerspectiveCamera(fov, w / h, 0.1, 1000), room = new THREE.Group();
				room.rotation.y = black ? Math.PI : 0; // room.js turnRoom
				cam.position.set(spot.position.x, spot.position.y, spot.position.z);
				cam.lookAt(spot.target.x, spot.target.y, spot.target.z);
				const within = deskInView(cam, room);
				for (const [what, v, at, turned, ask] of cases) {
					if (turned !== black && at.square) { continue; } // A SQUARE'S ANCHOR IS FOR THE SIDE THE ROOM IS TURNED TO
					const list = S.promptButtons(ask, v, CATALOG).map(({ id, label }) => ({ id, label })), avoid = [BOARD_RECT, ...DESK_AVOID, ...footprints(v)];
					const where = `${what} @${w}x${h} fov ${fov}${black ? " black" : ""}`;
					if (at.card && noRoom(within)) { // THE TABLE ITSELF, ITS CARDS SET: NO PLAQUES, & showButtons false KEEPS flow.js's data-plaques OFF (THE 2D BUTTONS SHOW)
						const { room: r, table } = setup(undefined, () => within);
						table.set(v, { catalog: CATALOG });
						assert.equal(table.showButtons(list, plaqueAnchor(at, v, turned)), false, `${where}: plaques said up`);
						assert.equal(plaques(r).length, 0, `${where}: plaques laid`);
						kept2D++;
						continue;
					}
					const laid = buttonLayout(list, plaqueAnchor(at, v, turned), avoid, within);
					assert.ok(!laid.blocked, `${where}: blocked`);
					clear(laid, avoid);
					for (const p of laid) {
						for (const dx of [-1, 1]) for (const dz of [-1, 1]) for (const y of [DESK_Y, CARD_Y - 0.02 + 0.25]) {
							const q = room.localToWorld(new THREE.Vector3(p.x + dx * p.w / 2, y, p.z + dz * p.d / 2)).project(cam);
							assert.ok(Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1, `${where}: ${p.label} at ndc (${q.x.toFixed(2)}, ${q.y.toFixed(2)})`);
						}
					}
				}
			}
		}
	}
	assert.ok(views >= 16, `${views} opening views checked`);
	assert.ok(kept2D >= 4 * 8, `${kept2D} lifted-card prompts kept their 2D buttons`); // 2 VIEWS x 2 SIDES x 8 CARD CASES (n 5 & 6)
});

test("T23-24: the plaques keep their place when the camera moves; a new prompt, or relayButtons (a resize), lays them inside the view then", () => {
	let rect = { x0: -12, x1: 12, z0: -40, z1: 30 };
	const { room, table } = setup(undefined, () => rect);
	const anchor = { x: -16, z: HAND_Z + CARD_SIZE.h / 2, side: "below" }; // AN EMPTY TABLE
	table.showButtons(LONG, anchor);
	assert.ok(inside(laidAt(room), rect), `inside the view: ${JSON.stringify(laidBoxes(room))}`);
	const before = plaques(room);
	rect = { x0: 0, x1: 40, z0: -40, z1: 32 }; // THE CAMERA MOVED
	table.showButtons(LONG, { ...anchor }); // THE SAME PROMPT AGAIN (flow.js showPrompt RUNS ON EVERY REFRESH)
	assert.deepEqual(plaques(room), before, "they don't chase the camera");
	table.relayButtons();
	assert.ok(before.every((m) => !room.children.includes(m)), "a resize lays them again");
	assert.ok(inside(laidAt(room), rect));
	rect = { x0: -30, x1: -2, z0: -40, z1: 32 };
	table.showButtons(LONG.slice(1), anchor); // ANOTHER PROMPT
	assert.ok(inside(laidAt(room), rect));
	table.showButtons([]);
	table.relayButtons();
	assert.equal(table.buttonCount(), 0, "nothing to lay again");
});

test("T23-27: no clear place inside the view lays no plaques & says so (showButtons false: the 2D buttons stay); a resize or another prompt with room brings them back", (t) => {
	const warn = t.mock.method(console, "warn", () => {});
	const TINY = { x0: -2, x1: 2, z0: 24, z1: 25 }, ROOMY = { x0: -30, x1: 30, z0: -40, z1: 32 };
	let rect = TINY;
	const { room, table } = setup(undefined, () => rect);
	const anchor = { x: 0, z: 25, side: "below" };
	assert.equal(table.showButtons(LIST, anchor), false, "blocked in the view: none up");
	assert.equal(table.buttonCount(), 0);
	assert.equal(plaques(room).length, 0);
	assert.equal(table.showButtons(LIST, { ...anchor }), false);
	assert.equal(warn.mock.callCount(), 1, "warned once per rebuild");
	rect = ROOMY;
	assert.equal(table.showButtons(LIST, { ...anchor }), false, "the same prompt keeps its view (T23-24)");
	assert.equal(table.relayButtons(), true, "a resize with room: up");
	assert.equal(table.buttonCount(), 2);
	rect = TINY;
	assert.equal(table.relayButtons(), false, "a resize with none: taken away");
	assert.equal(plaques(room).length, 0);
	assert.equal(warn.mock.callCount(), 2);
	rect = ROOMY;
	assert.equal(table.showButtons(LONG.slice(2), anchor), true, "another prompt with room: up");
	assert.ok(inside(laidAt(room), rect));
	assert.equal(table.showButtons([]), false);
});

// FINAL RE-REVIEW 1, N2 (RULING T23-28): GIVEN THE CAMERA, EVERY PLAQUE LAID (ITS MESH'S BOX, BEVEL INCLUDED, NOT ITS HIDDEN FOCUS FRAME: REVIEW N4 AWAITS A RULING) PROJECTS INSIDE THE SCREEN, OR NONE IS UP
// & showButtons SAYS false (THE 2D BUTTONS SHOW). THE OPENING VIEW & THE REVIEW'S probe-orbit.cjs: IT ORBITED ABOUT ITS TARGET BEFORE THE PROMPT CAME UP
test("T23-28: in the opening view & orbited about its target, a prompt's plaques lie on screen, or none is up", (t) => {
	t.mock.method(console, "warn", () => {});
	let seed = 23, up = 0, orbitedUp = 0, shown2D = 0;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647), one = (a) => a[Math.floor(rnd() * a.length)], cases = promptCases(), UP = new THREE.Vector3(0, 1, 0);
	for (let i = 0; i < 300; i++) {
		const w = Math.round(500 + rnd() * 2600), h = Math.round(400 + rnd() * 1000), fov = one([45, 30]), black = rnd() < 0.5, az = one([0, 0, 15, -15, 30, -30, 45, -45, 60, -60]) * Math.PI / 180;
		const spot = openingCamera({ fov, width: w, height: h, angle: black ? Math.PI : 0 });
		if (!spot) { continue; }
		const cam = new THREE.PerspectiveCamera(fov, w / h, 0.1, 1000), target = new THREE.Vector3(spot.target.x, spot.target.y, spot.target.z);
		cam.position.set(spot.position.x, spot.position.y, spot.position.z).sub(target).applyAxisAngle(UP, az).add(target);
		cam.lookAt(target);
		const [what, v, at, , ask] = one(cases.filter((c) => !c[2].square || c[3] === black));
		const s = setup(undefined, () => deskInView(cam, s.room), cam);
		s.room.rotation.y = black ? Math.PI : 0; // room.js turnRoom
		s.table.set(v, { catalog: CATALOG });
		const said = s.table.showButtons(S.promptButtons(ask, v, CATALOG).map(({ id, label }) => ({ id, label })), plaqueAnchor(at, v, black));
		const where = `${what} @${w}x${h} fov ${fov}${black ? " black" : ""} orbited ${Math.round(az * 180 / Math.PI)}`;
		assert.equal(said, plaques(s.room).length > 0, `${where}: showButtons says what's up`);
		if (!said) { shown2D++; continue; }
		up++;
		if (az) { orbitedUp++; }
		s.room.updateMatrixWorld(true);
		for (const m of plaques(s.room)) {
			m.geometry.computeBoundingBox();
			const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
			for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
				const q = new THREE.Vector3(x, y, z).project(cam);
				assert.ok(Math.abs(q.x) <= 1 + 1e-6 && Math.abs(q.y) <= 1 + 1e-6, `${where}: ${m.userData.button} at ndc (${q.x.toFixed(3)}, ${q.y.toFixed(3)})`);
			}
		}
		s.table.dispose();
	}
	assert.ok(up >= 80 && orbitedUp >= 50 && shown2D > 0, `plaques up ${up} (orbited ${orbitedUp}), 2D ${shown2D}`); // NOT EVERY PROMPT SENT TO ITS 2D BUTTONS (80: THE USER'S CLOSER OPENING VIEW, 2026-11-25, LEAVES LESS DESK ON SCREEN)
});

// FINAL RE-REVIEW 2, R2-3: onScreen'S |z| <= 1 (IN FRONT OF THE CAMERA). A CAMERA LOOKING STRAIGHT AWAY FROM THE PLAQUES SEES THEIR CORNERS MIRRORED INSIDE |x|, |y| <= 1, BUT BEHIND IT
test("R2-3: a camera looking away from where the plaques would lie lays none (the 2D buttons show); turned toward them, they're up", () => {
	const cam = new THREE.PerspectiveCamera(45, 1.6, 0.1, 1000), s = setup(undefined, () => ({ x0: -100, x1: 100, z0: -100, z1: 100 }), cam); // A VIEW THAT ALLOWS ANY LAYOUT: ONLY THE PROJECTION DECIDES
	cam.position.set(12, 2, 40);
	cam.lookAt(12, 2, 100); // AWAY FROM THE BOARD, THE PLAQUES ABOUT 48 BEHIND
	assert.equal(s.table.showButtons(LIST, { x: 10.5, z: -7.5, side: "right" }), false, "behind the camera: not up");
	assert.equal(plaques(s.room).length, 0);
	cam.lookAt(12, 0, -7.5);
	assert.equal(s.table.showButtons(LIST.slice(0, 1), { x: 10.5, z: -7.5, side: "right" }), true, "in front: up"); // ANOTHER PROMPT: A FRESH LAYOUT
});

test("M2: a plaque on the baize lies on it; one off the baize lies on the desk, not floating", () => {
	const { room, table } = setup();
	const bottom = (m) => { m.geometry.computeBoundingBox(); return m.position.y + m.geometry.boundingBox.min.y; };
	table.showButtons(LIST, { x: 10.5, z: -7.5, side: "right" }); // BESIDE THE BOARD, ON THE BAIZE (x, z INSIDE ±21.2)
	for (const m of plaques(room)) { assert.ok(Math.abs(bottom(m) - (CARD_Y - 0.02)) < 1e-9, `on the baize: ${bottom(m)}`); }
	table.showButtons(LIST, { x: 0, z: 25, side: "below" }); // PAST THE BAIZE & ITS LEATHER EDGE (±22)
	assert.ok(plaques(room).every((m) => Math.abs(bottom(m) - DESK_Y) < 1e-9), `on the desk: ${plaques(room).map(bottom)}`);
	table.showButtons([{ id: "s", label: "Stop" }], { x: 0, z: 21.3, side: "below" }); // ON THE LEATHER EDGE (21.2 .. 22) ONLY
	assert.ok(Math.abs(bottom(plaques(room)[0]) - (DESK_Y + 0.1)) < 1e-9, `on the leather: ${bottom(plaques(room)[0])}`);
});
