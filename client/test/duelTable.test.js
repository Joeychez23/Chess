const { test } = require("node:test");
const assert = require("node:assert/strict");
const { tableSpots, duelSpot, duelLayout, columnBox, PILES, DISCARD, DUEL_STACK, HAND_Z } = require("../src/js/gameplay/three/tableLayout.js");
const { drawDuelFace } = require("../src/js/gameplay/three/cardFaces.js");
const { PILE_AREA } = require("../src/js/gameplay/three/piles.js");
const { CARD_SIZE, DECK, cardSpots } = require("../src/js/gameplay/three/cardLayout.js");
const { FRAME_GAP, FRAME_WIDTH } = require("../src/js/gameplay/three/cards.js");
const { newGame, applyAction, playerView, legalActions } = require("../../cards-engine/index.js");
const { fromFen, sqIndex } = require("../../cards-engine/board.js");
const hand = require("../../cards-engine/hand.js");
const { register, reset } = require("../../cards-engine/cards/index.js");

reset();
register(require("../../cards-engine/cards/active/all-or-nothing.js"));

const W = CARD_SIZE.w / 2, H = CARD_SIZE.h / 2, ROW_END = 18.4 + W; // THE HAND'S ROW TODAY: 9 CARDS 4.6 APART, CENTRED ON THE BOARD
const box = (p, m = 0) => ({ x0: p.x - W - m, x1: p.x + W + m, z0: p.z - H - m, z1: p.z + H + m });
const apart = (a, b) => a.x1 <= b.x0 || b.x1 <= a.x0 || a.z1 <= b.z0 || b.z1 <= a.z0;
const sets = ["round", "spades"], sides = ["mine", "his"];
const spots = (side) => [DUEL_STACK[side], ...sets.flatMap((set) => [0, 1, 2].map((i) => duelSpot(side, set, i)))];

test("the duel's spots: the stack at the row's left end, 3 cards in line in the row, the spades set clear of the round's to the right, mirrored for Card Guy's row", () => {
	for (const side of sides) {
		const z = side === "mine" ? HAND_Z : -HAND_Z, round = [0, 1, 2].map((i) => duelSpot(side, "round", i)), spades = [0, 1, 2].map((i) => duelSpot(side, "spades", i));
		assert.ok([DUEL_STACK[side], ...round, ...spades].every((p) => p.z === z), `${side}: in the row`);
		assert.ok(Math.abs(DUEL_STACK[side].x - -18.4) < 1e-9, "the stack: where a full row's first card lies");
		assert.ok(DUEL_STACK[side].x + W < round[0].x - W, "the stack left of the duel cards");
		for (const set of [round, spades]) { assert.ok(set[0].x < set[1].x && set[1].x < set[2].x && Math.abs(set[1].x - set[0].x - 4.6) < 1e-9 && Math.abs(set[2].x - set[1].x - 4.6) < 1e-9, "in line, the hand's 4.6 apart"); }
		assert.ok(spades[0].x - W - (round[2].x + W) >= 2, "the spades set clear of the round's cards");
		assert.ok([DUEL_STACK[side], ...round, ...spades].every((p) => Math.abs(p.x) + W <= ROW_END + 1e-9), "inside the row's width today (the default camera's frame)");
	}
	spots("mine").forEach((p, i) => assert.deepEqual(spots("his")[i], { x: p.x, z: -p.z }));
});

test("the duel's spots overlap no other spot, nor the board, the places, the drop frames, the decks, the taken pieces or the promotion cards", () => {
	const all = sides.flatMap((side) => spots(side).map((p) => box(p)));
	all.forEach((a, i) => all.slice(i + 1).forEach((b) => assert.ok(apart(a, b), `${JSON.stringify(a)} ${JSON.stringify(b)}`)));
	const frame = FRAME_GAP + FRAME_WIDTH;
	const others = {
		board: { x0: -14.25, x1: 14.25, z0: -14.25, z1: 14.25 },
		takenFar: PILE_AREA, takenNear: { x0: -PILE_AREA.x1, x1: -PILE_AREA.x0, z0: -PILE_AREA.z1, z1: -PILE_AREA.z0 },
		redDeck: { x0: DECK.x - W, x1: DECK.x + W, z0: -3.36, z1: 3 }, greenDeck: { x0: -DECK.x - W, x1: -DECK.x + W, z0: -3.36, z1: 3 },
		discardMine: box(DISCARD.mine, frame), discardHis: box(DISCARD.his), landSpot: box(PILES.mineSpot, frame), landPassive: box(PILES.mine, frame),
	};
	for (const pile of Object.keys(PILES)) { for (let n = 1; n <= 7; n++) { others[`${pile}${n}`] = columnBox(pile, n); } } // SHUT OR OPENED
	cardSpots().forEach((c, i) => { others[`promotion${i}`] = box(c); });
	for (const a of all) { for (const [name, o] of Object.entries(others)) { assert.ok(apart(a, o), `${name}: ${JSON.stringify(a)}`); } }
});

