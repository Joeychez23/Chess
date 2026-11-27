/*
 *  curses-fullDeck.test.js  --  chess cards engine tests
 *	Tests run after every curse and active is registered: Hollow Crown with no card moving the king, no duplicate curses, Mirage's card age, and a cancelled Mulligan.
 *
 */

const { describe, test, before } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, playerView, playerEvents } = require("../../../../cards-engine/index.js");
const { makeCtx } = require("../../../../cards-engine/ctx.js");
const hand = require("../../../../cards-engine/hand.js");
const { register, CARDS, CURSE_KEYS } = require("../../../../cards-engine/cards/index.js");
const { fresh, game, ofType, at, curse, moveCard, blind, seg3, place } = require("../../helpers/curses.js");

// WITHOUT THE KING CARD NO CARD MOVES THE HOLDER'S KING FOR THEM (ESCAPE ARTIST ALONE STILL MAY); BOUNTY'S CAP WITH AN ENTERED MIRAGE
describe("Hollow Crown: no card moves the king without the King card", () => {
	const ACTIVES = ["all-or-nothing", "cleanse", "conscription", "double-time", "fog-of-war", "foresight", "heavy-cavalry", "heretical-subjection", "hexcraft", "insidious-nullification",
		"last-stand", "mulligan", "opposing-finality", "pickpocket", "stronghold", "swap", "trapdoor"];
	before(() => {
		seg3();
		for (const k of ACTIVES) register(require("../../../../cards-engine/cards/active/" + k + ".js"));
		for (const k of ["retaliation", "unbroken-line", "bounty"]) register(require("../../../../cards-engine/cards/passive/" + k + ".js"));
	});
	const gone = (fen) => { const s = game(fen); Object.assign(s.players.w, { moves: [], actives: [], passive: null, king: false }); curse(s, "w", "hollow-crown"); return s; };
	const kingAt = (s, color) => s.board.sq.findIndex((q) => q && q.c === color && q.t === "k");
	const kingActs = (s) => legalActions(s, "w").filter((a) => a.type === "move" && a.from === "e1");

	test("Last Stand offers no king move", () => {
		const s = gone("7k/8/8/8/8/8/8/4K3 w - - 0 1"), ls = hand.newCard(s, "last-stand");
		s.players.w.actives = [ls];
		assert.ok(!legalActions(s, "w").some((a) => a.type === "active"));
		s.players.w.king = true;
		assert.ok(legalActions(s, "w").some((a) => a.type === "active")); // WITH THE KING CARD IT DOES
	});

	test("Swap (every version) offers no pair holding the holder's own king; other pairs stay", () => {
		for (const key of ["swap", "swap-epic"]) {
			const s = gone("7k/8/8/8/8/8/8/R3K2R w - - 0 1"), sw = hand.newCard(s, key), king = at(s, "e1").id;
			s.players.w.actives = [sw];
			const targets = legalActions(s, "w").filter((a) => a.type === "active").map((a) => a.target.pieces);
			assert.ok(targets.length, key);
			assert.ok(targets.every((p) => !p.includes(king)), key);
			s.players.w.king = true;
			assert.ok(legalActions(s, "w").some((a) => a.type === "active" && a.target.pieces.includes(king)), key);
		}
	});

	test("Retaliation offers no king recapture; another piece's stays", () => {
		const s = gone("3R3k/8/8/8/8/8/3n4/4K3 w - - 0 1"), r = place(s, "retaliation", "w");
		Object.assign(r, { target: at(s, "d2").id, open: true });
		const caps = legalActions(s, "w").filter((a) => a.type === "move" && a.card === null).map((a) => a.from);
		assert.deepEqual(caps, ["d8"]);
		s.players.w.king = true;
		assert.deepEqual(legalActions(s, "w").filter((a) => a.type === "move" && a.card === null).map((a) => a.from).sort(), ["d8", "e1"]);
	});

	test("no castling, Unbroken Line or not; no king move in a Double Time turn", () => {
		const s = gone("7k/8/8/8/8/8/8/4K2R w K - 0 1");
		place(s, "unbroken-line", "w");
		assert.deepEqual(kingActs(s), []);
		s.players.w.king = true;
		assert.ok(kingActs(s).some((a) => a.to === "g1"));
		const d = gone("7k/8/8/8/8/8/P7/4K3 w - - 0 1");
		d.players.w.moves = [moveCard(d, "p")];
		d.multi = { player: "w", left: 2, moved: [], differ: true };
		assert.deepEqual(kingActs(d), []);
		assert.ok(legalActions(d, "w").length);
	});

	test("sweep: no active card (every version) played by the holder moves their king", () => {
		const fen = "r3k3/1n6/8/3p4/4P3/1N1B4/PP3P2/R3K1NR w Q - 0 1";
		for (const key of ACTIVES.flatMap((k) => [k, ...Object.keys(CARDS).filter((x) => CARDS[x].base === k)])) {
			const s = gone(fen), c = hand.newCard(s, key), home = kingAt(s, "w");
			s.players.w.actives = [c];
			s.players.w.captured = ["q", "r"];
			for (const a of legalActions(s, "w").filter((x) => x.type === "active")) {
				let r = applyAction(s, "w", a);
				while (r.state.pending && r.state.pending.player === "w") r = applyAction(r.state, "w", legalActions(r.state, "w")[0]);
				assert.equal(kingAt(r.state, "w"), home, key + " " + JSON.stringify(a));
			}
		}
	});

	test("Bounty counts an entered Mirage toward the 9 cap: a stolen move card is lost at 8 real move cards plus the Mirage", () => {
		const s = fresh(), ctx = makeCtx(s);
		s.players.w.moves = Array.from({ length: 8 }, () => moveCard(s, "p"));
		curse(s, "w", "mirage", { piece: "m" }); // ENTERED (NOT WAITING): A MOVE CARD TO ITS HOLDER
		Object.assign(s.players.b, { moves: [moveCard(s, "r")], actives: [] });
		assert.ok(CARDS.bounty.on.capture(ctx, "w", { type: "capture", player: "w", c: "b", t: "q" }));
		assert.deepEqual(ofType(ctx.events, "card-taken").map((e) => e.lost), [true]);
		assert.equal(hand.moveCards(s.players.w).length, 9);
	});
});

