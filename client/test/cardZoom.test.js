// Task 21a B: a hand ability card clicked or tapped zooms (the camera frames it as an opened pile), the keys' pick & a move card lift (an ability card with its readable copy), a hold past the threshold drags,
// & a left press on any card (the table's, both decks, the promotion cards) keeps the camera still. createCardTable with real three.js in node, the harness of discardList.test.js (a stub DOM, a stand-in
// card template, the animations stepped by hand), & the pure decisions pointer.js & flow.js take (select.js handRead, liftedCard, keyPlan; hoverRules.js cameraFree). Their wiring is untested here
const { test } = require("node:test");
const assert = require("node:assert/strict");

global.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {} };
const appended = []; // WHAT THE TABLE PUT ON THE PAGE: ITS SCREEN READER LINE & THE LIFTED CARD'S READABLE COPY (showPreview)
global.document = {
	createElement(tag) {
		const el = { tag, width: 0, height: 0, textContent: "", setAttribute(k, v) { this[k] = v; }, remove() { this.removed = true; } };
		if (tag === "canvas") { const ctx = new Proxy({}, { get: (o, k) => (k === "measureText" ? (t) => ({ width: String(t).length }) : k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } }); el.getContext = () => ctx; }
		return el;
	},
	body: { append(el) { appended.push(el); } },
};
const copies = () => appended.filter((el) => el.className === "cardPreview" && !el.removed).map((el) => el["aria-label"]); // THE READABLE COPIES ON THE PAGE
const CATALOG = { stronghold: { name: "Stronghold", kind: "active", text: "Shields a piece" }, veto: { name: "Veto", kind: "passive", text: "Stops a card" }, shackles: { name: "Shackles", kind: "curse", text: "Binds a piece" } };
const THREE = require("../../node_modules/three/build/three.module.js"); // THE SAME COPY cardTable.js IMPORTS
const { createCardTable } = require("../src/js/gameplay/three/cardTable.js");
const { createAnimations } = require("../src/js/gameplay/three/animations.js");
const { tableSpots, duelSpot, columnBox, PILES, DISCARD, DUEL_STACK } = require("../src/js/gameplay/three/tableLayout.js");
const { CARD_SIZE, DECK } = require("../src/js/gameplay/three/cardLayout.js");
const { isDrag, DRAG_PX, TOUCH_DRAG_PX, DRAG_HOLD_MS } = require("../src/js/gameplay/three/constants.js");
const { cameraFree } = require("../src/js/gameplay/three/hoverRules.js");
const S = require("../src/js/gameplay/cards/select.js");

function template() { // A CARD: ITS FACE ON TOP LOOKING UP, ITS BACK UNDER IT LOOKING DOWN
	const g = new THREE.Group();
	const face = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ name: "cardFace" }));
	face.position.y = 0.03;
	const back = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ name: "cardBack" }));
	g.add(face, back);
	return g;
}
function setup() {
	const room = new THREE.Group(), animations = createAnimations(() => {}), framed = [], told = [];
	let now = 0;
	const table = createCardTable({ template: template(), room, animations, requestRender() {}, frame: (box, zoom = null) => { framed.push(box); told.push(zoom); } });
	const run = () => { while (animations.step((now += 16))) { /* TO THE END */ } room.updateMatrixWorld(true); };
	return { room, table, framed, told, run };
}
const rayDown = (x, z) => { const r = new THREE.Raycaster(); r.set(new THREE.Vector3(x, 30, z), new THREE.Vector3(0, -1, 0)); return r; };
const move = (id) => ({ id, key: "move", piece: "p" });
// YOUR HAND: THE KING CARD, A MOVE CARD, AN ACTIVE, THE PASSIVE, A CURSE. CARD GUY'S: 2 FACE DOWN. A PLACED PASSIVE EACH, AN ACTIVE IN EFFECT EACH, BOTH DISCARD PILES
const view = (w = {}) => ({
	you: "w", effects: [{ id: "e1", owner: "w", card: { id: "e1", key: "spite" } }, { id: "e2", owner: "b", card: { id: "e2", key: "veto" } }], piled: [{ player: "b", card: { down: true } }, { player: "w", card: move("m6") }],
	players: {
		w: { king: true, moves: [move("m1")], actives: [{ id: "a1", key: "stronghold" }], passive: { id: "p1", key: "veto" }, curses: [{ id: "x1", key: "shackles" }], spot: [{ id: "s1", key: "fog-of-war" }], pile: { n: 1, top: move("m6") }, kept: null, ...w },
		b: { king: false, hand: { count: 2, shown: [] }, spot: [{ id: "s2", key: "swap" }], pile: { n: 1, top: { down: true } }, kept: null },
	},
});
const spots = (v) => tableSpots(v, { base: 0, layer: 0 });
const footprint = (s) => ({ x0: s.x - CARD_SIZE.w / 2, x1: s.x + CARD_SIZE.w / 2, z0: s.z - CARD_SIZE.h / 2, z1: s.z + CARD_SIZE.h / 2 });
const rootAt = (room, s) => room.children.find((o) => o.type === "Group" && Math.abs(o.position.x - s.x) < 1e-6 && Math.abs(o.position.z - s.z) < 1e-6);

