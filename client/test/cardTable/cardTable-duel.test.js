// createCardTable's duel methods with real three.js in node: a stub DOM, a stand-in card template, the animation runner stepped by hand (moved from the sdd folder's smoke test, Task 20 S2 fix round 1)
const { test } = require("node:test");
const assert = require("node:assert/strict");

function recorder(seen) { // A 2D CONTEXT THAT KEEPS THE TEXT DRAWN SINCE ITS LAST clearRect
	return new Proxy({}, { get: (o, k) => (k === "fillText" ? (t) => seen.push(t) : k === "clearRect" ? () => { seen.length = 0; } : k === "measureText" ? (t) => ({ width: String(t).length }) : k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
}
global.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {} };
global.document = {
	createElement(tag) {
		if (tag !== "canvas") { return { setAttribute() {}, remove() {}, textContent: "" }; }
		const canvas = { width: 0, height: 0, seen: [] }, ctx = recorder(canvas.seen);
		canvas.getContext = () => ctx;
		return canvas;
	},
	body: { append() {} },
};
const THREE = require("../../../node_modules/three/build/three.module.js"); // THE SAME COPY cardTable/ IMPORTS
const { createCardTable } = require("../../src/js/gameplay/three/cardTable/index.js");
const { createAnimations } = require("../../src/js/gameplay/three/animations.js");
const { duelSpot, DUEL_STACK } = require("../../src/js/gameplay/three/cardTable/tableLayout.js");
const { CARD_Y } = require("../../src/js/gameplay/three/cardLayout.js");
const { FACE_W, FACE_H } = require("../../src/js/gameplay/three/cardTable/promotionCards.js");
const { drawDuelFace } = require("../../src/js/gameplay/three/cardTable/cardFaces.js");
const duelActions = require("../../../cards-engine/duel.js").actions;

function template() { // A CARD: ITS FACE ON TOP LOOKING UP, ITS BACK UNDER IT LOOKING DOWN, ORIGIN AT ITS BOTTOM FACE
	const g = new THREE.Group();
	const face = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ name: "cardFace" }));
	face.position.y = 0.03;
	const back = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ name: "cardBack" }));
	g.add(face, back);
	return g;
}
function setup() {
	const room = new THREE.Group(), animations = createAnimations(() => {});
	let now = 0;
	const table = createCardTable({ template: template(), room, animations, requestRender() {} });
	const run = () => { while (animations.step((now += 16))) { /* TO THE END */ } room.updateMatrixWorld(true); };
	const step = (ms) => { for (const end = now + ms; now < end;) { animations.step((now += 16)); } room.updateMatrixWorld(true); };
	return { room, run, step, table };
}
const view = (duel) => ({ you: "w", effects: [], duel, players: { w: { king: true, moves: [{ id: "m1", key: "move", piece: "n" }], actives: [], passive: null, curses: [], spot: [], pile: { n: 0, top: null }, kept: null }, b: { king: true, hand: { count: 2, shown: [] }, spot: [], pile: { n: 0, top: null }, kept: null } } });
const duel = (o = {}) => ({ player: "w", piece: "w12", card: "all-or-nothing", step: "pick", wins: 0, round: 1, hands: { w: [null, null, null], b: [null, null, null] }, picked: { w: [], b: [] }, spades: null, ...o });
const rayDown = (x, z) => { const r = new THREE.Raycaster(); r.set(new THREE.Vector3(x, 30, z), new THREE.Vector3(0, -1, 0)); return r; };
const near = (o, p) => Math.abs(o.position.x - p.x) < 1e-6 && Math.abs(o.position.z - p.z) < 1e-6;
const cardsAt = (room, x, z) => room.children.filter((o) => o.visible !== false && o.type === "Group" && near(o, { x, z }));
const RANKS = "23456789TJQKA";
const C = (x) => ({ r: RANKS.indexOf(x[0]) + 2, s: x[1] });