test("a laid duel stacks both hands at their rows' left end, layered; the places stay where they are", () => {
	const v = {
		you: "w", effects: [{ id: "p1", owner: "w", card: { id: "p1", key: "spite" } }],
		players: {
			w: { king: true, moves: [{ id: "m1", key: "move", piece: "n" }, { id: "m2", key: "move", piece: "r" }], actives: [], passive: null, curses: [], spot: [], pile: { n: 0, top: null }, kept: null },
			b: { king: true, hand: { count: 3, shown: [] }, spot: [], pile: { n: 0, top: null }, kept: null },
		},
	};
	const row = tableSpots(v, { base: 0, layer: 1 }), stacked = tableSpots(v, { base: 0, layer: 1, stacked: true });
	const hands = [...stacked].filter(([, s]) => !s.pile && !s.discard);
	assert.equal(hands.length, 7);
	for (const [key, s] of hands) {
		const side = key.startsWith("w:") ? "mine" : "his";
		assert.deepEqual([s.x, s.z, s.y, s.hand], [DUEL_STACK[side].x, DUEL_STACK[side].z, row.get(key).y, row.get(key).hand], key);
	}
	assert.deepEqual(stacked.get("w:p1"), row.get("w:p1"));
	assert.notEqual(row.get("w:m2").x, DUEL_STACK.mine.x); // UNLAID, THE ROW AS BEFORE
});

const RANKS = "23456789TJQKA";
const C = (x) => ({ r: RANKS.indexOf(x[0]) + 2, s: x[1] });
function go(s, player, action) { return JSON.parse(JSON.stringify(applyAction(s, player, action).state)); }
function duelOn(seed = 1) { // A REAL GAME: WHITE PLAYS ALL OR NOTHING ON ITS e4 PAWN
	const s = newGame({ cardGuy: "b", level: 1300, seed });
	s.board = fromFen("4k3/8/8/8/4P3/8/8/4K3 w - - 0 1");
	const c = hand.newCard(s, "all-or-nothing");
	s.players.w.actives = [c];
	return go(s, "w", { type: "active", card: c.id, target: { piece: s.board.sq[sqIndex("e4")].id } });
}

test("duelLayout: every duel card of the view in its spot, face down until both players flipped it, the spades set beside, the won card marked in step decide", () => {
	let s = duelOn();
	s.duel.hands = { w: ["9c", "Kh", "2d"].map(C), b: ["9s", "4c", "Jd"].map(C) };
	s = go(s, "w", { type: "duel", pick: 0 });
	let d = duelLayout(playerView(s, "w").duel, "w");
	assert.deepEqual(d.map((x) => x.key), ["mine:round:0", "mine:round:1", "mine:round:2", "his:round:0", "his:round:1", "his:round:2"]);
	assert.ok(d.every((x) => x.card === null && !x.won), "a pick the other hasn't matched is still face down");
	assert.deepEqual([d[1].x, d[1].z, d[4].x, d[4].z], [duelSpot("mine", "round", 1).x, HAND_Z, duelSpot("his", "round", 1).x, -HAND_Z]);
	assert.deepEqual(duelLayout(playerView(s, "b").duel, "b")[3].key, "his:round:0"); // SEEN FROM BLACK: WHITE'S ARE HIS
	s = go(s, "b", { type: "duel", pick: 0 }); // 9 AND 9: A TIE
	d = duelLayout(playerView(s, "w").duel, "w");
	assert.deepEqual(d.filter((x) => x.card).map((x) => [x.key, x.card]), [["mine:round:0", { r: 9, s: "c" }], ["his:round:0", { r: 9, s: "s" }]]);
	assert.ok(d.every((x) => !x.won));
	s = go(go(s, "w", { type: "duel", pick: 1 }), "b", { type: "duel", pick: 2 }); // K OVER J: WHITE WINS, STEP decide
	const v = playerView(s, "w").duel;
	assert.equal(v.step, "decide");
	d = duelLayout(v, "w");
	assert.deepEqual(d.filter((x) => x.won).map((x) => x.key), ["mine:round:1"]);
	const spades = duelLayout({ ...v, step: "pick", spades: { hands: { w: [null, null, null], b: [null, { r: 3, s: "s" }, null] }, picked: { w: [0], b: [1] } } }, "w");
	assert.deepEqual(spades.filter((x) => x.set === "spades").map((x) => x.key), ["mine:spades:0", "mine:spades:1", "mine:spades:2", "his:spades:0", "his:spades:1", "his:spades:2"]);
	assert.equal(spades.length, 12); // THE ROUND'S CARDS STAY
	assert.deepEqual([spades.find((x) => x.key === "his:spades:1").card, spades.find((x) => x.key === "his:spades:1").x], [{ r: 3, s: "s" }, duelSpot("his", "spades", 1).x]);
});