test("a press is a drag once it moved past the threshold & a mouse held it DRAG_HOLD_MS; a finger goes by distance only (the pieces' rule, now the cards' too)", () => {
	assert.equal(isDrag(1, 500, false), false, "a mouse that jitters a pixel, however long: a click");
	assert.equal(isDrag(DRAG_PX + 2, DRAG_HOLD_MS - 20, false), false, "a quick click that jitters past the threshold: still a click");
	assert.equal(isDrag(DRAG_PX + 2, DRAG_HOLD_MS + 10, false), true, "held & moved: a drag");
	assert.equal(isDrag(DRAG_PX, DRAG_HOLD_MS + 10, false), false, "on the threshold: not past it");
	assert.equal(isDrag(TOUCH_DRAG_PX - 2, 1000, true), false, "a finger's wobble: a tap");
	assert.equal(isDrag(TOUCH_DRAG_PX + 1, 0, true), true, "a finger past its threshold drags at once");
});

test("a click on an ability card (an active, the passive, a curse) zooms in on it; a move card & the King card lift", () => {
	assert.deepEqual(["active", "passive", "curse", "move", "king"].map(S.zooms), [true, true, true, false, false]);
});

test("a lifted card floats high, an ability card too, & one with rules text shows its readable copy beside the board (the keys' pick, unchanged); a move card shows none", () => {
	const { room, table, run } = setup(), v = view(), at = spots(v);
	table.set(v, { catalog: CATALOG });
	run();
	const down = new Map(["m1", "king", "a1", "p1", "x1"].map((id) => [id, rootAt(room, at.get(`w:${id}`)).position.y]));
	const y = (id) => rootAt(room, at.get(`w:${id}`)).position.y - down.get(id);
	const copy = { m1: [], king: [], a1: ["Stronghold, Active: Shields a piece"], p1: ["Veto, Passive: Stops a card"], x1: ["Shackles, Curse: Binds a piece"] };
	for (const id of down.keys()) {
		table.lift(id);
		run();
		assert.ok(y(id) > 1, `${id} lifted: ${y(id)}`);
		assert.deepEqual(copies(), copy[id], `${id}'s readable copy`);
	}
	table.lift(null);
	assert.deepEqual(copies(), [], "put down: the copy goes");
	table.lift("a1");
	table.dispose();
	assert.deepEqual(copies(), [], "the table taken away: the copy too");
});

test("an active dropped on its place for its targets lies there & shows its readable copy while it's the lifted one (the drop's target pick, unchanged)", () => {
	const { room, table, run } = setup(), v = view(), spot = PILES.mineSpot;
	const onSpot = () => room.children.filter((o) => o.type === "Group" && Math.abs(o.position.x - spot.x) < 1e-6 && Math.abs(o.position.z - spot.z) < 1e-6).length;
	table.set(v, { catalog: CATALOG });
	run();
	assert.equal(onSpot(), 1, "Fog of War in effect");
	assert.equal(table.grab({ id: "a1" }, ["spot"]), true);
	table.follow(rayDown(spot.x, spot.z));
	assert.deepEqual(table.release().place, { side: "mine", place: "spot" });
	table.settle(true);
	table.lift("a1"); // flow.js: onPlace, ITS TARGETS BEING PICKED
	run();
	assert.equal(onSpot(), 2, "it lies on the active spot");
	assert.deepEqual(copies(), ["Stronghold, Active: Shields a piece"]);
	table.dispose();
});

test("zoom frames the hand card's footprint as an opened pile is framed, & zoom(null) sends the camera back", () => {
	const { table, framed, run } = setup(), v = view(), at = spots(v);
	table.set(v, {});
	run();
	const before = framed.length;
	table.zoom("a1");
	assert.equal(table.zoomed(), "a1");
	assert.deepEqual(framed.slice(before), [footprint(at.get("w:a1"))]);
	table.set(v, {}); // A REFRESH THAT CHANGES NOTHING LEAVES THE CAMERA ALONE
	assert.equal(framed.length, before + 1);
	table.zoom(null);
	assert.equal(table.zoomed(), null);
	assert.equal(framed.at(-1), null, "the camera goes back");
	table.zoom("b:#0"); // NOT ONE OF YOUR HAND CARDS: NOTHING
	assert.equal(table.zoomed(), null);
	table.dispose();
});

