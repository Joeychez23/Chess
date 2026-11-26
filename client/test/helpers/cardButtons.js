// cardButtons.js: what every cardButtons-*.test.js shares. The canvas-recording document & window stubs, set BEFORE three.js & the card table load,
// the table setup with real three.js in node, & the box helpers. Required first, right after node:test & node:assert
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
const THREE = require("../../../node_modules/three/build/three.module.js"); // THE SAME COPY cardTable/ IMPORTS
const { createCardTable, deskInView } = require("../../src/js/gameplay/three/cardTable/index.js");
const { createAnimations } = require("../../src/js/gameplay/three/animations.js");
const { buttonLayout, plaqueAnchor, tableSpots, duelLayout, DUEL_STACK, BOARD_RECT, DESK_AVOID, HAND_Z } = require("../../src/js/gameplay/three/cardTable/tableLayout.js");
const { CARD_SIZE, CARD_Y, DECK, GREEN_DECK } = require("../../src/js/gameplay/three/cardLayout.js");
const { openingCamera } = require("../../src/js/gameplay/three/camera/openingCamera.js");
const { DESK_Y } = require("../../src/js/gameplay/three/constants.js");
const S = require("../../src/js/gameplay/cards/select.js");
const { fromFen } = require("../../../cards-engine/board.js");
const { PILE_AREA } = require("../../src/js/gameplay/three/cardTable/takenPiles.js");

function template() { // A CARD: ITS FACE ON TOP LOOKING UP, ITS BACK UNDER IT LOOKING DOWN
	const g = new THREE.Group();
	const face = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ name: "cardFace" }));
	face.position.y = 0.03;
	const back = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ name: "cardBack" }));
	g.add(face, back);
	return g;
}
function setup(still, inView, camera) {
	const room = new THREE.Group(), animations = createAnimations(() => {});
	let now = 0;
	const table = createCardTable({ template: template(), room, animations, requestRender() {}, still, inView, camera });
	const run = () => { while (animations.step((now += 16))) { /* TO THE END */ } room.updateMatrixWorld(true); };
	const step = (ms) => { for (const end = now + ms; now < end;) { animations.step((now += 16)); } };
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

// WHAT ELSE LIES ON THE DESK, IN ROOM SPACE, FROM THE CODE THAT PLACES IT. THE TAKEN PIECES: takenPiles.js PILE_AREA & ITS 180° TURN;
// THE DECKS: A CARD'S FOOTPRINT AT DECK & GREEN_DECK
const DESK_THINGS = [PILE_AREA, { x0: -PILE_AREA.x1, x1: -PILE_AREA.x0, z0: -PILE_AREA.z1, z1: -PILE_AREA.z0 }, cardRect(DECK), cardRect(GREEN_DECK)];
const laidBoxes = (room) => plaques(room).map((m) => { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; return { x0: m.position.x + b.min.x, x1: m.position.x + b.max.x, z0: m.position.z + b.min.z, z1: m.position.z + b.max.z }; });
const laidAt = (room) => laidBoxes(room).map((b, i) => ({ id: `${i}`, x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, w: b.x1 - b.x0, d: b.z1 - b.z0 })); // THE PLAQUES AS THE ROOM HOLDS THEM
const handRows = (n) => [HAND_Z, -HAND_Z].flatMap((z) => Array.from({ length: n }, (_, i) => cardRect({ x: (i - (n - 1) / 2) * 4.6, z })));

module.exports = {
	THREE, deskInView, buttonLayout, plaqueAnchor, tableSpots, duelLayout, DUEL_STACK, BOARD_RECT, DESK_AVOID, HAND_Z, CARD_SIZE, CARD_Y, DECK, GREEN_DECK, openingCamera, DESK_Y, S, fromFen, PILE_AREA,
	setup, view, rayDown, plaques, cardRect, overlaps, box, clear, LIST, watchFree, DESK_THINGS, laidBoxes, laidAt, handRows,
};