test("pickable: only the player's face-down cards of the current set", () => { // FIX ROUND 1: WAS duelPickable(x, spades), NOW duelLayout's pickable
	const v = { player: "w", step: "pick", round: 1, hands: { w: [{ r: 9, s: "c" }, null, null], b: [{ r: 9, s: "s" }, null, null] }, picked: { w: [0], b: [0] }, spades: null };
	assert.deepEqual(duelLayout(v, "w").filter((x) => x.pickable).map((x) => x.key), ["mine:round:1", "mine:round:2"]);
	const sp = { ...v, spades: { hands: { w: [null, null, null], b: [null, null, null] }, picked: { w: [], b: [] } } };
	assert.deepEqual(duelLayout(sp, "w").filter((x) => x.pickable).map((x) => x.key), ["mine:spades:0", "mine:spades:1", "mine:spades:2"]);
});

test("pickable is exactly the engine's legal picks in every view of seeded duels: in step decide, while waiting for the other pick, on the card already picked, in the spades deal (review I1)", () => {
	let r = 7;
	const rand = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648), seen = { decide: 0, waiting: 0, spades: 0, views: 0 };
	for (let seed = 1; seed <= 40; seed++) {
		let s = duelOn(seed);
		if (seed % 3 === 0) { s.duel.hands = { w: ["9c", "9h", "9d"].map(C), b: ["9s", "9c", "9h"].map(C) }; } // EVERY PICK TIES, THE SUIT SCORES TIE: A SPADES DEAL
		for (let n = 0; n < 40 && s.duel; n++) {
			const options = ["w", "b"].flatMap((p) => legalActions(s, p).filter((a) => a.type === "duel" || a.type === "choice").map((a) => [p, a]));
			if (!options.length) { break; }
			const [p, a] = options[Math.floor(rand() * options.length)];
			s = go(s, p, a.stop === true && rand() < 0.7 ? { type: "duel", stop: false } : a);
			for (const you of ["w", "b"]) {
				const v = playerView(s, you).duel;
				if (!v) { continue; }
				const set = v.spades || v, them = you === "w" ? "b" : "w", legal = legalActions(s, you).filter((x) => x.type === "duel" && x.pick !== undefined).map((x) => x.pick);
				assert.deepEqual(duelLayout(v, you).filter((x) => x.pickable).map((x) => x.index), legal, `seed ${seed}, step ${n}, seen by ${you}`);
				Object.assign(seen, { views: seen.views + 1, decide: seen.decide + (v.step === "decide"), waiting: seen.waiting + (set.picked[you].length > set.picked[them].length), spades: seen.spades + Boolean(v.spades) });
			}
		}
	}
	assert.ok(seen.decide && seen.waiting && seen.spades, JSON.stringify(seen));
});

