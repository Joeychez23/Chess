// Task 24 S5: duel cards go to & from the green deck by DUEL_WAYPOINT, off the board (Task 20 S2 review M4). Real three.js in node, a stub DOM, the animation runner stepped by hand (as cardTable-duel.test.js)
const { test } = require("node:test");
const assert = require("node:assert/strict");

global.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {} };
global.document = {
	createElement(tag) {
		if (tag !== "canvas") { return { setAttribute() {}, remove() {}, textContent: "" }; }
		return { width: 0, height: 0, getContext: () => new Proxy({}, { get: (o, k) => (k === "measureText" ? (t) => ({ width: String(t).length }) : k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } }) };
	},
	body: { append() {} },
};
const THREE = require("../../node_modules/three/build/three.module.js");
const { createCardTable, DUEL_OUT, DUEL_WAYPOINT, duelPath } = require("../src/js/gameplay/three/cardTable.js");
const { pileSpots } = require("../src/js/gameplay/three/piles.js");
const { createAnimations } = require("../src/js/gameplay/three/animations.js");
const { duelSpot, BOARD_RECT } = require("../src/js/gameplay/three/tableLayout.js");
const { CARD_Y, CARD_SIZE, GREEN_DECK } = require("../src/js/gameplay/three/cardLayout.js");
const { DESK_Y } = require("../src/js/gameplay/three/constants.js");