test("deal, hit, flip, a tie then spades, a new round, the end", () => {
	const { room, run, table } = setup();
	const v = view(duel());
	table.set(v, {});
	run();
	const before = room.children.length;
	table.dealDuel(v.duel);
	run();
	assert.equal(room.children.length, before + 6, "6 duel cards");
	assert.equal(cardsAt(room, DUEL_STACK.mine.x, DUEL_STACK.mine.z).length, 2, "your king & m1 stacked");
	assert.equal(cardsAt(room, DUEL_STACK.his.x, DUEL_STACK.his.z).length, 3, "his king + 2 face down stacked");
	const p1 = duelSpot("mine", "round", 1);
	assert.deepEqual(table.hit(rayDown(p1.x, p1.z)), { kind: "duel", index: 1 });
	const h1 = duelSpot("his", "round", 1);
	assert.equal(table.hit(rayDown(h1.x, h1.z)), null, "never Card Guy's");
	table.set(view(duel()), {}); // A NEW VIEW: THE HANDS STAY STACKED
	run();
	assert.equal(cardsAt(room, DUEL_STACK.mine.x, DUEL_STACK.mine.z).length, 2);
	table.dealDuel(duel()); // THE SAME ROUND: NOTHING
	assert.equal(room.children.length, before + 6);
	const tie = duel({ hands: { w: [null, C("9c"), null], b: [C("9s"), null, null] }, picked: { w: [1], b: [0] } });
	table.flipDuel("w", 1, C("9c"));
	table.flipDuel("b", null, C("9s"));
	table.set(view(tie), {});
	table.dealDuel(tie);
	run();
	assert.equal(table.hit(rayDown(p1.x, p1.z)), null, "a flipped card is not picked");
	const flipped = cardsAt(room, p1.x, p1.z)[0];
	assert.ok(Math.abs(flipped.rotation.z) < 1e-9 && Math.abs(flipped.position.y - CARD_Y) < 1e-6, "face up, on the baize");
	const his0 = cardsAt(room, duelSpot("his", "round", 0).x, -17.7)[0];
	assert.ok(Math.abs(his0.rotation.z) < 1e-9, "index null: his first face-down card");
	table.flipDuel("w", 1, C("9c"), true);
	run();
	const frames = () => room.children.filter((o) => o.type === "Mesh" && o.visible && near(o, p1));
	assert.equal(frames().length, 1, "the gold frame");
	table.set(view(tie), { focusDuel: 2 });
	run();
	const p2 = duelSpot("mine", "round", 2), focus = room.children.find((o) => o.type === "Mesh" && o.visible && near(o, p2));
	assert.ok(focus, "the focus frame on duel card 2");
	table.dealDuel(duel({ hands: { w: [C("5h"), C("9c"), C("7d")], b: [C("9s"), C("5c"), C("7h")] }, picked: { w: [1, 0, 2], b: [0, 1, 2] }, spades: { hands: { w: [null, null, null], b: [null, null, null] }, picked: { w: [], b: [] } } }));
	run();
	assert.equal(room.children.length, before + 12, "the spades set beside, the round's stay (the won frame went: this view has no won card)");
	const s0 = duelSpot("mine", "spades", 0);
	assert.deepEqual(table.hit(rayDown(s0.x, s0.z)), { kind: "duel", index: 0 });
	const r2 = duelSpot("mine", "round", 2);
	assert.equal(table.hit(rayDown(r2.x, r2.z)), null, "the round's last card, face up, is not picked");
	table.set(view(tie), {});
	table.dealDuel(duel({ round: 2 }));
	run();
	assert.equal(room.children.length, before + 6, "a new round: 6 new ones, the old ones gone");
	table.endDuel();
	run();
	assert.equal(room.children.length, before);
	assert.equal(cardsAt(room, DUEL_STACK.mine.x, DUEL_STACK.mine.z).length, 0, "the hands back in their rows");
	table.dispose();
});

test("a reload mid-duel: flipped cards face up, the won one framed", () => {
	const { room, run, table } = setup();
	const d = duel({ step: "decide", wins: 1, hands: { w: [null, { r: 13, s: "h" }, null], b: [{ r: 11, s: "d" }, null, null] }, picked: { w: [1], b: [0] } });
	table.set(view(d), {});
	table.dealDuel(d);
	run();
	const k = cardsAt(room, duelSpot("mine", "round", 1).x, 17.7)[0];
	assert.ok(Math.abs(k.rotation.z) < 1e-9, "face up");
	assert.ok(Math.abs(cardsAt(room, duelSpot("mine", "round", 0).x, 17.7)[0].rotation.z - Math.PI) < 1e-9, "face down");
	assert.ok(room.children.some((o) => o.type === "Mesh" && o.visible && near(o, duelSpot("mine", "round", 1))), "won frame");
	table.flipDuel("b", null, { r: 11, s: "d" }, true); // INDEX NULL, A CARD ALREADY SHOWN: ONLY ITS FRAME
	run();
	assert.ok(room.children.some((o) => o.type === "Mesh" && o.visible && near(o, duelSpot("his", "round", 0))), "his won frame");
	for (const i of [1, 2]) { assert.ok(Math.abs(cardsAt(room, duelSpot("his", "round", i).x, -17.7)[0].rotation.z - Math.PI) < 1e-9, `his ${i} still face down`); }
	table.dispose();
});