test("won: all 3 of the winner's round cards after a suit-score win (ruling M1); only the spades card after a spades win", () => {
	let s = duelOn();
	s.duel.hands = { w: ["9c", "5c", "7c"].map(C), b: ["9s", "5h", "7d"].map(C) }; // 3 TIES, CLUBS 3 TO 1
	for (const i of [0, 1, 2]) { s = go(go(s, "w", { type: "duel", pick: i }), "b", { type: "duel", pick: i }); }
	assert.equal(playerView(s, "w").duel.step, "decide");
	assert.deepEqual(duelLayout(playerView(s, "w").duel, "w").filter((x) => x.won).map((x) => x.key), ["mine:round:0", "mine:round:1", "mine:round:2"]);
	assert.deepEqual(duelLayout(playerView(s, "b").duel, "b").filter((x) => x.won).map((x) => x.key), ["his:round:0", "his:round:1", "his:round:2"]);
	s = duelOn();
	s.duel.hands = { w: ["9c", "9h", "9d"].map(C), b: ["9s", "9c", "9h"].map(C) };
	for (const i of [0, 1, 2]) { s = go(go(s, "w", { type: "duel", pick: i }), "b", { type: "duel", pick: i }); }
	s.duel.spades.hands = { w: ["Qs", "2s", "4s"].map(C), b: ["5s", "3s", "6s"].map(C) };
	s = go(go(s, "w", { type: "duel", pick: 0 }), "b", { type: "duel", pick: 1 }); // Q OVER 3
	const v = playerView(s, "w").duel;
	assert.deepEqual([v.step, v.spades.picked], ["decide", { w: [0], b: [1] }]);
	assert.deepEqual(duelLayout(v, "w").filter((x) => x.won).map((x) => x.key), ["mine:spades:0"], "not the round's last tied card");
});

test("a duel card's face: its rank and suit, hearts and diamonds red, clubs and spades ink", () => {
	const drawn = (card) => {
		const seen = [];
		const ctx = new Proxy({ fillStyle: "", measureText: (t) => ({ width: String(t).length }) }, { get: (o, k) => (k === "fillText" ? (t) => seen.push([t, o.fillStyle]) : k in o ? o[k] : () => {}), set: (o, k, x) => { o[k] = x; return true; } });
		drawDuelFace(ctx, card, 300, 420);
		return seen;
	};
	const ace = drawn({ r: 14, s: "h" }), ten = drawn({ r: 10, s: "c" });
	assert.ok(ace.some(([t]) => t === "A") && ace.some(([t]) => t === "♥"), JSON.stringify(ace));
	assert.ok(ten.some(([t]) => t === "10") && ten.some(([t]) => t === "♣"));
	assert.ok(drawn({ r: 11, s: "s" }).some(([t]) => t === "J") && drawn({ r: 12, s: "d" }).some(([t]) => t === "Q") && drawn({ r: 13, s: "s" }).some(([t]) => t === "K"));
	const color = (seen, t) => seen.find(([x]) => x === t)[1];
	assert.equal(color(ace, "♥"), color(drawn({ r: 2, s: "d" }), "♦"));
	assert.equal(color(ten, "♣"), color(drawn({ r: 2, s: "s" }), "♠"));
	assert.notEqual(color(ace, "♥"), color(ten, "♣"));
});

test("a pick barred by Grace isn't pickable while another remains, for the player whose turn it is only (cards-engine/turn.js legalActions)", () => {
	const duel = { player: "w", piece: 1, card: "all-or-nothing", step: "pick", wins: 0, round: 1, hands: { w: [null, null, null], b: [null, null, null] }, picked: { w: [], b: [1] }, spades: null };
	const picks = (view, you = "w", d = duel) => duelLayout(d, you, view).filter((x) => x.pickable).map((x) => x.index);
	const barred = JSON.stringify({ pick: 0, type: "duel" });
	assert.deepEqual(picks(null), [0, 1, 2]);
	assert.deepEqual(picks({ barred, board: { turn: "w" } }), [1, 2]);
	assert.deepEqual(picks({ barred, board: { turn: "b" } }), [0, 1, 2]); // THE BAR IS ON THE PLAYER WHOSE TURN IT IS
	assert.deepEqual(picks({ barred: JSON.stringify({ type: "move", from: "e2", to: "e4" }), board: { turn: "w" } }), [0, 1, 2]); // ANOTHER KIND OF ACTION BARRED
	const last = { ...duel, picked: { w: [1, 2], b: [1, 2] }, hands: { w: [null, { r: 5, s: "c" }, { r: 9, s: "d" }], b: [null, { r: 5, s: "h" }, { r: 9, s: "s" }] } };
	assert.deepEqual(picks({ barred, board: { turn: "w" } }, "w", last), [0]); // THE ONLY PICK LEFT STAYS: A BARRED PICK IS LEFT OUT ONLY WHILE ANOTHER REMAINS
});
