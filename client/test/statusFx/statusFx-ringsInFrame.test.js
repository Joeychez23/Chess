// TASK 22 S4: THE ENCHANTMENT RINGS, HEAVY CAVALRY'S WARD & THE TRAPDOOR IN THE STATUS FRAME (three/statusFx/index.js), ON THE SAME STUBBED BOARD AS statusFx.test.js:
// A RESOLVE HOOK SWAPS three/index.js FOR test/helpers/threeStub.mjs, A PIECE IS A PLAIN three Object3D, A BADGE'S CANVAS RECORDS ITS fillStyle, THE MODULES ARE SPIES (MODULES MAP)
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { registerHooks } = require("node:module");
const { pathToFileURL } = require("node:url");

const media = { matches: false, fns: [], addEventListener(type, fn) { media.fns.push(fn); } };
global.window = { matchMedia: () => media };
const reduce = (on) => { media.matches = on; media.fns.forEach((fn) => fn({ matches: on })); };
const fills = []; // EVERY fillStyle A BADGE'S CANVAS WAS GIVEN
global.document = {
	createElement: () => ({ width: 0, height: 0, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() {}, getContext: () => new Proxy({}, { get: () => () => {}, set: (o, k, v) => { if (k === "fillStyle") { fills.push(v); } return true; } }) }),
	body: { append() {} },
};
global.setInterval = () => ({});
global.clearInterval = () => {};
const STUB = path.join(__dirname, "../helpers/threeStub.mjs");
registerHooks({
	resolve: (specifier, context, next) => (context.parentURL && context.parentURL.includes("/three/statusFx/") && specifier === "../index.js"
		? { url: pathToFileURL(STUB).href, shortCircuit: true } : next(specifier, context)),
});
const { Object3D, Group } = require("three");
const fx = require("../../src/js/gameplay/three/statusFx/index.js");
const realTrapdoor = require("../../src/js/gameplay/three/statusFx/trapdoor.js");
const realSigils = require("../../src/js/gameplay/three/statusFx/sigils.js");
const board = require(STUB);

const FILES = "abcdefgh", index = (square) => (8 - Number(square[1])) * 8 + FILES.indexOf(square[0]);

// A CARDS VIEW: pieces { e2: "w:p1:p" }, statuses { p1: [{ s, left, by }] }, enchant [{ id, key, owner, pieces, left, data }]
function cardsView(pieces, statuses = {}, enchant = [], you = "w", result) {
	const sq = Array(64).fill(null);
	for (const [square, code] of Object.entries(pieces)) { const [c, id, t] = code.split(":"); sq[index(square)] = { id, c, t }; }
	return { you, board: { sq }, statuses, enchant, result };
}
function meshes(pieces) {
	const v = { pieces: new Map(), scene: new Group(), anims: new Set() };
	board.setView(v);
	for (const square of Object.keys(pieces)) { v.pieces.set(square, mesh()); }
	return v;
}
function mesh() {
	const m = new Object3D();
	m.geometry = { boundingBox: { min: { y: 0 }, max: { y: 0.83 } } };
	return m;
}

let calls, dts, seen, burstMs;
function spy(name) {
	return { create(pieceMesh, opts) { calls.push(["create", name, opts.square]); seen.push(opts); return { update(dt) { dts.push(dt); calls.push(["update", name]); }, burst() { calls.push(["burst", name]); return burstMs; }, animating: () => false, dispose() { calls.push(["dispose", name]); } }; } };
}
const REAL = { ...fx.MODULES };
beforeEach(() => {
	fx.clearStatuses();
	reduce(false);
	calls = [];
	dts = [];
	seen = [];
	burstMs = 0;
	for (const s of Object.keys(fx.MODULES)) { fx.MODULES[s] = spy(s); }
	fills.length = 0;
});
after(() => { fx.clearStatuses(); Object.assign(fx.MODULES, REAL); });
const made = () => calls.filter((c) => c[0] !== "update");
const live = (key) => fx.liveStatuses().find((e) => e.key === key);

