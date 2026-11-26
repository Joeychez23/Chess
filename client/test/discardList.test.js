// The discard list on the real table (Task 21a A): createCardTable with real three.js in node, the harness of cardTable-duel.test.js (a stub DOM, a stand-in card template, the animations stepped by hand)
const { test } = require("node:test");
const assert = require("node:assert/strict");

global.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {} };
global.document = {
	createElement(tag) {
		if (tag !== "canvas") { return { setAttribute() {}, remove() {}, textContent: "" }; }
		const canvas = { width: 0, height: 0, rects: [] }, ctx = new Proxy({ clearRect: () => { canvas.rects = []; }, fillRect: (...r) => canvas.rects.push([ctx.fillStyle, ...r]) }, { get: (o, k) => (k === "measureText" ? (t) => ({ width: String(t).length }) : k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } }); // rects: WHAT ITS LAST PAINT FILLED
		canvas.getContext = () => ctx;
		return canvas;
	},
	body: { append() {} },
};
const THREE = require("../../node_modules/three/build/three.module.js"); // THE SAME COPY cardTable.js IMPORTS
const { createCardTable } = require("../src/js/gameplay/three/cardTable.js");
const { createAnimations } = require("../src/js/gameplay/three/animations.js");
const { DISCARD, columnBox, tableSpots } = require("../src/js/gameplay/three/tableLayout.js");
const { CARD_BACK, CARD_LIGHT } = require("../src/js/gameplay/three/cards.js");
const { GOLD } = require("../src/js/gameplay/three/cardLayout.js");

function template() { // A CARD: ITS FACE ON TOP LOOKING UP, ITS BACK UNDER IT LOOKING DOWN
	const g = new THREE.Group();
	const face = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ name: "cardFace" }));
	face.position.y = 0.03;
	const back = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ name: "cardBack" }));
	g.add(face, back);
	return g;
}
const rayDown = (x, z) => { const r = new THREE.Raycaster(); r.set(new THREE.Vector3(x, 30, z), new THREE.Vector3(0, -1, 0)); return r; };
const move = (id) => ({ id, key: "move", piece: "p" });
const LIST = { kind: "pile", pile: "discard", id: null };

test("either discard pile, face-down top too, hits as the discard list; togglePile opens it beside them, framed, & again closes it, the table as it was (the taps that call it are pointer.js's, untested here)", () => {
	const room = new THREE.Group(), animations = createAnimations(() => {}), framed = [];
	let now = 0;
	const table = createCardTable({ template: template(), room, animations, requestRender() {}, frame: (box) => framed.push(box) });
	const run = () => { while (animations.step((now += 16))) { /* TO THE END */ } room.updateMatrixWorld(true); };
	const view = {
		you: "w", effects: [], piled: [{ player: "b", card: { down: true } }, { player: "w", card: move("m6") }, { player: "w", card: move("m5") }],
		players: { w: { king: true, moves: [], actives: [], passive: null, curses: [], spot: [], pile: { n: 2, top: move("m6") }, kept: null }, b: { king: true, hand: { count: 0, shown: [] }, spot: [], pile: { n: 1, top: { down: true } }, kept: null } },
	};
	table.set(view, {});
	run();
	assert.deepEqual(table.hit(rayDown(DISCARD.mine.x, DISCARD.mine.z)), LIST);
	assert.deepEqual(table.hit(rayDown(DISCARD.his.x, DISCARD.his.z)), LIST, "Card Guy's face-down top");
	const before = room.children.length;
	table.togglePile("discard");
	run();
	assert.equal(table.open(), "discard");
	assert.equal(room.children.length, before + 3, "the 3 cards of the list laid out");
	assert.deepEqual(framed.at(-1), columnBox("discard", 3));
	assert.deepEqual(table.hit(rayDown(39.2, -6.3)), LIST, "the list's newest, a back");
	assert.deepEqual(table.hit(rayDown(43.8, -6.3)), LIST, "the next, face up");
	table.togglePile("discard");
	run();
	assert.equal(table.open(), null);
	assert.equal(room.children.length, before);
	assert.equal(framed.at(-1), null, "the camera goes back");
	table.dispose();
});

test("a hidden card of the opened list lies face up, its face painted as its back with its owner's name bar (Card Guy's: along the top), untinted as the piles' backs", () => {
	const room = new THREE.Group(), animations = createAnimations(() => {});
	let now = 0;
	const table = createCardTable({ template: template(), room, animations, requestRender() {} });
	const view = {
		you: "w", effects: [], piled: [{ player: "b", card: { down: true } }, { player: "w", card: move("m6") }],
		players: { w: { king: true, moves: [], actives: [], passive: null, curses: [], spot: [], pile: { n: 1, top: move("m6") }, kept: null }, b: { king: true, hand: { count: 0, shown: [] }, spot: [], pile: { n: 1, top: { down: true } }, kept: null } },
	};
	table.set(view, {});
	table.togglePile("discard");
	while (animations.step((now += 16))) { /* TO THE END */ }
	const at = tableSpots(view, { open: "discard", base: 0, layer: 0 }), card = (key) => room.children.find((o) => o.position.x === at.get(key).x && o.position.z === at.get(key).z);
	const back = card("log:0"), face = back.children[0], rects = face.material.map.image.rects; // THE TEMPLATE'S FIRST CHILD IS ITS FACE
	assert.equal(Math.abs(back.rotation.z), 0, "not turned over: a turned-over card shows the plain back, no bar");
	assert.deepEqual(rects.map((r) => r[0]), [`#${CARD_BACK.toString(16).padStart(6, "0")}`, GOLD]);
	assert.ok(rects[1][2] < face.material.map.image.height / 2, "Card Guy's bar along the top");
	assert.deepEqual([face.material.color.getHex(), card("log:1").children[0].material.color.getHex()], [0xFFFFFF, CARD_LIGHT]); // THE FACE-UP ONES KEEP THE TABLE'S TINT
	table.dispose();
});

test("the keyboard's discard stop frames the player's own pile top while it has a card, else Card Guy's, whichever top the table made first", () => {
	const room = new THREE.Group(), animations = createAnimations(() => {});
	let now = 0;
	const table = createCardTable({ template: template(), room, animations, requestRender() {} }), frame = room.children[0]; // THE TABLE'S FIRST CHILD: THE KEYBOARD'S GOLD FRAME
	const view = (mine) => ({ you: "w", effects: [], piled: [], players: { w: { king: true, moves: [], actives: [], passive: null, curses: [], spot: [], pile: mine, kept: null }, b: { king: true, hand: { count: 0, shown: [] }, spot: [], pile: { n: 1, top: { down: true } }, kept: null } } });
	const show = (mine) => { table.set(view(mine), { focusPile: "discard" }); while (animations.step((now += 16))) { /* TO THE END */ } };
	show({ n: 0, top: null });
	assert.ok(frame.visible);
	assert.deepEqual([frame.position.x, frame.position.z], [DISCARD.his.x, DISCARD.his.z], "yours empty: Card Guy's");
	show({ n: 1, top: move("m1") }); // YOUR TOP IS MADE AFTER CARD GUY'S
	assert.deepEqual([frame.position.x, frame.position.z], [DISCARD.mine.x, DISCARD.mine.z], "yours");
	table.dispose();
});