// A CARD'S FOOTPRINT (UNTURNED) OVER THE BOARD'S FRAME
const close = (a, b, m) => { for (const k of Object.keys(b)) { assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${m}: ${k} ${a[k]} vs ${b[k]}`); } };
const overBoard = (p) => p.x + CARD_SIZE.w / 2 > BOARD_RECT.x0 && p.x - CARD_SIZE.w / 2 < BOARD_RECT.x1 && p.z + CARD_SIZE.h / 2 > BOARD_RECT.z0 && p.z - CARD_SIZE.h / 2 < BOARD_RECT.z1;

test("the waypoints lie off the board, above the desk", () => {
	assert.equal(overBoard(DUEL_OUT), false);
	assert.equal(DUEL_OUT.z, GREEN_DECK.z, "out of the deck along its z");
	assert.ok(DUEL_OUT.y > DESK_Y && DUEL_OUT.y > CARD_Y);
	assert.equal(overBoard(DUEL_WAYPOINT), false);
	assert.equal(overBoard({ ...DUEL_WAYPOINT, z: -DUEL_WAYPOINT.z }), false, "mirrored for Card Guy's row");
	assert.ok(DUEL_WAYPOINT.y > DESK_Y && DUEL_WAYPOINT.y > CARD_Y);
});

test("duelPath: the ends, out of the deck along z 0 then across to the row, mirrored for Card Guy's row", () => {
	const deck = { x: GREEN_DECK.x, y: GREEN_DECK.y, z: GREEN_DECK.z, yaw: 0 };
	for (const side of ["mine", "his"]) {
		const s = duelSpot(side, "round", 0), row = { x: s.x, y: CARD_Y, z: s.z, yaw: 0 }, wz = Math.sign(s.z) * DUEL_WAYPOINT.z;
		const out = { x: DUEL_OUT.x, y: DUEL_OUT.y, z: DUEL_OUT.z, yaw: 0 }, corner = { x: DUEL_WAYPOINT.x, y: DUEL_WAYPOINT.y, z: wz, yaw: 0 };
		close(duelPath(deck, row, 0), deck, "start");
		close(duelPath(deck, row, 1), row, "end");
		close(duelPath(deck, row, 1 / 3), out, `${side}: dealt, out`);
		close(duelPath(deck, row, 2 / 3), corner, `${side}: dealt, across`);
		close(duelPath(row, deck, 1 / 3), corner, `${side}: sent back, across`);
		close(duelPath(row, deck, 2 / 3), out, `${side}: sent back, out`);
		for (let k = 0; k <= 1; k += 0.02) { assert.equal(overBoard(duelPath(deck, row, k)), false, `${side} k ${k}`); }
	}
});

test("a full near taken-pieces pile: every duel card's footprint clears every piece, dealt & sent back", () => {
	const deck = { x: GREEN_DECK.x, y: GREEN_DECK.y, z: GREEN_DECK.z, yaw: 0 };
	const near = pileSpots(Array.from({ length: 15 }, () => ({ type: "p", color: "b" })), "w").filter((s) => s.key.startsWith("near")); // WHITE: THE ROOM IS THE SCENE
	assert.equal(near.length, 15);
	const gap = (pc, p) => Math.hypot(Math.max(0, Math.abs(pc.x - p.x) - CARD_SIZE.w / 2), Math.max(0, Math.abs(pc.z - p.z) - CARD_SIZE.h / 2)); // A PIECE'S CENTRE TO THE CARD'S FOOTPRINT
	for (const side of ["mine", "his"]) {
		for (const [set, n] of [["round", 3], ["spades", 3]]) {
			for (let i = 0; i < n; i++) {
				const s = duelSpot(side, set, i), row = { x: s.x, y: CARD_Y, z: s.z, yaw: 0 };
				for (let k = 0; k <= 1; k += 0.005) {
					for (const [m, p] of [["dealt", duelPath(deck, row, k)], ["sent back", duelPath(row, deck, k, 0.5)]]) {
						for (const pc of near) { assert.ok(gap(pc, p) > 1.5, `${side} ${set} ${i} ${m} k ${k.toFixed(3)}: ${pc.key} ${gap(pc, p).toFixed(2)}`); }
					}
				}
			}
		}
	}
});

test("a card sent back before it got across goes straight back, no detour", () => {
	const deck = { x: GREEN_DECK.x, y: GREEN_DECK.y, z: GREEN_DECK.z, yaw: 0 };
	for (const side of ["mine", "his"]) {
		const s = duelSpot(side, "round", 0), row = { x: s.x, y: CARD_Y, z: s.z, yaw: 0 };
		const early = duelPath(deck, row, 0.1), mid = duelPath(deck, row, 0.5); // ON THE WAY OUT; ON THE WAY ACROSS
		for (let k = 0; k <= 1; k += 0.02) {
			const a = duelPath(early, deck, k), b = duelPath(mid, deck, k);
			assert.ok(a.z === 0 && a.x >= early.x - 1e-9 && a.x <= deck.x + 1e-9, `${side} early k ${k}: ${a.x}, ${a.z}`);
			assert.ok(Math.abs(b.z) <= Math.abs(mid.z) + 1e-9, `${side} mid k ${k}: no further across than it was (${b.z})`);
		}
		close(duelPath(mid, deck, 0.5), { x: DUEL_OUT.x, y: DUEL_OUT.y, z: DUEL_OUT.z, yaw: 0 }, `${side} mid: back by the out point`);
	}
});

test("duelPath rise lifts the waypoints only, not the ends", () => {
	const deck = { x: GREEN_DECK.x, y: GREEN_DECK.y, z: GREEN_DECK.z, yaw: 0 }, s = duelSpot("mine", "round", 1), row = { x: s.x, y: CARD_Y, z: s.z, yaw: 0 };
	close(duelPath(row, deck, 0, 0.2), row, "start");
	close(duelPath(row, deck, 1, 0.2), deck, "end");
	assert.ok(Math.abs(duelPath(row, deck, 1 / 3, 0.2).y - (DUEL_WAYPOINT.y + 0.2)) < 1e-9);
	assert.ok(Math.abs(duelPath(row, deck, 2 / 3, 0.2).y - (DUEL_OUT.y + 0.2)) < 1e-9);
});

test("dealt & sent back, no duel card ever passes over the board", () => {
	const room = new THREE.Group(), animations = createAnimations(() => {});
	let now = 0;
	const g = new THREE.Group();
	g.add(new THREE.Mesh(new THREE.PlaneGeometry(4.3, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ name: "cardFace" })), new THREE.Mesh(new THREE.PlaneGeometry(4.3, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ name: "cardBack" })));
	const table = createCardTable({ template: g, room, animations, requestRender() {} });
	const view = { you: "w", effects: [], duel: null, players: { w: { king: true, moves: [], actives: [], passive: null, curses: [], spot: [], pile: { n: 0, top: null }, kept: null }, b: { king: true, hand: { count: 0, shown: [] }, spot: [], pile: { n: 0, top: null }, kept: null } } };
	view.duel = { player: "w", piece: "w12", card: "all-or-nothing", step: "pick", wins: 0, round: 1, hands: { w: [null, null, null], b: [null, null, null] }, picked: { w: [], b: [] }, spades: null };
	table.set(view, {});
	while (animations.step((now += 16))) { /* SETTLED */ }
	const hands = new Set(room.children);
	let frames = 0, sawWaypoint = false;
	const flying = () => [...room.children].filter((o) => o.isGroup && !hands.has(o) && !(Math.abs(o.position.x - GREEN_DECK.x) < 1e-6 && Math.abs(o.position.z - GREEN_DECK.z) < 1e-6)).map((o) => o.position); // OFF THE DECK
	const coplanar = () => flying().some((a, i, ps) => ps.slice(i + 1).some((b) => Math.abs(a.x - b.x) < CARD_SIZE.w && Math.abs(a.z - b.z) < CARD_SIZE.h && Math.abs(a.y - b.y) < 1e-4)); // AT ONE HEIGHT: THEY WOULD Z-FIGHT
	const watch = (back = false) => {
		while (animations.step((now += 16))) {
			frames++;
			assert.equal(back && coplanar(), false, "cards sent back together never overlap at one height (review M2)");
			for (const o of room.children) {
				if (!o.isGroup || hands.has(o)) { continue; }
				assert.equal(overBoard(o.position), false, `over the board at ${o.position.x.toFixed(2)}, ${o.position.z.toFixed(2)}`);
				if (Math.abs(o.position.x - DUEL_WAYPOINT.x) < 1 && Math.abs(Math.abs(o.position.z) - DUEL_WAYPOINT.z) < 1) { sawWaypoint = true; }
			}
		}
	};
	table.dealDuel(view.duel);
	watch();
	table.endDuel();
	watch(true);
	assert.ok(frames > 0 && sawWaypoint, "the cards moved, by the waypoint");
	table.dispose();
});