const HC = (pieces, key = "heavy-cavalry") => ({ id: "e1", key, owner: "w", pieces, left: null, data: {} });
const HS = (pieces, left = 2) => ({ id: "e2", key: "heretical-subjection", owner: "w", pieces, left, data: {} });
const OF = (piece) => ({ id: "e3", key: "opposing-finality", owner: "w", pieces: [piece], left: null, data: {} });
const TRAP = (square) => ({ id: "e4", key: "trapdoor", owner: "b", pieces: [], left: null, data: square ? { square } : {} });

// ---- THE RING LIST (T22-3) ----

test("ringList: Heavy Cavalry on its one enchanted knight, Heretical Subjection on each bishop with its turns left, Opposing Finality on its piece", () => {
	const pieces = { e4: "w:n1:n", f6: "w:n2:n", c1: "w:b1:b", f1: "w:b2:b", d2: "w:q1:q", a7: "b:n9:n" };
	const rings = fx.ringList(cardsView(pieces, {}, [HC(["n1"]), HS(["b1", "b2"], 2), OF("q1"), { ...HC(["n9"]), owner: "b" }]));
	assert.deepEqual(Object.fromEntries(rings), {
		n1: [{ s: "heavy-cavalry", left: null }],
		b1: [{ s: "heretical-subjection", left: 2 }],
		b2: [{ s: "heretical-subjection", left: 2 }],
		q1: [{ s: "opposing-finality", left: null }],
		n9: [{ s: "heavy-cavalry", left: null }],
	});
	assert.ok(!rings.has("n2"), "never on another knight");
});

test("ringList: a piece the fog hides (not on the view's board) has no ring; a Heavy Cavalry the fog cut its knight from (pieces []) has none", () => {
	const rings = fx.ringList(cardsView({ c1: "w:b1:b" }, {}, [HS(["b1", "b2"]), OF("q1"), HC(["n2"]), { ...HC([]), id: "e9" }]));
	assert.deepEqual(Object.fromEntries(rings), { b1: [{ s: "heretical-subjection", left: 2 }] });
});

test("ringList: a subjected bishop handed over (still in pieces, now the other colour) loses its ring, as the engine stops moving it; two rings on one piece keep the enchantments' order", () => {
	const rings = fx.ringList(cardsView({ c1: "w:b1:b", f8: "b:b2:b" }, {}, [OF("b1"), HS(["b1", "b2"])]));
	assert.deepEqual(rings.get("b1").map((r) => r.s), ["opposing-finality", "heretical-subjection"]);
	assert.ok(!rings.has("b2"));
});

// ---- HEAVY CAVALRY'S WARD (T22-2) ----

test("wardIds: the owner's non-king pieces on the enchanted knight's squares, another knight too, never the king or an enemy; the ward follows the knight", () => {
	const pieces = { e4: "w:n1:n", f6: "w:n2:n", d6: "w:p1:p", c5: "w:k1:k", g3: "w:r1:r", c3: "b:p9:p", e5: "w:p2:p" };
	assert.deepEqual([...fx.wardIds(cardsView(pieces, {}, [HC(["n1"])]))].sort(), ["n2", "p1", "r1"], "no partner to leave out: the other knight is warded");
	const { e4, ...rest } = pieces;
	assert.deepEqual([...fx.wardIds(cardsView({ ...rest, h5: "w:n1:n" }, {}, [HC(["n1"])]))].sort(), ["n2", "r1"], "moved to h5: f6 and g3 its squares now, d6 no more");
});

test("wardIds: a knight handed over wards nothing", () => {
	assert.equal(fx.wardIds(cardsView({ e4: "b:n1:n", d6: "w:p1:p" }, {}, [HC(["n1"])])).size, 0);
});

test("statusList: the ward is a Warded entry; with a real warded the piece gets one (the real one's turns left)", () => {
	const pieces = { e4: "w:n1:n", f6: "w:n2:n", d6: "w:p1:p", g3: "w:r1:r" };
	const { want } = fx.statusList(cardsView(pieces, { r1: [{ s: "warded", left: 2, by: "w" }] }, [HC(["n1"])]));
	assert.equal(want.get("p1:warded").left, null);
	assert.equal(want.get("r1:warded").left, 2);
	assert.equal([...want.keys()].filter((k) => k.startsWith("r1:")).length, 1, "one aura, one line");
});