test("the zoom ends when its card leaves the hand, a pile opens, a duel is dealt or the card is dragged", () => {
	const ended = (why, act) => {
		const { table, framed, run } = setup(), v = view();
		table.set(v, {});
		run();
		table.zoom("a1");
		act(table, v);
		assert.equal(table.zoomed(), null, why);
		assert.notDeepEqual(framed.at(-1), footprint(spots(v).get("w:a1")), `${why}: the camera no longer frames it`);
		table.dispose();
	};
	ended("played", (table) => table.set(view({ actives: [] }), {}));
	ended("a pile opened", (table) => table.togglePile("mine"));
	ended("a duel dealt", (table) => table.dealDuel({ player: "w", piece: "w12", card: "all-or-nothing", step: "pick", wins: 0, round: 1, hands: { w: [null, null, null], b: [null, null, null] }, picked: { w: [], b: [] }, spades: null }));
	ended("dragged", (table, v) => { const s = spots(v).get("w:a1"); assert.equal(table.grab({ id: "a1" }, ["spot"]), true); table.follow(rayDown(s.x, s.z - 8)); });
	const { table, framed, run } = setup(), v = view();
	table.set(v, {});
	run();
	table.zoom("a1");
	table.togglePile("mine");
	assert.deepEqual(framed.at(-1), columnBox("mine", 1), "the opened pile has the frame");
	table.dispose();
});

test("covers: a ray over any card on the table, the ones hit() leaves out too, blocks the camera; the bare desk doesn't", () => {
	const { table, run } = setup(), v = view(), at = spots(v), over = (x, z) => table.covers(rayDown(x, z));
	table.set(v, {});
	run();
	for (const key of ["w:m1", "w:a1", "b:#0", "b:#1", "w:e1", "b:e2", "w:s1", "b:s2"]) { assert.equal(over(at.get(key).x, at.get(key).z), true, key); }
	assert.equal(table.hit(rayDown(at.get("b:#0").x, at.get("b:#0").z)), null, "Card Guy's hand: no hit, still covered");
	assert.equal(over(DISCARD.mine.x, DISCARD.mine.z), true, "your discard pile");
	assert.equal(over(DISCARD.his.x, DISCARD.his.z), true, "Card Guy's, face down");
	assert.equal(over(0, 0), false, "the board's middle: no card");
	assert.equal(over(PILES.mine.x, PILES.mine.z + 12), false, "the desk past a shut pile");
	table.togglePile("discard");
	run();
	const list = tableSpots(v, { open: "discard", base: 0, layer: 0 }).get("log:0");
	assert.equal(over(list.x, list.z), true, "the discard list's hidden card, painted as a back");
	table.togglePile(null);
	run();
	table.dealDuel({ player: "w", piece: "w12", card: "all-or-nothing", step: "pick", wins: 0, round: 1, hands: { w: [null, null, null], b: [null, null, null] }, picked: { w: [], b: [] }, spades: null });
	run();
	const his = duelSpot("his", "round", 0);
	assert.equal(table.hit(rayDown(his.x, his.z)), null, "Card Guy's duel card: never picked");
	assert.equal(over(his.x, his.z), true, "...still covered");
	assert.equal(table.hit(rayDown(DUEL_STACK.mine.x, DUEL_STACK.mine.z)), null, "your stacked hand: no hit during a duel");
	assert.equal(over(DUEL_STACK.mine.x, DUEL_STACK.mine.z), true, "...still covered");
	assert.equal(over(at.get("w:e1").x, at.get("w:e1").z), true, "a pile during a duel");
	table.dispose();
});

test("an ability card clicked or tapped is zoomed in on to be read & never lifted; the keys' pick & a move card or the King card lift", () => {
	const at = (kind, keys) => S.handRead({ kind, keys, showing: false, duel: false, promoting: false });
	for (const kind of ["active", "passive", "curse"]) {
		assert.deepEqual(at(kind, false), { read: true, zoom: true }, `${kind}, a click or a tap`);
		assert.deepEqual(at(kind, true), { read: false, zoom: false }, `${kind}, the keys`);
	}
	for (const kind of ["move", "king"]) { for (const keys of [false, true]) { assert.deepEqual(at(kind, keys), { read: false, zoom: false }, `${kind}, keys ${keys}`); } }
});