describe("no duplicate curses", () => {
	test("the weighted pick leaves out every curse key the target holds (a waiting Mirage counts); nothing left, nothing picked", () => {
		for (let seed = 1; seed <= 40; seed++) {
			const s = fresh(seed), ctx = makeCtx(s), held = ctx.randomCurses(2);
			for (const k of held) curse(s, "b", k, k === "mirage" ? { piece: "p", waiting: true } : undefined);
			for (let i = 0; i < 30; i++) for (const k of ctx.randomCurses(1 + (i % 2), "b")) assert.ok(!held.includes(k), k);
			const rest = ctx.randomCurses(99, "b");
			assert.deepEqual(new Set(rest), new Set(CURSE_KEYS.filter((k) => !held.includes(k))));
			assert.equal(ctx.randomCurses(2, "w").length, 2); // WHITE HOLDS NONE
		}
		const s = fresh(), ctx = makeCtx(s);
		for (const k of CURSE_KEYS) curse(s, "b", k);
		assert.deepEqual(ctx.randomCurses(2, "b"), []);
		assert.ok(CARDS["bad-omen"].on.capture(ctx, "w", { type: "capture", player: "b", c: "w" })); // FIRES, NOTHING TO GIVE
		assert.equal(s.players.b.curses.length, CURSE_KEYS.length);
	});

	test("giveCurse refuses a key the target already holds: false, no change, no event, whatever the limit", () => {
		const s = fresh(), ctx = makeCtx(s);
		assert.ok(ctx.giveCurse("b", "rust", "w", { wait: false }));
		const before = JSON.stringify(s), n = ctx.events.length;
		assert.equal(ctx.giveCurse("b", "rust", "w", { wait: false }), false);
		assert.equal(ctx.giveCurse("b", "rust", "w", { max: Infinity, wait: false }), false);
		assert.equal(JSON.stringify(s), before);
		assert.equal(ctx.events.length, n);
		assert.ok(ctx.giveCurse("w", "rust", "b", { wait: false })); // THE OTHER PLAYER MAY HOLD ONE TOO
	});

	test("the curse-given event holds a copy of the curse: a later change to the held card (a Mirage entering) leaves the event as it was", () => {
		const s = fresh(), ctx = makeCtx(s), card = ctx.giveCurse("b", "mirage", "w", { wait: false }), id = card.id;
		card.id = "c999";
		assert.equal(ofType(ctx.events, "curse-given")[0].card.id, id);
	});

	test("Hexcraft (both versions) and Bad Omen never give a curse the opponent holds; the legendary's two are different", () => {
		for (let seed = 1; seed <= 60; seed++) {
			const s = game("4k3/8/8/8/8/8/PPPP4/4K3 w - - 0 1", seed), ctx = makeCtx(s), [held] = ctx.randomCurses(1);
			curse(s, "b", held);
			CARDS["hexcraft-legendary"].play(ctx, "w");
			const keys = s.players.b.curses.map((c) => c.key);
			assert.equal(keys.length, 3, "seed " + seed);
			assert.equal(new Set(keys).size, 3, keys.join());
			const h = game("4k3/8/8/8/8/8/PPPP4/4K3 w - - 0 1", seed), hctx = makeCtx(h);
			curse(h, "b", held);
			CARDS.hexcraft.play(hctx, "w");
			assert.ok(h.pending.options.length === 2 && h.pending.options[0] !== h.pending.options[1] && !h.pending.options.includes(held));
			const o = fresh(seed), octx = makeCtx(o);
			curse(o, "b", held);
			CARDS["bad-omen"].on.capture(octx, "w", { type: "capture", player: "b", c: "w" });
			assert.ok(o.players.b.curses.length === 2 && o.players.b.curses[1].key !== held);
		}
	});

	test("a passable curse passed back to a player who already holds that curse is simply lost", () => {
		const s = game("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1");
		s.players.w.moves = [moveCard(s, "p")];
		const m = curse(s, "w", "mirage", { piece: "p" }), theirs = curse(s, "b", "mirage", { piece: "p", waiting: true });
		const r = applyAction(s, "w", { type: "move", card: s.players.w.moves[0].id, from: "e4", to: "d5" });
		assert.deepEqual(r.state.players.w.curses, []);
		assert.deepEqual(ofType(r.events, "curse-cleared").map((e) => e.card.id), [m.id]);
		assert.deepEqual(ofType(r.events, "curse-given"), []);
		assert.deepEqual(r.state.players.b.curses.map((c) => c.id), [theirs.id]);
	});
});