// ---- THE ENGINE'S OWN VIEWS (cards-engine playerView): FOG, A DROPPED TRAP ----

const engine = require("../../../cards-engine/index.js"), eboard = require("../../../cards-engine/board.js");
function engineState(pieces, enchant, turn = "w") {
	const st = engine.newGame({ seed: 7 });
	st.board.sq = Array(64).fill(null);
	for (const [square, code] of Object.entries(pieces)) { const [c, id, t] = code.split(":"); st.board.sq[eboard.sqIndex(square)] = { id, c, t }; }
	Object.assign(st, { enchant, statuses: {} });
	st.board.turn = turn;
	return st;
}

test("a Heavy Cavalry whose knight the fog hides (the engine's view: pieces []) shows no ring & wards nothing (not a8's knight squares, b6 & c7)", () => {
	const st = engineState({ e1: "w:w1:k", e8: "b:b1:k", e3: "w:w2:n", b6: "w:w3:p", c7: "w:w4:r", h8: "b:b2:r" },
		[{ id: "e1", key: "fog-of-war", owner: "w", pieces: [], left: 3, data: {} }, { id: "e2", key: "heavy-cavalry", owner: "w", pieces: ["w2"], left: null, data: {} }]);
	const v = engine.playerView(st, "b");
	assert.deepEqual(v.enchant.find((e) => e.key === "heavy-cavalry").pieces, [], "the engine cut the hidden knight");
	assert.equal(fx.wardIds(v).size, 0);
	assert.equal(fx.ringList(v).size, 0);
	assert.ok(![...fx.statusList(v).want.keys()].some((k) => k.endsWith(":warded")));
	assert.equal(fx.wardIds(cardsView({ b6: "w:p1:p", c7: "w:r1:r" }, {}, [HC([])])).size, 0, "the same with a hand-made view");
});

test("the owner dropping its Trapdoor (the engine's drop) with its own piece, or an enemy piece not Frozen, on the square: no snap", () => {
	for (const piece of ["b:b3:n", "w:w3:n"]) {
		const st = engineState({ e1: "w:w1:k", e8: "b:b1:k", d5: piece }, [{ id: "e90", key: "trapdoor", owner: "b", pieces: [], left: null, data: { square: "d5" } }], "b");
		st.players.b.spot = [{ id: "c900", key: "trapdoor" }];
		const r = engine.applyAction(st, "b", { type: "drop", card: "c900" });
		assert.ok(r.events.some((e) => e.type === "enchant-ended"));
		assert.equal(fx.springSquare(engine.playerView(st, "b"), engine.playerView(r.state, "b")), null, piece);
	}
	// THE OWNER'S OWN KING FROZEN ON ITS OWN TRAP SQUARE (LAST STAND CAN DO IT), THEN THE DROP: STILL NO SNAP (index.js p.c !== e.owner, RE-REVIEW N2)
	const st = engineState({ e1: "w:w1:k", d5: "b:b1:k" }, [{ id: "e90", key: "trapdoor", owner: "b", pieces: [], left: null, data: { square: "d5" } }], "b");
	st.statuses = { b1: [{ s: "frozen", left: 3, by: "b" }] };
	st.players.b.spot = [{ id: "c900", key: "trapdoor" }];
	const was = engine.playerView(st, "b");
	const r = engine.applyAction(st, "b", { type: "drop", card: "c900" });
	assert.ok(r.events.some((e) => e.type === "enchant-ended"));
	assert.ok(engine.playerView(r.state, "b").statuses.b1.some((e) => e.s === "frozen"), "the king is still Frozen in the new view");
	assert.equal(fx.springSquare(was, engine.playerView(r.state, "b")), null, "own Frozen king on the square");
});

test("the owner's trap dropped in the same sync as the other player's trap springing on the owner's piece: that spring still snaps", () => {
	const mine = { ...TRAP("d5"), id: "e5" }, theirs = { ...TRAP(null), id: "e6", owner: "w" };
	const was = cardsView({ d5: "b:n1:n", f3: "b:p1:p" }, {}, [mine, theirs], "b");
	const now = cardsView({ d5: "b:n1:n", f2: "b:p1:p" }, { p1: [{ s: "frozen", left: 3, by: "w" }] }, [], "b");
	assert.equal(fx.springSquare(was, now), "f2");
	assert.equal(fx.springSquare(cardsView({ d5: "b:n1:n", f3: "b:p1:p" }, {}, [mine], "b"), now), null, "only its own trap ended: a piece Frozen another way is no spring");
});