/* ---- Fix round 1: the table against the view at every answer (review I1, I2, M1, M2, M3, call 6) ---- */
const SPOTS = ["mine", "his"].flatMap((side) => ["round", "spades"].flatMap((set) => [0, 1, 2].map((index) => ({ key: `${side}:${set}:${index}`, side, set, index, ...duelSpot(side, set, index) }))));
const shows = (card) => { const seen = []; drawDuelFace(recorder(seen), card, FACE_W, FACE_H); return seen.join(" "); };
function seen({ room, table }) { // WHAT THE TABLE SHOWS AT EVERY DUEL SPOT: ITS CARDS, FACE UP OR DOWN, THE FACE PAINTED, A VISIBLE OUTLINE, WHAT A CLICK THERE PICKS
	return SPOTS.map(function (p) {
		const roots = room.children.filter((o) => o.isGroup && o.visible && near(o, p)), r = roots[0], up = Boolean(r) && Math.abs(r.rotation.z) < 1e-9;
		const face = up ? r.children.find((m) => m.material && m.material.map) : null;
		return { key: p.key, cards: roots.length, up, shows: face ? face.material.map.image.seen.join(" ") : null, outline: room.children.filter((o) => o.isMesh && o.visible && near(o, p)).length, hit: table.hit(rayDown(p.x, p.z)) };
	});
}
function wanted(d, won) { // WHAT THE VIEW SAYS: THE PICKS FROM THE ENGINE (duel.js actions), NOT FROM THE TABLE'S OWN CODE
	const legal = duelActions({ duel: d }, "w").filter((a) => a.pick !== undefined).map((a) => a.pick), current = d.spades ? "spades" : "round";
	return SPOTS.map(function (p) {
		const set = p.set === "round" ? d : d.spades, card = set ? set.hands[p.side === "mine" ? "w" : "b"][p.index] : null;
		return { key: p.key, cards: set ? 1 : 0, up: Boolean(card), shows: card ? shows(card) : null, outline: won.includes(p.key) ? 1 : 0, hit: p.side === "mine" && p.set === current && legal.includes(p.index) ? { kind: "duel", index: p.index } : null };
	});
}
// ONE DUEL, ANSWER BY ANSWER: flips ARE THE ANSWER'S duel-flip EVENTS [player, index, card] (index FROM THAT SET'S picked, AS S3 WILL), set THEIRS (DEFAULT THE ROUND), winner THE duel-result'S; won THE CARDS THE VIEW OUTLINES
const NONE = [null, null, null], SPADES = { hands: { w: NONE, b: NONE }, picked: { w: [], b: [] } };
const ROUND_TIED = { hands: { w: [C("9c"), C("5h"), C("7d")], b: [C("9s"), C("5c"), C("7h")] }, picked: { w: [0, 1, 2], b: [0, 1, 2] } }; // 3 TIES, SUIT SCORES 1 & 1
const A5 = duel({ hands: { w: [C("9c"), C("5h"), null], b: [C("9s"), C("5c"), null] }, picked: { w: [0, 1], b: [0, 1, 2] } });
const A7 = duel({ ...ROUND_TIED, spades: { hands: { w: NONE, b: NONE }, picked: { w: [], b: [1] } } });
const A6 = { d: duel({ ...ROUND_TIED, spades: SPADES }), flips: [["w", 2, "7d"], ["b", 2, "7h"]], won: [] };
const A8 = { d: duel({ ...ROUND_TIED, step: "decide", wins: 1, spades: { hands: { w: [C("Qs"), null, null], b: [null, C("3s"), null] }, picked: { w: [0], b: [1] } } }), flips: [["w", 0, "Qs"], ["b", 1, "3s"]], set: "spades", winner: "w", won: ["mine:spades:0"] };
const ANSWERS = [
	{ d: duel(), won: [] }, // THE DEAL
	{ d: duel({ picked: { w: [0], b: [] } }), won: [] }, // YOU PICKED 0: NOTHING TO PICK WHILE CARD GUY HASN'T, NOT EVEN THE CARD PICKED
	{ d: duel({ hands: { w: [C("9c"), null, null], b: [C("9s"), null, null] }, picked: { w: [0], b: [0] } }), flips: [["w", 0, "9c"], ["b", 0, "9s"]], won: [] }, // A TIE
	{ d: duel({ hands: { w: [C("9c"), null, null], b: [C("9s"), null, null] }, picked: { w: [0], b: [0, 1] } }), won: [] }, // CARD GUY PICKED FIRST: YOURS 1 & 2
	{ d: duel({ hands: { w: [C("9c"), C("5h"), null], b: [C("9s"), C("5c"), null] }, picked: { w: [0, 1], b: [0, 1] } }), flips: [["w", 1, "5h"], ["b", 1, "5c"]], won: [] },
	{ d: A5, won: [] },
	A6, // THE THIRD TIE & THE SUIT SCORES TIED: THE SPADES DEAL IN THE SAME ANSWER AS THE ROUND'S LAST FLIPS
	{ d: A5, won: [], why: "a view that goes back before the spades deal (nothing sends one today)" },
	A6,
	{ d: A7, won: [] }, // CARD GUY'S SPADES PICK FIRST: YOUR 3 SPADES ARE OPEN
	A8, // Q OVER 3: STEP decide, ONLY THE SPADES CARD WON
	{ d: A7, won: [], why: "a view that goes back before the winning spades pick (nothing sends one today)" },
	A8,
];