describe("Mirage: no tell from a card's age", () => {
	const lcg = (seed) => { let x = seed >>> 0; return (n) => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x % n; }; }; // THE TEST'S OWN CHOICES, NOT THE GAME'S rng

	test("naming the oldest or the newest move card finds the Mirage no more often than chance", (t) => {
		let tries = 0, chance = 0, oldest = 0, newest = 0;
		for (let seed = 1; seed <= 40; seed++) { // 150 SEEDS MEASURED: OLDEST 608, NEWEST 574, CHANCE 574.8 OF 3449 (BEFORE THE TRADE: 937 AND 178 OF 3497, CHANCE 582.8)
			let s = fresh(seed);
			const pick = lcg(seed);
			for (let ply = 0; ply < 60 && !s.result; ply++) {
				const c = s.pending ? s.pending.player : s.board.turn, acts = legalActions(s, c);
				if (!acts.length) break;
				if (!s.players.b.curses.some((x) => x.key === "mirage")) makeCtx(s).giveCurse("b", "mirage", "w", { wait: false });
				const m = s.players.b.curses.find((x) => x.key === "mirage");
				if (c === "b" && !s.pending && m && !m.waiting) {
					const seen = playerView(s, "b").players.b.moves;
					tries++;
					chance += 1 / seen.length;
					if (seen[0].id === m.id) oldest++;
					if (seen[seen.length - 1].id === m.id) newest++;
				}
				const moves = acts.filter((a) => a.type === "move");
				s = applyAction(s, c, (moves.length ? moves : acts)[pick((moves.length ? moves : acts).length)]).state;
			}
		}
		const msg = "oldest " + oldest + ", newest " + newest + ", chance " + chance.toFixed(1) + " of " + tries;
		t.diagnostic(msg);
		assert.ok(tries >= 600, msg);
		assert.ok(oldest <= chance * 1.25 && oldest >= chance * 0.75, msg);
		assert.ok(newest <= chance * 1.25 && newest >= chance * 0.75, msg);
	});

	test("at each refill an entered Mirage trades places with a random held move card; the holder's view and events are those of a twin game with a real card in its place", () => {
		const at = new Set();
		for (let seed = 1; seed <= 30; seed++) {
			const a = fresh(seed);
			const m = curse(a, "w", "mirage", { piece: "q" });
			a.players.w.moves.pop(); // 4 REAL CARDS AND THE MIRAGE
			const b = JSON.parse(JSON.stringify(a));
			b.players.w.curses = [];
			b.players.w.moves.push({ id: m.id, key: "move", piece: "q" });
			const real = a.players.w.moves.find((c) => legalActions(a, "w").some((x) => x.card === c.id));
			if (!real) continue; // AN OPENING HAND WITH NO MOVE TO PLAY (MORE OFTEN SINCE A QUEEN COUNTS DOUBLE)
			const card = real.id; // A REAL CARD IS PLAYED: THE REFILL DRAWS ONE
			const act = legalActions(a, "w").find((x) => x.card === card), ra = applyAction(a, "w", act), rb = applyAction(b, "w", act);
			assert.deepEqual(playerEvents(ra.state, ra.events, "w"), playerEvents(rb.state, rb.events, "w"));
			assert.deepEqual(playerView(ra.state, "w").players.w, playerView(rb.state, "w").players.w);
			const now = ra.state.players.w.curses[0], twin = rb.state.players.w.moves.find((c) => c.id === now.id);
			assert.ok(now.key === "mirage" && !now.waiting && twin && twin.piece === now.piece);
			assert.equal(new Set(hand.moveCards(ra.state.players.w).map((c) => c.id)).size, 5);
			assert.deepEqual(playerView(ra.state, "b").players.w.hand.shown.map((c) => [c.id, c.key]), [[now.id, "mirage"]]); // THE GIVER SEES WHERE IT IS NOW
			assert.deepEqual(JSON.parse(JSON.stringify(ra.state)), ra.state);
			blind(ra.state, ra.events, "w");
			at.add(now.id === m.id ? "same" : ofType(rb.events, "draw").some((e) => e.card.id === now.id) ? "new" : "old");
		}
		assert.deepEqual([...at].sort(), ["new", "old", "same"]);
	});
});