test("no snap when the last view was a finished game (every trap's square shown) & the next is a new game's first view", () => {
	const was = cardsView({ a2: "b:q9:q" }, {}, [{ ...TRAP("a2"), owner: "w" }], "b", { winner: "w" });
	const now = cardsView({ a2: "b:p5:p", e1: "w:k1:k" }, { p5: [{ s: "frozen", left: 3, by: "w" }] }, [], "b"); // THE VIEWER'S PIECE, FROZEN, ON THE OLD TRAP'S SQUARE: ONLY THE was.result CHECK STOPS A SNAP (RE-REVIEW N1)
	assert.equal(fx.springSquare(was, now), null);
});

test("Heavy Cavalry's hover line leaves out the king only (no partner: it wards the other knight): 'except', not 'but'", () => {
	const pieces = { e4: "w:n1:n", f6: "w:n2:n" };
	meshes(pieces);
	fx.syncStatuses(cardsView(pieces, {}, [HC(["n1"])]), "effects");
	assert.match(fx.statusText("f6"), /^Warded/, "it wards the other knight");
	assert.match(fx.statusText("e4"), /^Heavy Cavalry: .+, except the king\.$/);
});

// ---- THE RINGS IN THE FRAME ----

test("syncStatuses: a ring is made on its piece with ringSlot / ringSlots, & siblings naming the piece's shown statuses (Hex included); badges' slots count every entry", () => {
	const pieces = { c1: "w:b1:b" };
	meshes(pieces);
	fx.syncStatuses(cardsView(pieces, { b1: [{ s: "hexed", left: 1, by: "b" }] }, [OF("b1"), HS(["b1"], 2)]), "effects");
	assert.deepEqual(made(), [["create", "hexed", "c1"], ["create", "opposing-finality", "c1"], ["create", "heretical-subjection", "c1"]]);
	const of = live("b1:opposing-finality").opts, hs = live("b1:heretical-subjection").opts;
	assert.deepEqual([of.ringSlot, of.ringSlots, hs.ringSlot, hs.ringSlots], [0, 2, 1, 2]);
	assert.ok(of.siblings.includes("hexed") && hs.siblings.includes("hexed"), "made with hexed already in its siblings");
	assert.deepEqual([hs.slot, hs.slots], [2, 3]);
	assert.equal(hs.left, 2);
	assert.equal(of.root.parent, meshesOf("c1"));
});
const meshesOf = (square) => board.view.pieces.get(square);

test("syncStatuses: the inner ring ending moves the outer to ring slot 0 with update(0); a ring ending with its piece still there bursts", () => {
	const pieces = { c1: "w:b1:b" };
	meshes(pieces);
	fx.syncStatuses(cardsView(pieces, {}, [OF("b1"), HS(["b1"], 2)]), "effects");
	const hs = live("b1:heretical-subjection").opts;
	calls = [];
	dts = [];
	fx.syncStatuses(cardsView(pieces, {}, [HS(["b1"], 1)]), "effects");
	assert.deepEqual(made(), [["burst", "opposing-finality"], ["dispose", "opposing-finality"]]);
	assert.deepEqual([hs.ringSlot, hs.ringSlots, hs.left], [0, 1, 1]);
	assert.ok(calls.some((c) => c[0] === "update" && c[1] === "heretical-subjection") && dts.includes(0));
});