test("the table shows what each answer's view shows, the same whether dealDuel comes before or after that answer's flips", () => {
	const after = setup(), first = setup(); // after: dealDuel AFTER THE FLIPS; first: dealDuel FIRST, THEN THE FLIPS
	for (const [i, a] of ANSWERS.entries()) {
		const flips = (t) => {
			for (const [player, index, card] of a.flips || []) { t.table.flipDuel(player, index, C(card)); }
			if (a.winner) { const [player, index, card] = a.flips.find(([p]) => p === a.winner); t.table.flipDuel(player, index, C(card), true); }
		};
		for (const t of [after, first]) { t.table.set(view(a.d), {}); }
		flips(after);
		after.run();
		for (const [, index] of (a.flips || []).filter(([p]) => p === "w")) { const p = duelSpot("mine", a.set || "round", index); assert.equal(after.table.hit(rayDown(p.x, p.z)), null, `answer ${i}: your flipped card, before its view comes`); }
		after.table.dealDuel(a.d);
		first.table.dealDuel(a.d);
		flips(first);
		after.run();
		first.run();
		const want = wanted(a.d, a.won), why = `answer ${i}${a.why ? ` (${a.why})` : ""}`;
		assert.deepEqual(seen(after), want, `dealDuel after the flips, ${why}`);
		assert.deepEqual(seen(first), want, `dealDuel before the flips, ${why}`);
	}
	after.table.dispose();
	first.table.dispose();
});

test("a view that goes back before a winning pick turns its cards back down without the outline (nothing sends one today)", () => {
	const t = setup(), waiting = duel({ picked: { w: [1], b: [] } }), won = duel({ step: "decide", wins: 1, hands: { w: [null, C("Kh"), null], b: [null, null, C("Jd")] }, picked: { w: [1], b: [2] } });
	for (const [d, outlined] of [[waiting, []], [won, ["mine:round:1"]], [waiting, []]]) {
		t.table.set(view(d), {});
		t.table.dealDuel(d);
		t.run();
		assert.deepEqual(seen(t), wanted(d, outlined));
	}
	t.table.dispose();
});