describe("a cancelled Mulligan", () => {
	const cancelled = (arm) => {
		const s = fresh(), c = hand.newCard(s, "mulligan");
		s.players.w.actives = [c];
		arm(s);
		const r = applyAction(s, "w", { type: "active", card: c.id });
		assert.equal(ofType(r.events, "card-cancelled").length, 1);
		assert.deepEqual(ofType(r.events, "discard").filter((e) => e.card.key === "move"), []); // THE HAND IS KEPT
		assert.deepEqual(r.state.players.w.moves, s.players.w.moves);
		assert.ok(!r.state.players.w.actives.some((a) => a.id === c.id)); // THE CARD IS SPENT
		assert.deepEqual([r.state.board.turn, r.state.multi, r.state.ply], ["b", null, 1]); // THE TURN ENDS, AS AFTER ANY CANCELLED ACTIVE
		return r;
	};

	test("by Rust: the turn ends, the hand is kept, the card is spent", () => {
		const r = cancelled((s) => curse(s, "w", "rust"));
		assert.deepEqual(r.state.players.w.curses, []);
	});

	test("by Veto: the same", () => {
		register(require("../../../../cards-engine/cards/passive/veto.js")); // HERE, NOT AT THE TOP: THE TESTS ABOVE DRAW THEIR PASSIVES FROM THE CARDS REGISTERED THERE
		const r = cancelled((s) => s.effects.push({ id: "v1", owner: "b", card: { id: "v1", key: "veto" }, placedAt: 0 }));
		assert.ok(r.events.some((e) => e.type === "passive-fired" && e.card.key === "veto"));
	});
});