test("syncStatuses: Heavy Cavalry's ward is drawn with the warded module, appears & goes as its knight moves, and a real warded with it is one effect", () => {
	const pieces = { e4: "w:n1:n", d6: "w:p1:p" }, v = meshes(pieces);
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "warded", left: 1, by: "w" }] }, [HC(["n1"])]), "effects");
	assert.deepEqual(made().filter((c) => c[1] === "warded"), [["create", "warded", "d6"]], "one aura");
	fx.syncStatuses(cardsView(pieces, {}, [HC(["n1"])]), "effects"); // THE REAL ONE ENDS, THE WARD GOES ON: NO BURST, NO RE-CREATE
	assert.deepEqual(made().filter((c) => c[1] === "warded"), [["create", "warded", "d6"]]);
	assert.equal(live("p1:warded").opts.left, null);
	const knight = v.pieces.get("e4");
	v.pieces.delete("e4");
	v.pieces.set("h8", knight);
	fx.syncStatuses(cardsView({ h8: "w:n1:n", d6: "w:p1:p" }, {}, [HC(["n1"])]), "effects");
	assert.deepEqual(made().filter((c) => c[1] === "warded").slice(1), [["burst", "warded"], ["dispose", "warded"]], "d6 no longer its square: the ward ends");
});

test("hover text: statuses, then the ward, then each ring by name with its turns left, in the piece's order; a Warded line once", () => {
	const pieces = { e4: "w:n1:n", f6: "w:n2:n", d6: "w:b1:b" };
	meshes(pieces);
	fx.syncStatuses(cardsView(pieces, { b1: [{ s: "warded", left: 2, by: "w" }, { s: "shaken", left: 1, by: "b" }] }, [HC(["n1"]), HS(["b1"], 2)]), "badges");
	assert.match(fx.statusText("d6"), /^Warded \(2 turns left\): .+\nShaken \(1 turn left\): .+\nHeretical Subjection \(2 turns left\): .+\.$/);
	assert.match(fx.statusText("e4"), /^Heavy Cavalry: .+\.$/);
	assert.match(fx.statusText("f6"), /^Warded: [^\n]+$/, "the other knight: the ward alone, no ring");
});

test("badges mode: each ring is a badge in its colour, the ward is the Warded badge", () => {
	const pieces = { e4: "w:n1:n", f6: "w:n2:n", d6: "w:p1:p", c1: "w:b1:b", h1: "w:q1:q" }; // q1 OFF THE KNIGHT'S SQUARES
	meshes(pieces);
	Object.assign(fx.MODULES, REAL);
	fx.syncStatuses(cardsView(pieces, {}, [HC(["n1"]), HS(["b1"]), OF("q1")]), "badges");
	assert.deepEqual(fx.liveStatuses().map((e) => [e.key, e.mode]).sort(), [["b1:heretical-subjection", "badges"], ["n1:heavy-cavalry", "badges"], ["n2:warded", "badges"], ["p1:warded", "badges"], ["q1:opposing-finality", "badges"]]);
	for (const c of ["#d78c3c", "#a56ee6", "#46c8be", "#e8c04a"]) { assert.ok(fills.includes(c), `${c} in ${fills}`); }
});

// ---- THE TRAPDOOR (T22-1) ----

test("trap: an open trap only on a trapdoor entry with data.square, on the square (no piece, no mesh), the same in badges mode", () => {
	const pieces = { e4: "w:n1:n" };
	const v = meshes(pieces);
	fx.syncStatuses(cardsView(pieces, {}, [TRAP(null)], "w"), "effects");
	assert.deepEqual(made(), [], "the opponent's view: no square, no trap");
	fx.syncStatuses(cardsView(pieces, {}, [TRAP("d5")], "b"), "effects");
	assert.deepEqual(made(), [["create", "trapdoor", "d5"]]);
	const t = fx.liveStatuses()[0].opts;
	assert.equal(t.mesh, null);
	assert.equal(t.squareRoot.parent, v.scene);
	assert.equal(t.squareRoot.position.x, board.center(board.fileOf("d5")));
	assert.equal(fx.statusText("d5"), "", "a square, not a piece: no hover text");
	fx.syncStatuses(cardsView(pieces, {}, [TRAP("d5")], "b"), "badges");
	assert.deepEqual(fx.liveStatuses().map((e) => e.opts.s), ["trapdoor"]);
	assert.ok(!made().slice(1).some((c) => c[0] === "burst"));
	assert.ok(!fx.liveStatuses()[0].opts.root.parent, "nothing on a piece");
});