test("the zoom reads a card whoever's turn it is (the turn isn't asked), not while an answer's steps play, a card duel is on or the promotion cards are out", () => {
	const free = { kind: "active", keys: false, showing: false, duel: false, promoting: false };
	assert.deepEqual(S.handRead(free), { read: true, zoom: true });
	for (const busy of ["showing", "duel", "promoting"]) { assert.deepEqual(S.handRead({ ...free, [busy]: true }), { read: true, zoom: false }, busy); } // STILL READ: NOT LIFTED, NO "CAN'T BE PLAYED"
});

test("the card the table lifts: the one being played, unless a click or tap picked it to be read; dropped on its place for its targets it's lifted (its readable copy shows)", () => {
	const pick = (card) => ({ card, actions: [], picks: [] });
	assert.equal(S.liftedCard(pick("a1"), null, null), "a1", "the keys' pick");
	assert.equal(S.liftedCard(pick("a1"), null, "a1"), null, "a click or a tap: zoomed in on, not lifted");
	assert.equal(S.liftedCard(pick("m1"), null, "a1"), "m1", "a move card picked since");
	assert.equal(S.liftedCard(pick("a1"), "a1", "a1"), "a1", "then dragged to the active spot: its targets are picked");
	assert.equal(S.liftedCard(null, "a1", null), "a1", "its play on its way");
	assert.equal(S.liftedCard(pick(null), null, null), null, "a choice, the drop buttons");
	assert.equal(S.liftedCard(null, null, "a1"), null);
});

test("the camera: a left mouse press on a piece or on any card never moves it; a right press, scroll & a finger do over them; at the monitor nothing does", () => {
	const free = (p) => cameraFree({ idle: true, left: true, piece: false, card: false, ...p });
	assert.equal(free({}), true, "a left press on the bare desk or board pans");
	assert.equal(free({ card: true }), false, "on a card: the table's, a deck, a promotion card");
	assert.equal(free({ piece: true }), false, "on a piece");
	assert.equal(free({ left: false, card: true }), true, "a right press or a finger over a card");
	assert.equal(free({ idle: false }), false, "at the monitor");
});

test("covers: both decks are table cards for the camera, the green deck & the red one baked into the room; neither is picked", () => {
	const { table, run } = setup(), v = view();
	table.set(v, {});
	run();
	for (const [name, x] of [["the green deck", -DECK.x], ["the red deck", DECK.x]]) {
		assert.equal(table.covers(rayDown(x, DECK.z)), true, name);
		assert.equal(table.hit(rayDown(x, DECK.z)), null, `${name}: no hit`);
	}
	const side = new THREE.Raycaster(new THREE.Vector3(DECK.x - 20, DECK.y - 0.3, DECK.z), new THREE.Vector3(1, 0, 0)); // LOW ACROSS THE DESK: THE RED DECK'S SIDE, UNDER ITS TOP
	assert.equal(table.covers(side), true, "the red deck's side");
	const greenSide = new THREE.Raycaster(new THREE.Vector3(-DECK.x - 10, DECK.y - 0.3, DECK.z), new THREE.Vector3(1, 0, 0)); // THE GREEN DECK IS BAKED TOO (TASK 23): ITS SIDE, UNDER ITS TOP, FROM THE BOARD'S SIDE (AWAY FROM THE RED DECK)
	assert.equal(table.covers(greenSide), true, "the green deck's side");
	table.dispose();
});

test("Escape ends a zoom before it opens the menu, as it closes a pile; a pick goes down first", () => {
	const plan = (k = {}) => S.keyPlan({ key: "Escape", on: true, yours: true, ...k });
	assert.equal(plan({ zoomed: true }), "hand", "zoomed: the hand ends it");
	assert.equal(plan({ zoomed: true, yours: false }), "hand", "off the turn too");
	assert.equal(plan({ zoomed: true, picked: true }), "hand");
	assert.equal(plan(), "page", "nothing to end: the menu");
});

test("the table tells its framer which hand card is zoomed in on, & null when the zoom ends (flow.js: Escape, a prompt button & a play end it)", () => {
	const { table, told, run } = setup(), v = view();
	table.set(v, {});
	run();
	table.zoom("a1");
	assert.equal(told.at(-1), "a1");
	table.zoom(null);
	assert.equal(told.at(-1), null);
	table.zoom("a1");
	table.togglePile(null); // flow.js endZoom: NO PILE OPEN, SO ONLY THE ZOOM ENDS
	assert.equal(told.at(-1), null);
	assert.equal(table.open(), null);
	table.zoom("a1");
	table.togglePile("mine");
	assert.equal(told.at(-1), null, "a pile opened: it has the frame");
	table.togglePile(null);
	table.zoom("a1");
	assert.equal(told.at(-1), "a1");
	table.dispose();
	assert.equal(told.at(-1), null, "the table taken away");
});