test("a duel of another player or piece is a new deal, even at the same round number", () => {
	const t = setup(), mine = duel({ step: "decide", wins: 1, hands: { w: [C("Kh"), null, null], b: [C("Jd"), null, null] }, picked: { w: [0], b: [0] } });
	t.table.set(view(mine), {});
	t.table.dealDuel(mine);
	t.run();
	const old = SPOTS.filter((p) => p.set === "round").map((p) => cardsAt(t.room, p.x, p.z)[0]);
	for (const other of [duel({ player: "b", piece: "b7" }), duel({ player: "b", piece: "b9" })]) {
		t.table.set(view(other), {});
		t.table.dealDuel(other);
		t.run();
		const now = SPOTS.filter((p) => p.set === "round").map((p) => cardsAt(t.room, p.x, p.z)[0]);
		assert.ok(now.every((r, i) => r && r !== old[i]), `${other.piece}: 6 new cards dealt`);
		assert.deepEqual(seen(t), wanted(other, []));
		old.splice(0, 6, ...now);
	}
	t.table.dispose();
});

test("while a duel is laid no stacked hand card is hit; before and after it they are", () => {
	const t = setup(), d = duel();
	t.table.set(view(d), {});
	t.run();
	const row = [...cardsAt(t.room, -2.3, 17.7), ...cardsAt(t.room, 2.3, 17.7)];
	assert.equal(row.length, 2);
	assert.equal(t.table.hit(rayDown(2.3, 17.7)).kind, "hand");
	t.table.dealDuel(d);
	t.run();
	assert.equal(cardsAt(t.room, DUEL_STACK.mine.x, DUEL_STACK.mine.z).length, 2);
	assert.equal(t.table.hit(rayDown(DUEL_STACK.mine.x, DUEL_STACK.mine.z)), null, "the stack");
	t.table.endDuel();
	t.run();
	assert.equal(t.table.hit(rayDown(2.3, 17.7)).kind, "hand");
	t.table.dispose();
});

test("the won outline shows only once its card has landed", () => {
	const t = setup(), d = duel({ step: "decide", wins: 1, hands: { w: [null, C("Kh"), null], b: [C("Jd"), null, null] }, picked: { w: [1], b: [0] } }), p = duelSpot("mine", "round", 1);
	t.table.set(view(d), {});
	t.run();
	t.table.dealDuel(d); // A PAGE LOAD IN STEP decide
	t.step(48);
	assert.ok(!cardsAt(t.room, p.x, p.z).length, "the card is still on its way");
	assert.equal(t.room.children.filter((o) => o.isMesh && o.visible && near(o, p)).length, 0, "no outline yet");
	t.run();
	assert.equal(t.room.children.filter((o) => o.isMesh && o.visible && near(o, p)).length, 1, "the outline, once landed");
	t.table.dispose();
});

test("the duel deals from & returns to the green deck baked into the room (cardLayout.js GREEN_DECK, at its top GREEN_DECK.y); the table draws no green deck of its own", () => {
	const { GREEN_DECK } = require("../../src/js/gameplay/three/cardLayout.js");
	const { STACK_STEP } = require("../../src/js/gameplay/three/cardTable/promotionCards.js");
	assert.deepEqual(GREEN_DECK, { x: 24.5, z: 0, y: 0.44 });
	const room = new THREE.Group(), moves = [];
	const table = createCardTable({ template: template(), room, animations: { add(t) { moves.push(t); } }, requestRender() {} });
	assert.equal(room.children.filter((o) => o.type === "Group").length, 0, "no green slabs: only the frame & the landing frames");
	const v = view(duel());
	table.set(v, {});
	moves.forEach((t) => t.update(1));
	moves.length = 0;
	const before = new Set(room.children);
	table.dealDuel(v.duel);
	const dealt = room.children.filter((o) => !before.has(o));
	assert.equal(dealt.length, 6);
	moves.forEach((t) => t.update(0)); // EACH SLIDE'S START: THE DECK'S TOP
	for (const o of dealt) { assert.deepEqual([o.position.x, o.position.y, o.position.z], [GREEN_DECK.x, GREEN_DECK.y + STACK_STEP, GREEN_DECK.z], "face down on the deck's top"); }
	moves.forEach((t) => t.update(1));
	moves.length = 0;
	table.endDuel();
	moves.forEach((t) => t.update(1)); // EACH SLIDE'S END
	for (const o of dealt) { assert.deepEqual([o.position.x, o.position.y, o.position.z], [GREEN_DECK.x, GREEN_DECK.y + STACK_STEP, GREEN_DECK.z], "back on the deck's top"); }
	table.dispose();
});