test("trap: the real trapdoor module goes through the frame's make path with no mesh (no throw), in either mode", () => {
	meshes({});
	Object.assign(fx.MODULES, REAL);
	fx.syncStatuses(cardsView({}, {}, [TRAP("d5")], "b"), "effects");
	fx.syncStatuses(cardsView({}, {}, [TRAP("d5")], "b"), "badges");
	assert.ok(fx.liveStatuses()[0].opts.squareRoot.children.length > 0);
	fx.clearStatuses();
});

test("springSquare: the owner's from the gone entry's square (a piece on it); the opponent's from its own piece newly Frozen; none on a first sync, the same view, or game over", () => {
	const before = { d5: "b:k9:k", d4: "w:p1:p" }, after = { d5: "w:p1:p", e8: "b:k9:k" };
	const frozen = { p1: [{ s: "frozen", left: 3, by: "b" }, { s: "marked", left: 3, by: "b" }] };
	assert.equal(fx.springSquare(cardsView(before, {}, [TRAP("d5")], "b"), cardsView(after, frozen, [], "b")), "d5", "the owner");
	assert.equal(fx.springSquare(cardsView(before, {}, [TRAP(null)], "w"), cardsView(after, frozen, [], "w")), "d5", "the opponent: its piece newly Frozen");
	assert.equal(fx.springSquare(cardsView(after, frozen, [TRAP(null)], "w"), cardsView(after, frozen, [], "w")), null, "already Frozen: no square found");
	assert.equal(fx.springSquare(null, cardsView(after, frozen, [], "w")), null, "a first sync");
	const same = cardsView(before, {}, [TRAP("d5")], "b");
	assert.equal(fx.springSquare(same, same), null, "a mode switch: the same view");
	assert.equal(fx.springSquare(cardsView(before, {}, [TRAP("d5")], "b"), cardsView(after, frozen, [], "b", { winner: "b" })), null, "game over");
	assert.equal(fx.springSquare(cardsView(before, {}, [TRAP("d5")], "b"), cardsView({ d4: "w:p1:p" }, {}, [], "b")), null, "the trap gone with no piece on its square: no snap");
});

test("syncStatuses: a spring disposes the open trap (no burst), then makes a sprung trap & bursts it once; it plays in ending & is freed after", () => {
	const before = { d4: "w:p1:p" }, after = { d5: "w:p1:p" }, v = meshes(before);
	fx.syncStatuses(cardsView(before, {}, [TRAP("d5")], "b"), "effects");
	burstMs = 1000;
	const p = v.pieces.get("d4");
	v.pieces.delete("d4");
	v.pieces.set("d5", p);
	calls = [];
	fx.syncStatuses(cardsView(after, { p1: [{ s: "frozen", left: 3, by: "b" }] }, [], "b"), "effects");
	assert.deepEqual(made(), [["dispose", "trapdoor"], ["create", "trapdoor", "d5"], ["burst", "trapdoor"], ["create", "frozen", "d5"]]);
	const sprung = seen.find((o) => o.sprung);
	assert.equal(sprung.square, "d5");
	assert.equal(sprung.mesh, null);
	assert.ok(!fx.liveStatuses().some((e) => e.opts.sprung), "not live: it's ending");
	fx.stepStatuses(performance.now());
	assert.ok(calls.some((c) => c[0] === "update" && c[1] === "trapdoor"), "stepped while it plays");
	fx.stepStatuses(performance.now() + 2000);
	assert.deepEqual(made().slice(-1), [["dispose", "trapdoor"]]);
	assert.equal(made().filter((c) => c[0] === "burst").length, 1, "burst once");
});

test("syncStatuses: the opponent sees the spring too, on its newly Frozen piece; no spring on a first sync, a mode switch, or game over", () => {
	const before = { d4: "w:p1:p" }, after = { d5: "w:p1:p" }, v = meshes(before);
	fx.syncStatuses(cardsView(before, {}, [TRAP(null)], "w"), "effects");
	fx.syncStatuses(cardsView(before, {}, [TRAP(null)], "w"), "badges");
	assert.deepEqual(made(), [], "a mode switch: nothing");
	const p = v.pieces.get("d4");
	v.pieces.delete("d4");
	v.pieces.set("d5", p);
	const frozen = { p1: [{ s: "frozen", left: 3, by: "b" }] };
	fx.syncStatuses(cardsView(after, frozen, [], "w"), "effects");
	assert.ok(seen.some((o) => o.sprung && o.square === "d5"));
	fx.clearStatuses();
	calls = [];
	fx.syncStatuses(cardsView(after, frozen, [], "w"), "effects");
	assert.deepEqual(made().filter((c) => c[1] === "trapdoor"), [], "a first sync after a clear: no spring");
	fx.syncStatuses(cardsView(before, {}, [TRAP(null)], "w"), "effects");
	calls = [];
	fx.syncStatuses(cardsView(after, frozen, [], "w", { winner: "b" }), "effects");
	assert.deepEqual(made().filter((c) => c[1] === "trapdoor"), [], "game over");
});

test("a spring put off by a slide (pending) still diffs against the last view really synced: one snap after the slide, none on the next sync", () => {
	const before = { d4: "w:p1:p" }, after = { d5: "w:p1:p" }, v = meshes(before);
	fx.syncStatuses(cardsView(before, {}, [TRAP("d5")], "b"), "effects");
	const spring = cardsView(after, { p1: [{ s: "frozen", left: 3, by: "b" }] }, [], "b");
	v.anims.add("slide");
	fx.syncStatuses(spring, "effects");
	fx.syncStatuses(spring, "effects"); // drawBoard AGAIN MID-SLIDE
	const p = v.pieces.get("d4");
	v.pieces.delete("d4");
	v.pieces.set("d5", p);
	v.anims.clear();
	calls = [];
	fx.stepStatuses(performance.now());
	fx.syncStatuses(spring, "effects");
	assert.equal(made().filter((c) => c[0] === "create" && c[1] === "trapdoor").length, 1, "exactly one sprung trap");
});

test("clearStatuses forgets the last view: a remount's first sync never snaps for a trap gone meanwhile", () => {
	const before = { d4: "w:p1:p" }, after = { d5: "w:p1:p" }, v = meshes(before);
	fx.syncStatuses(cardsView(before, {}, [TRAP(null)], "w"), "effects");
	fx.clearStatuses();
	const p = v.pieces.get("d4");
	v.pieces.delete("d4");
	v.pieces.set("d5", p);
	calls = [];
	fx.syncStatuses(cardsView(after, { p1: [{ s: "frozen", left: 3, by: "b" }] }, [], "w"), "effects");
	assert.deepEqual(made().filter((c) => c[1] === "trapdoor"), []);
});

test("reduced motion: a spring makes & frees the sprung trap at once (no burst plays)", () => {
	const v = meshes({ d4: "w:p1:p" });
	fx.MODULES.trapdoor = REAL.trapdoor; // THE REAL TRAP, A SPY FROZEN (THE STUB'S PIECE HAS NO REAL GEOMETRY)
	fx.syncStatuses(cardsView({ d4: "w:p1:p" }, {}, [TRAP("d5")], "b"), "effects");
	reduce(true);
	const p = v.pieces.get("d4");
	v.pieces.delete("d4");
	v.pieces.set("d5", p);
	fx.syncStatuses(cardsView({ d5: "w:p1:p" }, { p1: [{ s: "frozen", left: 3, by: "b" }] }, [], "b"), "effects"); // A REAL SPRING: THE PIECE NEWLY FROZEN
	assert.deepEqual(fx.liveStatuses().map((e) => e.key), ["p1:frozen"]);
	assert.equal(v.scene.children.length, 1, "only the Frozen piece's square root: the sprung trap is gone");
});

test("the real sigils module goes through the frame with ringSlot & siblings (no throw)", () => {
	meshes({ c1: "w:b1:b" });
	Object.assign(fx.MODULES, REAL);
	fx.syncStatuses(cardsView({ c1: "w:b1:b" }, { b1: [{ s: "hexed", left: 1, by: "b" }] }, [OF("b1"), HS(["b1"])]), "effects");
	assert.equal(fx.liveStatuses().length, 3);
	assert.ok(realSigils && realTrapdoor);
	fx.clearStatuses();
});
