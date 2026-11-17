/*
 *  cards-framework.test.js  --  chess cards engine tests
 *	The card framework (cards-engine/cards/index.js, ctx.js, turn.js, rules.js): the card unit, triggers, pending choices, enchantment durations, card rules hooks
 *
 */

const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction, actionKey, playerView, fromView, IllegalAction, KING_SKULLS } = require("../../cards-engine/index.js");
const { fromFen, sqIndex } = require("../../cards-engine/board.js");
const { legalMoves, inCheck } = require("../../cards-engine/rules.js");
const { makeCtx } = require("../../cards-engine/ctx.js");
const hand = require("../../cards-engine/hand.js");
const rngMod = require("../../cards-engine/rng.js");
const { register, reset, RARITY_WEIGHTS } = require("../../cards-engine/cards/index.js");

const other = (c) => (c === "w" ? "b" : "w");
const fresh = (seed = 1) => newGame({ vesper: "b", level: 1300, seed });
const game = (fen, seed = 1) => { const s = fresh(seed); s.board = fromFen(fen); return s; };
const card = (piece, id) => ({ id, key: "move", piece });
const placed = (id, key, owner, placedAt) => ({ id, owner, card: { id, key }, placedAt });
const passive = (key, extra) => register({ key, kind: "passive", name: key, rarity: "common", text: "", ...extra });
const curse = (key, extra) => register({ key, kind: "curse", name: key, text: "", ...extra });
const active = (key, play, extra) => register({ key, kind: "active", name: key, rarity: "common", text: "", targets: () => [null], play, ...extra });
const ofType = (events, type) => events.filter((e) => e.type === type);
const at = (s, sq) => s.board.sq[sqIndex(sq)];

/**
 * @description White to move with a Pawn card that can take on d5, and Black with nothing to fire; the registry emptied.
 */
function captureGame() {
	reset();
	const s = game("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1");
	s.players.w.moves = [card("p", "t1")];
	return s;
}

test("two passives on one event fire in turn order, then placement order", () => {
	const s = captureGame(), log = [];
	passive("t-watch", { on: { capture: (ctx, owner, ev, src) => { log.push(src.card.id + owner); return true; } } });
	register({ key: "t-curse", kind: "curse", name: "t-curse", text: "", on: { capture: (ctx, owner, ev, src) => { log.push(src.card.id + owner); return true; } } });
	s.effects = [placed("c90", "t-watch", "b", 1), placed("c91", "t-watch", "w", 3), placed("c92", "t-watch", "w", 2)];
	s.players.w.curses = [{ id: "c93", key: "t-curse" }];
	s.players.b.curses = [{ id: "c94", key: "t-curse" }];
	const { state, events } = applyAction(s, "w", { type: "move", card: "t1", from: "e4", to: "d5" });
	assert.deepEqual(log, ["c92w", "c91w", "c93w", "c90b", "c94b"]); // MOVER'S PASSIVES BY placedAt, MOVER'S CURSES, THEN THE OTHER SIDE
	assert.deepEqual(ofType(events, "passive-fired").map((e) => e.card.id + e.player), ["c92w", "c91w", "c90b"]);
	assert.deepEqual(ofType(events, "curse-fired").map((e) => e.card.id + e.player), ["c93w", "c94b"]);
	assert.deepEqual(state.players.w.curses.map((c) => c.id), ["c93"]); // A CURSE THAT FIRES STAYS
	// BLACK'S TURN: BLACK'S PASSIVES FIRST
	log.length = 0;
	const t = game("4k3/8/8/4p3/3P4/8/8/4K3 b - - 0 1");
	t.players.b.moves = [card("p", "t2")];
	t.effects = [placed("c90", "t-watch", "w", 1), placed("c91", "t-watch", "b", 2)];
	applyAction(t, "b", { type: "move", card: "t2", from: "e5", to: "d4" });
	assert.deepEqual(log, ["c91b", "c90w"]);
});

test("a fired passive leaves Board Effects", () => {
	const s = captureGame();
	passive("t-once", { oncePerGame: true, on: { capture: () => true } });
	passive("t-idle", { on: { capture: () => false } });
	passive("t-cancel", { on: { capture: (ctx, owner) => { // REMOVES THE OPPONENT'S t-once BEFORE ITS TURN TO FIRE
		const s2 = ctx.state, e = s2.effects.find((x) => x.owner !== owner && x.card.key === "t-once");
		s2.effects = s2.effects.filter((x) => x !== e);
		ctx.emit({ type: "passive-cancelled", player: owner, card: e.card });
		return true;
	} } });
	s.effects = [placed("c90", "t-once", "w", 1), placed("c91", "t-idle", "w", 2), placed("c92", "t-cancel", "w", 3), placed("c93", "t-once", "b", 4)];
	const { state, events } = applyAction(s, "w", { type: "move", card: "t1", from: "e4", to: "d5" });
	assert.deepEqual(state.effects.map((e) => e.id), ["c91"]); // ONLY THE ONE THAT DIDN'T FIRE WAITS ON
	assert.deepEqual(ofType(events, "passive-fired").map((e) => [e.player, e.card.id]), [["w", "c90"], ["w", "c92"]]); // c93 WAS REMOVED, SO IT NEVER FIRED
	assert.deepEqual(state.players.w.used, ["t-once"]); // ONCE PER GAME: OUT OF THE POOL
	assert.deepEqual(state.players.b.used, []);
	const ctx = makeCtx(state);
	for (let i = 0; i < 200; i++) { state.players.w.passive = null; assert.equal(hand.drawCard(ctx, "w", "passive").key, "t-cancel"); } // t-idle WAITS, t-once IS USED
});

test("a trigger never re-enters the card that is firing, so resolution always ends", () => {
	reset();
	const s = fresh();
	register({ key: "t-greedy", kind: "curse", name: "t-greedy", text: "", on: { draw: (ctx, owner, ev) => {
		if (ev.player !== owner) return false;
		ctx.draw(owner, 1); // ITS OWN DRAW WOULD FIRE IT AGAIN, FOREVER
		return true;
	} } });
	s.players.w.curses = [{ id: "c90", key: "t-greedy" }];
	const ctx = makeCtx(s);
	ctx.draw("w", 1);
	assert.equal(ofType(ctx.events, "draw").length, 2);
	assert.equal(ofType(ctx.events, "curse-fired").length, 1);
});

test("a pending choice blocks every other action and resumes on the choice", () => {
	reset();
	const log = [];
	active("t-ask", (ctx, player) => ctx.ask(other(player), "pick", ["x", "y"], { card: "t-ask", n: 7 }), {
		choice: { resolve: (ctx, pending, option) => { log.push([pending.player, option, pending.n]); ctx.draw(pending.player, 1); } },
	});
	const s = fresh(), ply = s.ply;
	const a = legalActions(s, "w").find((x) => x.type === "active");
	const { state, events } = applyAction(s, "w", a);
	assert.deepEqual(state.pending, { card: "t-ask", n: 7, player: "b", kind: "pick", options: ["x", "y"], turn: "w", end: true, resetHalf: false });
	assert.deepEqual(events.at(-1), { type: "choice", player: "b", kind: "pick" });
	assert.equal(state.ply, ply); // THE TURN HAS NOT ENDED
	assert.equal(state.board.turn, "w");
	assert.equal(state.players.w.actives.length, 0); // NO REFILL YET
	assert.deepEqual(legalActions(state, "w"), []);
	assert.deepEqual(legalActions(state, "b"), [{ type: "choice", option: "x" }, { type: "choice", option: "y" }]);
	assert.throws(() => applyAction(state, "w", { type: "discard", card: state.players.w.moves[0].id }), IllegalAction);
	assert.throws(() => applyAction(state, "b", { type: "choice", option: "z" }), IllegalAction);
	const saved = JSON.parse(JSON.stringify(state)); // NOTHING IN pending IS A FUNCTION
	const r = applyAction(saved, "b", { type: "choice", option: "y" });
	assert.deepEqual(log, [["b", "y", 7]]);
	assert.equal(r.state.pending, null);
	assert.equal(r.state.ply, ply + 1); // THE REST OF THE TURN RAN EXACTLY ONCE
	assert.equal(r.state.board.turn, "b");
	assert.equal(r.state.players.w.actives.length, 1); // WHITE'S END-OF-TURN REFILL
	assert.deepEqual(r.events[0].player, "b"); // THE RESOLVE'S DRAW COMES FIRST
	assert.ok(legalActions(r.state, "b").some((x) => x.type === "move"));
	assert.deepEqual(legalActions(r.state, "w"), []);
});

test("an enchantment ends after its turns pass", () => {
	reset();
	active("t-spell", (ctx, player) => {
		for (const [owner, left] of [[player, 2], [other(player), 1], [player, null]]) ctx.enchant(owner, "t-spell", [], left);
	});
	let s = fresh();
	const ids = (n) => "e" + (s.nextId + n); // THE THREE ENTRIES TAKE THE NEXT ids IN ORDER
	const step = (c, type) => { const r = applyAction(s, c, legalActions(s, c).find((x) => x.type === type)); s = r.state; return r.events; };
	const [e1, e2, e3] = [ids(0), ids(1), ids(2)];
	const placed0 = step("w", "active"); // GIVEN DURING WHITE'S OWN TURN: THAT TURN DOESN'T COUNT FOR e1
	assert.deepEqual(ofType(placed0, "enchant").map((e) => [e.id, e.player, e.key]), [[e1, "w", "t-spell"], [e2, "b", "t-spell"], [e3, "w", "t-spell"]]);
	assert.deepEqual(s.enchant.map((e) => [e.id, e.left, e.data]), [[e1, 2, {}], [e2, 1, {}], [e3, null, {}]]);
	let ev = step("b", "discard"); // e2 IS BLACK'S, GIVEN ON WHITE'S TURN: BLACK'S FIRST TURN COUNTS
	assert.deepEqual(ofType(ev, "enchant-ended"), [{ type: "enchant-ended", player: "b", id: e2, key: "t-spell" }]);
	step("w", "discard");
	assert.deepEqual(s.enchant.map((e) => [e.id, e.left]), [[e1, 1], [e3, null]]);
	step("b", "discard");
	ev = step("w", "discard");
	assert.deepEqual(ofType(ev, "enchant-ended"), [{ type: "enchant-ended", player: "w", id: e1, key: "t-spell" }]);
	assert.deepEqual(s.enchant.map((e) => e.id), [e3]); // left null NEVER ENDS
});

test("a 1-turn enchantment cast on its owner's turn covers the opponent's next turn; one cast on the opponent's turn lasts the owner's next turn", () => {
	reset();
	active("t-veil", (ctx, player) => { ctx.enchant(player, "t-veil", [], 1); ctx.enchant(other(player), "t-veil", [], 1); });
	let s = fresh();
	const step = (c, type) => { s = applyAction(s, c, legalActions(s, c).find((x) => x.type === type)).state; };
	const owners = () => s.enchant.map((e) => e.owner);
	step("w", "active");
	assert.deepEqual(owners(), ["w", "b"]); // BOTH UP WHEN BLACK'S TURN STARTS
	step("b", "discard");
	assert.deepEqual(owners(), ["w"]); // BLACK'S: GONE AFTER ITS OWNER'S NEXT TURN; WHITE'S: STILL UP AFTER THE OPPONENT'S TURN
	step("w", "discard");
	assert.deepEqual(owners(), []); // WHITE'S: GONE AFTER ITS OWNER'S NEXT TURN
});

test("card rules from passives, curses and enchantments combine with statuses: AND for the checks, union for extra moves", () => {
	reset();
	const seen = [];
	passive("t-chain", { rules: { canMove: (s, p, src) => { seen.push(src.owner); return p.c === src.owner || p.t !== "n"; } } }); // OPPONENT'S KNIGHTS STUCK
	register({ key: "t-leap", kind: "curse", name: "t-leap", text: "", rules: { extraMoves: (s, p, src) => (p.c === src.owner && p.t === "r" ? [{ from: "a1", to: "b3", piece: p.id, t: "r" }] : []) } });
	register({ key: "t-shield", kind: "active", name: "t-shield", rarity: "common", text: "", rules: { canCapture: (s, a, t, src) => !src.pieces.includes(t.id) } });
	const s = game("4k3/8/8/8/8/2p1p3/3N4/R2NK3 w - - 0 1");
	const [n1, n2, pc, pe] = ["d2", "d1", "c3", "e3"].map((q) => at(s, q).id);
	const plain = legalMoves(s, "w");
	assert.ok(plain.some((m) => m.piece === n1) && plain.some((m) => m.capture === pc) && plain.some((m) => m.capture === pe));
	assert.ok(!plain.some((m) => m.from === "a1" && m.to === "b3"));
	s.effects = [placed("c90", "t-chain", "b", 1)];
	s.players.w.curses = [{ id: "c91", key: "t-leap" }];
	s.enchant = [{ id: "e1", key: "t-shield", owner: "b", pieces: [pc], left: 2, data: {} }];
	s.statuses = { [pe]: [{ s: "warded", left: 2, by: "b" }] };
	const moves = legalMoves(s, "w");
	assert.ok(!moves.some((m) => m.piece === n1 || m.piece === n2)); // THE PASSIVE STOPS BOTH KNIGHTS
	s.effects = [];
	const caps = legalMoves(s, "w").filter((m) => m.capture).map((m) => m.capture);
	assert.ok(!caps.includes(pc) && !caps.includes(pe)); // THE ENCHANTMENT WARDS c3, THE STATUS e3: BOTH HOLD
	assert.ok(legalMoves(s, "w").some((m) => m.from === "a1" && m.to === "b3")); // THE CURSE'S EXTRA MOVE
	assert.ok(seen.includes("b"));
	s.statuses = {};
	s.enchant = [];
	assert.ok(legalMoves(s, "w").filter((m) => m.capture).length >= 2);
});

test("an active that would leave its player's king in check is not offered, in or out of check", () => {
	reset();
	active("t-unpin", (ctx, player) => { ctx.state.board.sq[sqIndex("e2")] = null; }); // REMOVES THE ONLY BLOCKER
	active("t-safe", () => {});
	const s = game("4r2k/8/8/8/8/8/4B3/4K3 w - - 0 1");
	s.players.w.actives = [{ id: "c90", key: "t-unpin" }, { id: "c91", key: "t-safe" }];
	const offered = (st) => legalActions(st, "w").filter((a) => a.type === "active").map((a) => a.card);
	assert.deepEqual(offered(s), ["c91"]);
	active("t-wall", (ctx) => { ctx.state.board.sq[sqIndex("e3")] = { id: "w99", c: "w", t: "b" }; }); // BLOCKS THE CHECK
	const t = game("4r2k/8/8/8/8/8/8/4K3 w - - 0 1");
	t.players.w.actives = [{ id: "c90", key: "t-safe" }, { id: "c91", key: "t-wall" }];
	assert.ok(inCheck(t, "w"));
	assert.deepEqual(offered(t), ["c91"]); // IN CHECK: ONLY THE ONE THAT ENDS IT
});

test("a turn whose only capture came from a card's play ends with board.half 0", () => {
	reset();
	let sq = "d5"; // TAKES THE ENEMY PIECE ON sq, OFFERED ONLY WHILE THERE IS ONE
	active("t-snipe", (ctx, player) => ctx.capture(player, at(ctx.state, sq).id), { targets: (s, player) => (at(s, sq) && at(s, sq).c !== player ? [null] : []) });
	const s = game("4k3/8/8/3p4/8/8/8/R3K3 w Q - 7 1");
	s.players.w.actives = [{ id: "c90", key: "t-snipe" }];
	const { state, events } = applyAction(s, "w", { type: "active", card: "c90" });
	assert.equal(at(state, "d5"), null);
	assert.equal(state.board.half, 0);
	assert.deepEqual(state.players.b.captured, ["p"]);
	assert.equal(ofType(events, "capture").length, 1);
	const t = game("r3k3/8/8/8/8/8/8/4K3 w q - 7 1"); // A ROOK TAKEN ON ITS HOME SQUARE TAKES ITS CASTLING RIGHT WITH IT
	t.players.w.actives = [{ id: "c90", key: "t-snipe" }];
	sq = "a8";
	assert.equal(applyAction(t, "w", { type: "active", card: "c90" }).state.board.castling, "-");
});

test("active and passive draws follow rarity, never a held, waiting or used card", () => {
	reset();
	const tiers = Object.keys(RARITY_WEIGHTS), total = tiers.reduce((sum, r) => sum + RARITY_WEIGHTS[r], 0);
	assert.deepEqual(RARITY_WEIGHTS, { common: 12, uncommon: 6, rare: 3, epic: 2, legendary: 1 });
	for (const r of tiers) active("t-" + r, () => {}, { rarity: r });
	passive("t-p1");
	passive("t-p2");
	const s = fresh(), ctx = makeCtx(s), p = s.players.w, n = 10000, count = {};
	for (let i = 0; i < n; i++) {
		p.actives = [];
		const c = hand.drawCard(ctx, "w", "active");
		count[c.key] = (count[c.key] || 0) + 1;
	}
	for (const r of tiers) assert.ok(Math.abs(count["t-" + r] / n - RARITY_WEIGHTS[r] / total) < 0.03, r + " " + count["t-" + r] / n);
	p.actives = [{ id: "c90", key: "t-common" }];
	for (let i = 0; i < 300; i++) { p.actives.length = 1; assert.notEqual(hand.drawCard(ctx, "w", "active").key, "t-common"); }
	p.actives = tiers.map((r, i) => ({ id: "c9" + i, key: "t-" + r }));
	assert.equal(hand.drawCard(ctx, "w", "active"), null);
	p.used = ["t-p1"]; // A USED KEY (FIRING PUTS IT THERE: "a fired passive leaves Board Effects") IS NEVER DRAWN
	for (let i = 0; i < 300; i++) { p.passive = null; assert.equal(hand.drawCard(ctx, "w", "passive").key, "t-p2"); }
	s.effects = [placed("c93", "t-p2", "w", 1)]; // NOR IS ONE WAITING IN BOARD EFFECTS
	p.passive = null;
	assert.equal(hand.drawCard(ctx, "w", "passive"), null);
});

test("a status or enchantment given on the owner's refill draw, after the tick, lasts exactly one owner turn", () => {
	reset();
	curse("t-tremor", { on: { draw: (ctx, owner, ev) => {
		if (ev.player !== owner || ctx.turn !== owner) return false;
		const st = ctx.state, pawn = st.board.sq.find((q) => q && q.c === owner && q.t === "p");
		st.players[owner].curses = [];
		ctx.giveStatus(pawn.id, "frozen", 1, other(owner));
		ctx.enchant(owner, "t-tremor", [], 1);
		return true;
	} } });
	active("t-noop", () => {});
	let s = fresh(11);
	s.players.w.curses = [{ id: "c99", key: "t-tremor" }];
	s.players.w.actives = [{ id: "c98", key: "t-noop" }];
	s.players.w.moves = s.players.w.moves.slice(0, 5); // SO WHITE'S REFILL DRAWS A MOVE CARD
	const up = () => [Object.values(s.statuses).some((l) => l.some((e) => e.s === "frozen")), s.enchant.length === 1];
	s = applyAction(s, "w", { type: "active", card: "c98" }).state;
	assert.deepEqual(up(), [true, true]); // GIVEN AT WHITE'S REFILL
	s = applyAction(s, "b", legalActions(s, "b").find((a) => a.type === "move")).state;
	assert.deepEqual(up(), [true, true]); // UP THROUGH WHITE'S NEXT TURN
	s = applyAction(s, "w", legalActions(s, "w").find((a) => a.type === "move")).state;
	assert.deepEqual(up(), [false, false]); // AND GONE AT ITS END
});

test("choices asked twice in one action queue, each to its own player, and the turn ends once after the last", () => {
	for (const [first, second] of [["b", "w"], ["b", "b"]]) {
		reset();
		const log = [];
		active("t-ask2", (ctx) => { ctx.ask(first, "one", ["x"], { card: "t-ask2" }); ctx.ask(second, "two", ["y", "z"], { card: "t-ask2" }); }, {
			choice: { resolve: (ctx, pending, option) => log.push(pending.player + pending.kind + option) },
		});
		const s = fresh(), ply = s.ply;
		const a = legalActions(s, "w").find((x) => x.type === "active"); // ITS TRIAL ASKS TWICE AND DOESN'T THROW
		let r = applyAction(s, "w", a);
		assert.deepEqual([r.state.pending.player, r.state.pending.kind], [first, "one"]);
		assert.deepEqual(legalActions(r.state, first), [{ type: "choice", option: "x" }]);
		if (first !== second) assert.deepEqual(legalActions(r.state, second), []);
		assert.equal(r.state.ply, ply);
		r = applyAction(JSON.parse(JSON.stringify(r.state)), first, { type: "choice", option: "x" });
		assert.deepEqual([r.state.pending.player, r.state.pending.kind, r.state.ply, r.state.board.turn], [second, "two", ply, "w"]);
		assert.deepEqual(legalActions(r.state, second), [{ type: "choice", option: "y" }, { type: "choice", option: "z" }]);
		r = applyAction(JSON.parse(JSON.stringify(r.state)), second, { type: "choice", option: "z" });
		assert.equal(r.state.pending, null);
		assert.deepEqual([r.state.ply, r.state.board.turn], [ply + 1, "b"]); // THE END OF TURN RAN ONCE, AFTER THE LAST
		assert.deepEqual(log, [first + "onex", second + "twoz"]);
	}
});

test("a passive on card-played cancels an active: the card is spent, its play doesn't run, a later passive sees it cancelled", () => {
	reset();
	active("t-hit", (ctx, player) => ctx.enchant(player, "t-hit"));
	passive("t-veto", { on: { "card-played": (ctx, owner, ev) => { if (ev.player === owner) return false; ctx.cancel(); return true; } } });
	passive("t-copy", { on: { "card-played": (ctx, owner, ev) => ev.player !== owner && ctx.cancelled } });
	const s = fresh();
	s.players.w.actives = [{ id: "c90", key: "t-hit" }];
	s.effects = [placed("c91", "t-veto", "b", 1), placed("c92", "t-copy", "b", 2)];
	const { state, events } = applyAction(s, "w", { type: "active", card: "c90" });
	assert.deepEqual(state.enchant, []); // THE PLAY NEVER RAN
	assert.ok(!state.players.w.actives.some((c) => c.id === "c90")); // STILL SPENT
	assert.deepEqual(events.slice(0, 4).map((e) => e.type + (e.card ? " " + e.card.id : "")), ["card-played c90", "passive-fired c91", "passive-fired c92", "card-cancelled c90"]);
	assert.deepEqual(events[3], { type: "card-cancelled", player: "w", card: { id: "c90", key: "t-hit" } });
});

test("a card's rules.actions removes or adds actions: no actives, no castling, a cardless move that applies", () => {
	reset();
	const mine = (fn) => ({ rules: { actions: (s, player, acts, src) => (player === src.owner ? fn(acts) : acts) } });
	const castle = (a) => a.card === "king" && Math.abs(a.from.charCodeAt(0) - a.to.charCodeAt(0)) === 2;
	const cardless = { type: "move", card: null, from: "a1", to: "a2" };
	curse("t-dead-weight", mine((acts) => acts.filter((a) => a.type !== "active")));
	curse("t-shackles", mine((acts) => acts.filter((a) => !castle(a))));
	curse("t-escape", mine((acts) => [...acts, cardless]));
	active("t-any", () => {});
	const s = game("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
	s.players.w.actives = [{ id: "c90", key: "t-any" }];
	s.players.w.moves = [card("r", "t1")];
	const has = (fn) => legalActions(s, "w").some(fn);
	assert.ok(has((a) => a.type === "active") && has(castle) && !has((a) => a.card === null));
	s.players.w.curses = [{ id: "c91", key: "t-dead-weight" }];
	assert.ok(!has((a) => a.type === "active") && has((a) => a.type === "discard" && a.card === "c90") && has(castle));
	s.players.b.curses = [{ id: "c92", key: "t-shackles" }]; // THE OPPONENT'S CURSE BINDS ONLY ITS HOLDER
	assert.ok(has(castle));
	s.players.w.curses = [{ id: "c93", key: "t-shackles" }];
	assert.ok(!has(castle) && has((a) => a.card === "king" && a.to === "f1") && has((a) => a.type === "active"));
	s.players.w.curses = [{ id: "c94", key: "t-escape" }];
	assert.ok(has((a) => actionKey(a) === actionKey(cardless)));
	const { state, events } = applyAction(s, "w", cardless);
	assert.equal(at(state, "a2").t, "r");
	assert.ok(state.players.w.moves.some((c) => c.id === "t1")); // NO CARD SPENT
	assert.deepEqual([events[0].type, events[0].card, events[0].from, events[0].to], ["move", null, "a1", "a2"]);
});

test("turn-start fires at each start of turn: a held curse counts its holder's turns and fires on the third", () => {
	reset();
	curse("t-leech", { on: { "turn-start": (ctx, owner, ev, src) => ev.player === owner && ++src.card.n === 3 } });
	let s = fresh();
	s.players.b.curses = [{ id: "c90", key: "t-leech", n: 0 }];
	const fired = [];
	for (let i = 0; i < 6; i++) {
		const c = s.board.turn, r = applyAction(s, c, legalActions(s, c).find((a) => a.type === "move"));
		s = r.state;
		assert.deepEqual(ofType(r.events, "turn-start"), [{ type: "turn-start", player: other(c) }]);
		if (ofType(r.events, "curse-fired").length) fired.push(i);
	}
	assert.deepEqual(fired, [4]); // BLACK'S THIRD TURN STARTS AFTER WHITE'S THIRD ACTION
	assert.equal(s.players.b.curses[0].n, 3);
});

test("an enchantment fires through its card's on handler and ends when it returns true", () => {
	const s = captureGame(), victim = at(s, "d5").id;
	const ench = (key, on) => register({ key, kind: "active", name: key, rarity: "common", text: "", on });
	ench("t-final", { capture: (ctx, owner, ev, src) => src.pieces.includes(ev.piece) });
	ench("t-trap", { move: (ctx, owner, ev, src) => ev.player !== owner && ev.to === src.data.square });
	s.enchant = [
		{ id: "e1", key: "t-final", owner: "b", pieces: [victim], left: null, data: {} },
		{ id: "e2", key: "t-trap", owner: "b", pieces: [], left: null, data: { square: "d5" } },
		{ id: "e3", key: "t-trap", owner: "b", pieces: [], left: null, data: { square: "e5" } },
	];
	const { state, events } = applyAction(s, "w", { type: "move", card: "t1", from: "e4", to: "d5" });
	assert.deepEqual(state.enchant.map((e) => e.id), ["e3"]);
	assert.deepEqual(ofType(events, "enchant-ended"), [
		{ type: "enchant-ended", player: "b", id: "e2", key: "t-trap" }, { type: "enchant-ended", player: "b", id: "e1", key: "t-final" },
	]);
});

test("a card capture while resolving a choice inside a two-move turn still resets the half-move count", () => {
	reset();
	active("t-double", (ctx, p) => { ctx.state.multi = { player: p, left: 2, moved: [], differ: true }; });
	passive("t-ask-move", { on: { move: (ctx, o, ev) => { if (ev.player === o) return false; ctx.ask(o, "pick", ["h7"], { card: "t-ask-move" }); return true; } },
		choice: { resolve: (ctx, pend, opt) => ctx.capture(pend.player, at(ctx.state, opt).id) } });
	const s = game("4k3/7p/8/8/8/8/8/R3K2R w - - 20 1");
	s.ply = 6;
	s.players.w.actives = [{ id: "c80", key: "t-double" }];
	s.players.w.moves = [card("r", "t1"), card("r", "t2")];
	s.effects = [placed("c90", "t-ask-move", "b", 1)];
	let st = applyAction(s, "w", { type: "active", card: "c80" }).state;
	st = applyAction(st, "w", { type: "move", card: "t1", from: "a1", to: "a2" }).state;
	st = applyAction(st, "b", { type: "choice", option: "h7" }).state;
	assert.equal(st.board.half, 0);
	st = applyAction(st, "w", { type: "move", card: "t2", from: "h1", to: "h2" }).state;
	assert.equal(st.board.half, 1); // AS AFTER A CHESS CAPTURE ON THE FIRST MOVE: THE QUIET SECOND MOVE COUNTS 1
	assert.deepEqual(st.players.b.captured, ["p"]);
});

test("a game that ends with a choice pending leaves none", () => {
	reset();
	curse("t-ask-discard", { on: { discard: (ctx, owner, ev) => { if (ev.player !== owner) return false; ctx.ask(owner, "pick", ["x"], { card: "t-ask-discard" }); return true; } }, choice: { resolve: () => {} } });
	const s = fresh();
	s.players.w.skips = 2;
	s.players.w.curses = [{ id: "c90", key: "t-ask-discard" }];
	const { state } = applyAction(s, "w", { type: "discard", card: s.players.w.moves[0].id });
	assert.deepEqual(state.result, { winner: "b", reason: "skips" });
	assert.equal(state.pending, null);
});

test("legalActions is empty for a pending choice with no options (a state rebuilt from the other player's view)", () => {
	reset();
	active("t-ask", (ctx, player) => ctx.ask(other(player), "pick", ["x", "y"], { card: "t-ask" }), { choice: { resolve: () => {} } });
	const s = fresh(), state = applyAction(s, "w", legalActions(s, "w").find((x) => x.type === "active")).state;
	const f = fromView(playerView(state, "w"), 3);
	assert.deepEqual(f.pending, { player: "b", kind: "pick" });
	assert.deepEqual(legalActions(f, "b"), []);
	assert.deepEqual(legalActions(f, "w"), []);
});

test("ctx helpers guard their inputs: the enchant event's pieces is a copy, capture refuses a missing piece or a king, ask needs a card", () => {
	reset();
	const s = fresh(), ctx = makeCtx(s), pieces = ["w1"];
	ctx.enchant("w", "t-x", pieces, 2).pieces.push("w2");
	assert.deepEqual(ofType(ctx.events, "enchant")[0].pieces, ["w1"]);
	assert.throws(() => ctx.capture("w", "b99"));
	assert.equal(ctx.capture("w", s.board.sq.find((q) => q && q.c === "b" && q.t === "k").id), false); // A KING: REFUSED WITHOUT A THROW
	assert.equal(ofType(ctx.events, "capture").length, 0);
	assert.equal(Object.keys(s.board.sq).length, 64); // NO STRAY KEY FROM sq[-1]
	assert.equal(s.board.sq.filter(Boolean).length, 32);
	assert.throws(() => ctx.ask("b", "pick", ["x"], {}));
	assert.equal(s.pending, null);
});

test("a move's triggers run after the whole move is applied, in event order", () => {
	const s = captureGame(), victim = at(s, "d5").id;
	s.statuses = { [victim]: [{ s: "shaken", left: 2, by: "w" }] };
	passive("t-watch", { on: { move: (ctx) => ctx.state.players.b.captured.includes("p") && !ctx.state.statuses[victim] } });
	s.effects = [placed("c90", "t-watch", "w", 1)];
	const { events } = applyAction(s, "w", { type: "move", card: "t1", from: "e4", to: "d5" });
	assert.deepEqual(events.slice(0, 3).map((e) => e.type), ["move", "capture", "passive-fired"]);
});

test("card rules decide check, checkmate and castling", () => {
	reset();
	curse("t-no-queen-check", { rules: { givesCheck: (s, p, src) => p.t !== "q" || p.c === src.owner } });
	passive("t-yes", { rules: { givesCheck: () => true, canCapture: () => true } });
	const s = game("4k3/8/8/8/8/8/8/q3K3 w - - 0 1");
	assert.ok(inCheck(s, "w"));
	s.players.w.curses = [{ id: "c1", key: "t-no-queen-check" }];
	s.effects = [placed("c2", "t-yes", "b", 0)];
	assert.ok(!inCheck(s, "w")); // ONE SOURCE SAYING NO IS ENOUGH
	// A ROOK MATE ON THE BACK RANK, UNDONE BY A CARD OF THE MATING SIDE
	passive("t-no-rook-capture", { rules: { canCapture: (st, a) => a.t !== "r" } });
	const mate = () => { const g = game("4k3/8/4K3/8/8/8/8/R7 w - - 0 1"); g.players.w.moves = [card("r", "t1")]; return g; };
	assert.deepEqual(applyAction(mate(), "w", { type: "move", card: "t1", from: "a1", to: "a8" }).state.result, { winner: "w", reason: "checkmate" });
	const m = mate();
	m.effects = [placed("c3", "t-no-rook-capture", "w", 0)];
	const after = applyAction(m, "w", { type: "move", card: "t1", from: "a1", to: "a8" }).state;
	assert.equal(after.result, null);
	assert.ok(legalActions(after, "b").some((a) => a.card === "king"));
	// CASTLING: A ROOK THAT CAN'T MOVE CAN'T CASTLE; AN EXTRA MOVE ATTACKING f1 BLOCKS O-O
	passive("t-stop-rook", { rules: { canMove: (st, p) => p.t !== "r" } });
	passive("t-leap", { rules: { extraMoves: (st, p, src) => (p.c !== src.owner && p.t === "p" ? [{ from: "f4", to: "f1", piece: p.id, t: "p" }] : []) } });
	const c = game("4k3/8/8/8/5p2/8/8/4K2R w K - 0 1");
	assert.ok(legalMoves(c, "w").some((mv) => mv.castle));
	c.effects = [placed("c4", "t-stop-rook", "b", 0)];
	assert.ok(!legalMoves(c, "w").some((mv) => mv.castle));
	c.effects = [placed("c5", "t-leap", "w", 0)];
	assert.ok(!legalMoves(c, "w").some((mv) => mv.castle));
	assert.ok(legalMoves(c, "w").some((mv) => mv.to === "f2"));
});

test("what a handler gives the ending player during their own end-of-turn tick lasts exactly one owner turn", () => {
	const frozen = (st) => Object.values(st.statuses).some((l) => l.some((e) => e.s === "frozen"));
	const spells = (st) => st.enchant.filter((e) => e.key === "t-later").length;
	const run = (setup, measure) => {
		let s = fresh(11);
		setup(s);
		const seen = [];
		for (const c of ["w", "b", "w"]) {
			s = applyAction(s, c, legalActions(s, c).find((a) => a.type === "move")).state;
			seen.push(measure(s));
		}
		return seen;
	};
	// A 1-TURN STATUS GIVEN FROM enchant-ended (WHITE'S ENCHANTMENT RUNS OUT AT THE END OF WHITE'S TURN)
	reset();
	curse("t-on-end", { on: { "enchant-ended": (ctx, owner, ev) => {
		if (ev.player !== owner) return false;
		ctx.giveStatus(ctx.state.board.sq.find((q) => q && q.c === owner && q.t === "p").id, "frozen", 1, other(owner));
		return true;
	} } });
	assert.deepEqual(run((s) => {
		s.players.w.curses = [{ id: "c90", key: "t-on-end" }];
		s.enchant = [{ id: "e1", key: "t-spell", owner: "w", pieces: [], left: 1, data: {} }];
	}, frozen), [true, true, false]);
	// A 1-TURN ENCHANTMENT GIVEN FROM status-ended (WHITE'S PAWN'S FROZEN RUNS OUT AT THE END OF WHITE'S TURN)
	reset();
	curse("t-on-thaw", { on: { "status-ended": (ctx, owner, ev) => {
		if (ev.player !== owner || spells(ctx.state)) return false;
		ctx.enchant(owner, "t-later", [], 1);
		return true;
	} } });
	assert.deepEqual(run((s) => {
		s.players.w.curses = [{ id: "c90", key: "t-on-thaw" }];
		const pawn = s.board.sq.find((q) => q && q.c === "w" && q.t === "p");
		s.statuses = { [pawn.id]: [{ s: "frozen", left: 1, by: "b" }] };
	}, spells), [1, 1, 0]);
});

test("cardless moves a card adds are checked: not one that exposes the own king, moves an enemy piece, or repeats a piece in a two-move turn", () => {
	reset();
	let add = null;
	curse("t-add", { rules: { actions: (st, player, acts, src) => (player === src.owner && add ? [...acts, add] : acts) } });
	active("t-double", (ctx, p) => { ctx.state.multi = { player: p, left: 2, moved: [], differ: true }; });
	const tryAdd = (s, a) => {
		add = a;
		assert.ok(!legalActions(s, "w").some((x) => actionKey(x) === actionKey(a)), JSON.stringify(a));
		assert.throws(() => applyAction(s, "w", a), IllegalAction);
	};
	const pin = game("4r1k1/8/8/8/8/8/4B3/4K3 w - - 0 1");
	pin.players.w.curses = [{ id: "c90", key: "t-add" }];
	tryAdd(pin, { type: "move", card: null, from: "e2", to: "d3" }); // THE BISHOP IS PINNED
	tryAdd(pin, { type: "move", card: null, from: "e8", to: "e7" }); // BLACK'S ROOK
	tryAdd(pin, { type: "move", card: null, from: "e4", to: "e5" }); // AN EMPTY SQUARE
	add = { type: "move", card: null, from: "e1", to: "d1" };
	assert.ok(legalActions(pin, "w").some((x) => actionKey(x) === actionKey(add))); // A LEGAL ONE STAYS
	add = null;
	const s = game("4k3/8/8/8/8/8/8/R3K2R w - - 0 1");
	s.players.w.curses = [{ id: "c90", key: "t-add" }];
	s.players.w.actives = [{ id: "c80", key: "t-double" }];
	s.players.w.moves = [card("r", "t1"), card("r", "t2")];
	let st = applyAction(s, "w", { type: "active", card: "c80" }).state;
	st = applyAction(st, "w", { type: "move", card: "t1", from: "a1", to: "a2" }).state;
	tryAdd(st, { type: "move", card: null, from: "a2", to: "a3" }); // THE a-ROOK ALREADY MOVED
	add = { type: "move", card: null, from: "h1", to: "h2" };
	assert.ok(legalActions(st, "w").some((x) => actionKey(x) === actionKey(add)));
});

test("a card's own actions go through its act: a curse that clears itself, an enchantment that switches pieces", () => {
	reset();
	curse("t-debt", {
		rules: { actions: (st, player, acts, src) => (player === src.owner ? [...acts, { type: "clear", card: src.card.id }] : acts) },
		act: (ctx, player, a, src) => { ctx.state.players[player].curses = ctx.state.players[player].curses.filter((c) => c.id !== src.card.id); ctx.emit({ type: "curse-cleared", player, card: src.card }); },
	});
	register({ key: "t-cavalry", kind: "active", name: "t-cavalry", rarity: "common", text: "",
		rules: { actions: (st, player, acts, src) => (player === src.owner ? [...acts, { type: "switch", enchant: src.id }] : acts) },
		act: (ctx, player, a, src) => { src.pieces = [src.data.other]; src.data.other = null; },
	});
	const s = fresh();
	s.players.w.curses = [{ id: "c90", key: "t-debt" }];
	s.players.w.skips = 2;
	const clear = { type: "clear", card: "c90" };
	assert.ok(legalActions(s, "w").some((a) => actionKey(a) === actionKey(clear)));
	assert.ok(!legalActions(s, "b").some((a) => a.type === "clear"));
	assert.throws(() => applyAction(s, "w", { type: "clear", card: "c91" }), IllegalAction); // NO SUCH SOURCE
	const r = applyAction(s, "w", clear);
	assert.deepEqual(r.state.players.w.curses, []);
	assert.deepEqual([r.state.players.w.skips, r.state.board.turn, r.state.ply], [0, "b", s.ply + 1]); // USES THE TURN, NOT A SKIP
	assert.deepEqual(r.events[0], { type: "curse-cleared", player: "w", card: { id: "c90", key: "t-debt" } });
	assert.throws(() => applyAction(r.state, "b", clear), IllegalAction);
	// IN CHECK: TRIED ON A COPY, DROPPED WHEN IT DOESN'T END THE CHECK
	const chk = game("4r2k/8/8/8/8/8/8/4K3 w - - 0 1");
	chk.players.w.curses = [{ id: "c90", key: "t-debt" }];
	assert.ok(!legalActions(chk, "w").some((a) => a.type === "clear"));
	// THE ENCHANTMENT MOVES TO THE OTHER KNIGHT
	const t = fresh(), [n1, n2] = t.board.sq.filter((q) => q && q.c === "w" && q.t === "n").map((q) => q.id);
	t.enchant = [{ id: "e1", key: "t-cavalry", owner: "w", pieces: [n1], left: null, data: { other: n2 } }];
	const sw = applyAction(t, "w", { type: "switch", enchant: "e1" }).state;
	assert.deepEqual(sw.enchant[0].pieces, [n2]);
	assert.equal(sw.board.turn, "b");
	assert.throws(() => applyAction(t, "w", { type: "switch", enchant: "e2" }), IllegalAction);
});

test("a lost turn: ctx.skipTurn makes the player lose their next turns, ticking and refilling as usual", () => {
	reset();
	active("t-stun", (ctx, player) => ctx.skipTurn(other(player)));
	const s = fresh(), half = s.board.half;
	s.players.b.skips = 1;
	const r = applyAction(s, "w", legalActions(s, "w").find((a) => a.type === "active"));
	assert.deepEqual(ofType(r.events, "turn-skipped"), [{ type: "turn-skipped", player: "b" }]);
	const types = r.events.map((e) => e.type);
	assert.equal(types[types.indexOf("turn-skipped") - 1], "turn-start"); // RIGHT AFTER BLACK'S turn-start
	assert.deepEqual([r.state.board.turn, r.state.ply, r.state.board.half], ["w", s.ply + 2, half + 2]);
	assert.deepEqual([r.state.players.b.lostTurns, r.state.players.b.skips], [0, 1]); // NOT A DISCARD SKIP
	assert.deepEqual(ofType(r.events, "turn-start").map((e) => e.player), ["b", "w"]);
	// TWO IN A ROW
	const t = fresh();
	t.players.w.actives = [{ id: "c90", key: "t-stun" }];
	active("t-stun", (ctx, player) => ctx.skipTurn(other(player), 2));
	let st = applyAction(t, "w", { type: "active", card: "c90" }).state;
	assert.deepEqual([st.board.turn, st.players.b.lostTurns], ["w", 1]);
	st = applyAction(st, "w", legalActions(st, "w").find((a) => a.type === "move")).state;
	assert.deepEqual([st.board.turn, st.players.b.lostTurns], ["w", 0]);
	st = applyAction(st, "w", legalActions(st, "w").find((a) => a.type === "move")).state;
	assert.equal(st.board.turn, "b");
	// A LOST TURN THAT STARTS IN CHECK: SEE "a player in check doesn't lose the turn" (FIX ROUND 3 RULING)
});

test("firing or ending twice in one pass happens once: a handler that ends its own entry and returns true", () => {
	const s = captureGame();
	passive("t-self", { oncePerGame: true, on: { capture: (ctx, owner, ev, src) => { ctx.passiveFired(src); return true; } } });
	register({ key: "t-self-end", kind: "active", name: "x", rarity: "common", text: "", on: { capture: (ctx, owner, ev, src) => { ctx.endEnchant(src); return true; } } });
	s.effects = [placed("c90", "t-self", "w", 1)];
	s.enchant = [{ id: "e1", key: "t-self-end", owner: "b", pieces: [], left: null, data: {} }];
	const { state, events } = applyAction(s, "w", { type: "move", card: "t1", from: "e4", to: "d5" });
	assert.equal(ofType(events, "passive-fired").length, 1);
	assert.deepEqual(state.players.w.used, ["t-self"]);
	assert.equal(ofType(events, "enchant-ended").length, 1);
});

test("an enchantment's own card hears its own end, once, with the ended entry", () => {
	reset();
	const ends = [];
	register({ key: "t-subjection", kind: "active", name: "x", rarity: "common", text: "", on: { "enchant-ended": (ctx, owner, ev, src) => {
		ends.push(src.id);
		for (const id of src.pieces) ctx.giveStatus(id, "shaken", 1, owner);
		return true; // IGNORED
	} } });
	const s = fresh(), bishops = s.board.sq.filter((q) => q && q.c === "w" && q.t === "b").map((q) => q.id);
	s.enchant = [{ id: "e1", key: "t-subjection", owner: "w", pieces: bishops, left: 1, data: {} }];
	const { state, events } = applyAction(s, "w", legalActions(s, "w").find((a) => a.type === "move"));
	assert.deepEqual(state.enchant, []);
	assert.deepEqual(ends, ["e1"]);
	assert.deepEqual(ofType(events, "enchant-ended").length, 1);
	assert.deepEqual(ofType(events, "status").map((e) => e.piece).sort(), [...bishops].sort());
	assert.ok(bishops.every((id) => state.statuses[id] && state.statuses[id][0].s === "shaken"));
	const i = events.findIndex((e) => e.type === "enchant-ended");
	assert.ok(events.findIndex((e) => e.type === "status") > i);
});

test("a move's check event is decided after its own triggers: a removed checker gives none, a created check gives one", () => {
	reset();
	active("t-double", (ctx, p) => { ctx.state.multi = { player: p, left: 2, moved: [], differ: true }; });
	passive("t-overwatch", { on: { move: (ctx, owner, ev) => { if (ev.player === owner) return false; ctx.capture(owner, ev.piece); return true; } } });
	const s = game("4k3/8/8/8/8/8/8/R3K2R w - - 0 1");
	s.players.w.actives = [{ id: "c80", key: "t-double" }];
	s.players.w.moves = [card("r", "t1"), card("r", "t2")];
	s.effects = [placed("c90", "t-overwatch", "b", 1)];
	let r = applyAction(s, "w", { type: "active", card: "c80" });
	r = applyAction(r.state, "w", { type: "move", card: "t1", from: "a1", to: "a8" });
	assert.deepEqual(ofType(r.events, "check"), []);
	assert.equal(r.state.board.turn, "w"); // THE TWO-MOVE TURN GOES ON
	assert.equal(r.state.board.half, 0); // THE TRIGGER'S CAPTURE COUNTS
	assert.ok(legalActions(r.state, "w").some((a) => a.card === "t2"));
	reset();
	passive("t-sapper", { on: { move: (ctx, owner, ev) => { if (ev.player !== owner) return false; ctx.capture(owner, at(ctx.state, "e7").id); return true; } } });
	const t = game("4k3/4p3/8/8/8/8/8/K3R3 w - - 0 1");
	t.effects = [placed("c91", "t-sapper", "w", 1)];
	const m = applyAction(t, "w", { type: "move", card: "king", from: "a1", to: "a2" });
	assert.deepEqual(m.events.slice(0, 4).map((e) => e.type), ["move", "capture", "passive-fired", "check"]);
});

const kingMove = (s, c, to) => legalActions(s, c).find((a) => a.card === "king" && a.to === to);
const rookMove = (s, c, from, to) => legalActions(s, c).find((a) => a.type === "move" && a.from === from && a.to === to && a.card !== "king");

test("a lost turn arriving in check: with a skull it is void and played; with none it is lost and the king can be taken; out of check it is lost for free", () => {
	reset();
	const g = (skulls) => {
		const st = game("4k3/8/8/8/8/8/8/R3K3 w - - 0 1");
		st.players.w.moves = [card("r", "t1"), card("r", "t2")];
		Object.assign(st.players.b, { lostTurns: 1, kingSkulls: skulls });
		return st;
	};
	let s = g(KING_SKULLS), r = applyAction(s, "w", rookMove(s, "w", "a1", "a8"));
	assert.deepEqual([r.state.board.turn, r.state.players.b.lostTurns, r.state.players.b.kingSkulls], ["b", 0, KING_SKULLS - 1]); // VOID: BLACK PLAYS
	assert.deepEqual(ofType(r.events, "turn-skipped"), []);
	assert.deepEqual(ofType(r.events, "king-skull"), [{ type: "king-skull", player: "b", left: KING_SKULLS - 1, why: "lost-turn" }]);
	const out = applyAction(r.state, "b", kingMove(r.state, "b", "e7")).state;
	assert.ok(!inCheck(out, "b"));
	// NO SKULL: LOST EVEN IN CHECK, AND WHITE TAKES THE KING
	s = g(0);
	r = applyAction(s, "w", rookMove(s, "w", "a1", "a8"));
	assert.deepEqual([r.state.board.turn, r.state.players.b.lostTurns, ofType(r.events, "turn-skipped").length], ["w", 0, 1]);
	const take = rookMove(r.state, "w", "a8", "e8");
	assert.ok(take);
	assert.deepEqual(applyAction(r.state, "w", take).state.result, { winner: "w", reason: "king" });
	// OUT OF CHECK: LOST AS BEFORE, NO SKULL
	s = g(KING_SKULLS);
	r = applyAction(s, "w", rookMove(s, "w", "a1", "a2"));
	assert.deepEqual([r.state.board.turn, r.state.players.b.lostTurns, r.state.players.b.kingSkulls], ["w", 0, KING_SKULLS]);
	assert.deepEqual(ofType(r.events, "king-skull"), []);
});

test("a two-move turn whose first move gives check: the checked player's skull ends it; with none the second move may take the king", () => {
	reset();
	const g = (skulls) => {
		const st = game("4k3/8/8/8/8/8/8/R2Q1K2 w - - 0 1");
		st.players.w.moves = [card("r", "t1"), card("r", "t2")];
		st.multi = { player: "w", left: 2, moved: [], differ: false };
		st.players.b.kingSkulls = skulls;
		return st;
	};
	let r = applyAction(g(KING_SKULLS), "w", { type: "move", card: "t1", from: "a1", to: "a8" });
	assert.deepEqual([r.state.board.turn, r.state.multi, r.state.players.b.kingSkulls], ["b", null, KING_SKULLS - 1]);
	assert.deepEqual(ofType(r.events, "king-skull"), [{ type: "king-skull", player: "b", left: KING_SKULLS - 1, why: "double-move" }]);
	r = applyAction(g(0), "w", { type: "move", card: "t1", from: "a1", to: "a8" });
	assert.equal(r.state.board.turn, "w"); // THE TWO-MOVE TURN GOES ON
	const take = { type: "move", card: "t2", from: "a8", to: "e8" };
	assert.ok(legalActions(r.state, "w").some((a) => actionKey(a) === actionKey(take)));
	assert.deepEqual(applyAction(r.state, "w", take).state.result, { winner: "w", reason: "king" });
	r = applyAction(g(KING_SKULLS), "w", { type: "move", card: "t1", from: "a1", to: "a2" }); // NO CHECK: FREE, THE SECOND MOVE COMES
	assert.deepEqual([r.state.board.turn, r.state.players.b.kingSkulls, ofType(r.events, "king-skull").length], ["w", KING_SKULLS, 0]);
});

test("a card-defined action is tried on a copy out of check too: one that exposes its own king is not listed", () => {
	reset();
	curse("t-unpin-clear", {
		rules: { actions: (st, player, acts, src) => (player === src.owner ? [...acts, { type: "clear", card: src.card.id }] : acts) },
		act: (ctx) => { ctx.state.board.sq[sqIndex("e2")] = null; }, // REMOVES THE PIECE SHIELDING ITS OWN KING
	});
	const s = game("4r2k/8/8/8/8/8/4B3/4K3 w - - 0 1");
	s.players.w.curses = [{ id: "c90", key: "t-unpin-clear" }];
	assert.ok(!inCheck(s, "w"));
	assert.ok(!legalActions(s, "w").some((a) => a.type === "clear"));
	assert.throws(() => applyAction(s, "w", { type: "clear", card: "c90" }), IllegalAction);
});

test("capturing a king wins at once; a king left in check by a card is taken only with a legal move and a card for it", () => {
	reset();
	// BLACK'S TRAP ON e2 REMOVES THE QUEEN THAT INTERPOSED: WHITE'S KING IS LEFT IN CHECK ON BLACK'S TURN
	register({ key: "t-trap", kind: "active", name: "x", rarity: "common", text: "", on: { move: (ctx, o, ev, src) => {
		if (ev.player === o || ev.to !== src.data.square) return false;
		ctx.capture(o, ev.piece);
		return true;
	} } });
	const start = () => {
		const s = game("4r2k/8/8/8/8/8/8/3QK3 w - - 0 1");
		s.players.w.moves = [card("q", "t1")];
		s.enchant = [{ id: "e1", key: "t-trap", owner: "b", pieces: [], left: null, data: { square: "e2" } }];
		return applyAction(s, "w", { type: "move", card: "t1", from: "d1", to: "e2" }).state;
	};
	let s = start();
	assert.ok(inCheck(s, "w") && s.board.turn === "b" && s.result === null);
	s.players.b.moves = [card("r", "t9")];
	const take = { type: "move", card: "t9", from: "e8", to: "e1" };
	assert.ok(legalActions(s, "b").some((a) => actionKey(a) === actionKey(take)));
	const kingId = at(s, "e1").id, rookId = at(s, "e8").id;
	const r = applyAction(s, "b", take);
	assert.deepEqual(r.state.result, { winner: "b", reason: "king" });
	assert.deepEqual(r.events.map((e) => e.type), ["move", "capture", "game-over"]); // NOTHING ELSE RESOLVES
	assert.deepEqual(r.events[1], { type: "capture", player: "b", piece: kingId, t: "k", c: "w", by: rookId, sq: "e1" });
	assert.deepEqual(r.state.players.w.captured, ["q", "k"]); // THE TAKEN KING JOINS ITS OWNER'S TAKEN PIECES (AFTER THE TRAPPED QUEEN)
	assert.deepEqual(legalActions(r.state, "w"), []);
	// NO ROOK CARD: PLAY GOES ON, WHITE MUST ANSWER THE CHECK ON ITS OWN TURN
	s = start();
	s.players.b.moves = [card("p", "t9")];
	assert.ok(!legalActions(s, "b").some((a) => a.to === "e1"));
	const q = applyAction(s, "b", kingMove(s, "b", "g8")).state;
	assert.equal(q.result, null);
	assert.ok(inCheck(q, "w") && q.board.turn === "w");
	assert.ok(legalActions(q, "w").length && legalActions(q, "w").every((a) => a.type === "move" || a.type === "active"));
	assert.equal(makeCtx(q).capture("b", kingId), false); // A CARD EFFECT NEVER TAKES A KING
});

test("random games with skipping, trapping and card-action cards never go on without a king or end in a false stalemate", { timeout: 60000 }, () => {
	reset();
	const R = (o) => register({ name: o.key, text: "", ...o });
	R({ key: "snipe", kind: "active", rarity: "uncommon", targets: (st, p) => st.board.sq.filter((q) => q && q.c !== p && q.t === "p").slice(0, 3).map((q) => ({ piece: q.id })), play: (ctx, p, t) => ctx.capture(p, t.piece) });
	R({ key: "stun", kind: "active", rarity: "common", targets: () => [null], play: (ctx, p) => ctx.skipTurn(other(p)) });
	R({ key: "dt", kind: "active", rarity: "uncommon", targets: () => [null], play: (ctx, p) => { ctx.state.multi = { player: p, left: 2, moved: [], differ: true }; ctx.skipTurn(p); } });
	R({ key: "unjust", kind: "passive", rarity: "common", on: { capture: (ctx, o, ev) => { if (ev.player === o || ev.c !== o) return false; ctx.skipTurn(ev.player); return true; } } });
	R({ key: "trapper", kind: "active", rarity: "common", targets: () => [null], play: (ctx, p) => ctx.enchant(p, "trap-t", [], null, { square: ["d4", "e4", "d5", "e5", "e2", "e7"][ctx.rng.int(6)] }) });
	R({ key: "trap-t", kind: "active", rarity: "rare", on: { move: (ctx, o, ev, src) => {
		if (ev.player === o || ev.to !== src.data.square) return false;
		const q = at(ctx.state, ev.to);
		if (q && q.t !== "k") ctx.capture(o, q.id);
		return true;
	} } });
	R({ key: "hexer", kind: "active", rarity: "common", targets: (st, p) => (st.players[other(p)].curses.length < 2 ? [null] : []), play: (ctx, p) => ctx.giveCurse(other(p), "debt-t", p) });
	R({ key: "debt-t", kind: "curse", rules: { actions: (st, pl, acts, src) => (pl === src.owner ? [...acts, { type: "clear", card: src.card.id }] : acts) },
		act: (ctx, pl, a, src) => { const pp = ctx.state.players[pl]; pp.curses = pp.curses.filter((c) => c.id !== src.card.id); const b = ctx.state.board, i = b.sq.findIndex((x) => x && x.c === pl && x.t === "b"); if (i >= 0) b.sq[i] = null; } }); // ITS CLEAR DROPS A BISHOP (MAY EXPOSE THE KING)
	const pickSeq = (seed) => { let x = seed * 2654435761 >>> 0 || 1; return (n) => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x % n; }; };
	const ends = {};
	for (const seed of [130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 7, 42]) {
		let s = newGame({ vesper: "b", level: 1300, seed });
		const pick = pickSeq(seed);
		for (let ply = 0; ply < 300 && !s.result; ply++) {
			const actor = s.pending ? s.pending.player : s.board.turn, acts = legalActions(s, actor);
			assert.ok(acts.length, "seed " + seed + " ply " + ply + ": no action");
			s = applyAction(s, actor, acts[pick(acts.length)]).state;
			const kings = ["w", "b"].filter((c) => s.board.sq.some((q) => q && q.c === c && q.t === "k")).length;
			if (kings < 2) assert.equal(s.result && s.result.reason, "king", "seed " + seed + " ply " + ply + ": a king is gone");
			if (s.result && s.result.reason === "stalemate") assert.ok(!inCheck(s, s.board.turn) && kings === 2, "seed " + seed + ": false stalemate");
		}
		const why = s.result ? s.result.reason : "open";
		ends[why] = (ends[why] || 0) + 1;
	}
	assert.ok(Object.keys(ends).length, JSON.stringify(ends));
});

test("move-shaped actions a card adds are checked whatever their card, and one under a card's own id goes to its act", () => {
	reset();
	let add = [];
	const acted = [];
	curse("t-mirage", {
		rules: { actions: (st, player, acts, src) => (player === src.owner ? [...acts, ...add.map((a) => (!a || a.type ? a : { type: "move", ...a, card: a.card === undefined ? src.card.id : a.card }))] : acts) },
		act: (ctx, player, a, src) => acted.push([player, src.card.id, a.from, a.to]), // MOVES NOTHING: THE TURN IS SPENT
	});
	active("t-double", (ctx, p) => { ctx.state.multi = { player: p, left: 2, moved: [], differ: true }; });
	const s = game("4r1k1/8/8/8/8/8/4B3/R3K3 w - - 0 1");
	s.players.w.curses = [{ id: "c90", key: "t-mirage" }];
	s.players.w.moves = [card("b", "t1"), card("r", "t2")];
	const listed = (st, a) => legalActions(st, "w").some((x) => actionKey(x) === actionKey(a));
	const bad = [
		{ type: "move", card: "king", from: "e2", to: "d3" }, // NOT A KING
		{ type: "move", card: "t1", from: "e2", to: "d3" }, // PINNED
		{ type: "move", card: "t2", from: "e1", to: "d1" }, // A ROOK CARD FOR THE KING
		{ type: "move", card: "t1", from: "e8", to: "e7" }, // BLACK'S ROOK
		{ type: "move", card: "zz", from: "a1", to: "a2" }, // NO SUCH CARD
		{ type: "move" },
		{ type: "active", card: "c90" }, { type: "discard", card: "king" }, { type: "passive" }, // BUILT-IN TYPES A CARD MAY NOT ADD
	];
	add = [...bad, null]; // null: A BROKEN CARD; legalActions MUST NOT THROW
	assert.doesNotThrow(() => legalActions(s, "w"));
	for (const a of bad) { assert.ok(!listed(s, a), JSON.stringify(a)); assert.throws(() => applyAction(s, "w", a), IllegalAction); }
	add = [{ from: "a1", to: "a3" }]; // UNDER THE CURSE'S OWN ID, SHAPED LIKE A ROOK CARD'S MOVE
	const mirage = { type: "move", card: "c90", from: "a1", to: "a3" };
	assert.ok(listed(s, mirage));
	const r = applyAction(s, "w", mirage);
	assert.deepEqual(acted.at(-1), ["w", "c90", "a1", "a3"]); // (EARLIER ENTRIES: THE legalActions TRIALS)
	assert.equal(at(r.state, "a1").t, "r"); // NOTHING MOVED
	assert.deepEqual([r.state.board.turn, r.state.ply], ["b", s.ply + 1]);
	// A DIFFER TWO-MOVE TURN: THE ROOK THAT MOVED CAN'T BE LISTED AGAIN THIS WAY
	add = [];
	const d = game("4k3/8/8/8/8/8/8/R3K2R w - - 0 1");
	d.players.w.curses = [{ id: "c90", key: "t-mirage" }];
	d.players.w.actives = [{ id: "c80", key: "t-double" }];
	d.players.w.moves = [card("r", "t1"), card("r", "t2")];
	let st = applyAction(d, "w", { type: "active", card: "c80" }).state;
	st = applyAction(st, "w", { type: "move", card: "t1", from: "a1", to: "a2" }).state;
	add = [{ from: "a2", to: "a3" }, { card: "t2", from: "a2", to: "a4" }];
	assert.ok(!listed(st, { type: "move", card: "c90", from: "a2", to: "a3" }));
	assert.ok(!listed(st, { type: "move", card: "t2", from: "a2", to: "a4" }));
	assert.throws(() => applyAction(st, "w", { type: "move", card: "t2", from: "a2", to: "a4" }), IllegalAction);
});

test("a card-defined action names only a source its player owns", () => {
	reset();
	register({ key: "t-any-switch", kind: "active", name: "x", rarity: "common", text: "",
		rules: { actions: (st, player, acts, src) => [...acts, { type: "switch", enchant: src.id }] }, // FORGETS TO CHECK THE OWNER
		act: (ctx, player, a, src) => { src.pieces = []; } });
	const s = fresh();
	s.enchant = [{ id: "e1", key: "t-any-switch", owner: "b", pieces: ["b1"], left: null, data: {} }];
	assert.ok(!legalActions(s, "w").some((a) => a.type === "switch"));
	assert.throws(() => applyAction(s, "w", { type: "switch", enchant: "e1" }), IllegalAction);
});

test("enchant-ended reaches the ended entry's own card and passives and curses, but not other enchantments", () => {
	reset();
	const heard = [];
	register({ key: "t-twin", kind: "active", name: "x", rarity: "common", text: "", on: { "enchant-ended": (ctx, owner, ev, src) => { heard.push(src.id + ":" + ev.id); return true; } } });
	curse("t-listen", { on: { "enchant-ended": (ctx, owner, ev) => { heard.push("curse:" + ev.id); return false; } } });
	const s = fresh();
	s.enchant = [{ id: "e1", key: "t-twin", owner: "w", pieces: [], left: 1, data: {} }, { id: "e2", key: "t-twin", owner: "b", pieces: [], left: 3, data: {} }];
	s.players.b.curses = [{ id: "c90", key: "t-listen" }];
	const r = applyAction(s, "w", legalActions(s, "w").find((a) => a.type === "move"));
	assert.deepEqual(r.state.enchant.map((e) => e.id), ["e2"]);
	assert.deepEqual(heard, ["curse:e1", "e1:e1"]);
});

test("the start-of-turn mate check counts card-defined actions: a card action that ends the check saves the game", () => {
	reset();
	curse("t-rescue", {
		rules: { actions: (st, player, acts, src) => (player === src.owner ? [...acts, { type: "clear", card: src.card.id }] : acts) },
		act: (ctx, player) => ctx.capture(player, at(ctx.state, "e1").id),
	});
	const s = game("6k1/8/8/8/8/8/4rPPP/6K1 b - - 0 1");
	s.players.b.moves = [card("r", "t1")];
	s.players.w.moves = [card("p", "t2")];
	s.players.w.curses = [{ id: "c90", key: "t-rescue" }];
	const r = applyAction(s, "b", rookMove(s, "b", "e2", "e1"));
	assert.equal(r.state.result, null);
	assert.ok(inCheck(r.state, "w"));
	assert.deepEqual(legalActions(r.state, "w").map((a) => a.type), ["clear"]);
	s.players.w.curses = [];
	assert.deepEqual(applyAction(s, "b", rookMove(s, "b", "e2", "e1")).state.result, { winner: "b", reason: "checkmate" });
});

test("the half-move count at turn start: a turn-start capture zeroes it, a lost turn after a card capture counts 1", () => {
	reset();
	curse("t-bite", { on: { "turn-start": (ctx, owner, ev) => {
		const st = ctx.state, q = st.board.sq.find((x) => x && x.c !== owner && x.t === "p");
		if (ev.player !== owner || st.bitten || !q) return false;
		st.bitten = true;
		ctx.capture(owner, q.id);
		return true;
	} } });
	let s = fresh();
	s.board.half = 5;
	s.players.b.curses = [{ id: "c90", key: "t-bite" }];
	s = applyAction(s, "w", legalActions(s, "w").find((a) => a.type === "move" && at(s, a.from).t === "n")).state;
	assert.equal(s.board.half, 0); // BLACK'S TURN-START CAPTURE
	reset();
	active("t-snipe-stun", (ctx, player) => { ctx.capture(player, ctx.state.board.sq.find((x) => x && x.c !== player && x.t === "p").id); ctx.skipTurn(other(player)); });
	const t = fresh();
	t.board.half = 5;
	t.players.w.actives = [{ id: "c80", key: "t-snipe-stun" }];
	const r = applyAction(t, "w", { type: "active", card: "c80" }).state;
	assert.deepEqual([r.board.turn, r.board.half], ["w", 1]); // WHITE'S CAPTURE: 0; BLACK'S LOST TURN: + 1
});

test("the capture event names the capturing piece, or null for a card", () => {
	const s = captureGame(), mover = at(s, "e4").id;
	const r = applyAction(s, "w", { type: "move", card: "t1", from: "e4", to: "d5" });
	assert.equal(ofType(r.events, "capture")[0].by, mover);
	const ctx = makeCtx(r.state);
	assert.equal(ctx.capture("b", at(r.state, "d5").id), true); // A REAL CAPTURE SAYS SO
	assert.deepEqual(ofType(ctx.events, "capture")[0], { type: "capture", player: "b", piece: mover, t: "p", c: "w", by: null, sq: "d5" });
});

test("a lost turn doesn't roll for a passive", () => {
	reset();
	passive("t-p");
	let lost = 0, played = 0;
	for (let seed = 1; seed <= 40; seed++) {
		for (const skip of [true, false]) {
			const s = fresh(seed);
			s.ply = 4;
			if (skip) s.players.b.lostTurns = 1;
			const r = applyAction(s, "w", legalActions(s, "w").find((a) => a.type === "move"));
			const got = r.events.some((e) => e.type === "draw" && e.player === "b" && e.card.key === "t-p");
			if (skip) lost += got; else played += got;
		}
	}
	assert.equal(lost, 0);
	assert.ok(played > 5, String(played)); // THE SAME GAMES DO ROLL WHEN THE TURN IS PLAYED
});

test("ctx.giveCurse: at most 2 held, the giver waits 5 of its own turns, with a curse-given event", () => {
	reset();
	active("t-hex", (ctx, player) => ctx.giveCurse(other(player), "t-c", player));
	curse("t-c");
	const s = fresh(), ctx = makeCtx(s);
	const c1 = ctx.giveCurse("b", "t-c", "w");
	assert.ok(/^c\d+$/.test(c1.id) && c1.key === "t-c");
	assert.deepEqual(ofType(ctx.events, "curse-given"), [{ type: "curse-given", player: "w", card: c1 }]);
	assert.equal(s.players.w.curseWait, 6); // GIVEN ON WHITE'S OWN TURN (ctx.turn "w"), BEFORE ITS TICK: 6, SO 5 OWN TURNS AFTER IT ARE BLOCKED (RULING R4-6)
	assert.equal(ctx.giveCurse("b", "t-c", "w"), false); // THE GIVER WAITS
	s.players.w.curseWait = 0;
	ctx.giveCurse("b", "t-c", "w", { piece: "n" });
	assert.equal(s.players.b.curses[1].piece, "n");
	s.players.w.curseWait = 0;
	assert.equal(ctx.giveCurse("b", "t-c", "w"), false); // BLACK ALREADY HOLDS 2
	assert.equal(s.players.b.curses.length, 2);
	// THE WAIT COUNTS DOWN AT THE END OF EACH OF THE GIVER'S OWN TURNS
	let g = fresh();
	g.players.w.actives = [{ id: "c80", key: "t-hex" }];
	g = applyAction(g, "w", { type: "active", card: "c80" }).state;
	const waits = [g.players.w.curseWait]; // AT THE START OF EACH OF WHITE'S NEXT TURNS (RULING R4-6: THE GIVING TURN DOESN'T COUNT)
	for (let i = 0; i < 5; i++) {
		g = applyAction(g, "b", legalActions(g, "b").find((a) => a.type === "move")).state;
		g = applyAction(g, "w", legalActions(g, "w").find((a) => a.type === "move")).state;
		waits.push(g.players.w.curseWait);
	}
	assert.deepEqual(waits, [5, 4, 3, 2, 1, 0]); // 5 OWN TURNS BLOCKED, THE 6TH MAY GIVE
	// GIVEN ON THE OPPONENT'S TURN (BLACK'S PASSIVE FIRES ON WHITE'S MOVE): ALSO 5 OF BLACK'S OWN TURNS
	passive("t-omen", { on: { move: (ctx, owner, ev) => ev.player !== owner && !!ctx.giveCurse(ev.player, "t-c", owner) } });
	let o = fresh();
	o.effects = [placed("c91", "t-omen", "b", 0)];
	o = applyAction(o, "w", legalActions(o, "w").find((a) => a.type === "move")).state;
	const bw = [o.players.b.curseWait];
	for (let i = 0; i < 5; i++) {
		o = applyAction(o, "b", legalActions(o, "b").find((a) => a.type === "move")).state;
		o = applyAction(o, "w", legalActions(o, "w").find((a) => a.type === "move")).state;
		bw.push(o.players.b.curseWait);
	}
	assert.deepEqual(bw, [5, 4, 3, 2, 1, 0]);
});

test("hand.newCard makes every new card: id c<nextId>", () => {
	const s = fresh(), n = s.nextId;
	assert.deepEqual(hand.newCard(s, "x", { piece: "q" }), { id: "c" + n, key: "x", piece: "q" });
	assert.equal(s.nextId, n + 1);
});

test("king skulls: only a king move past its own statuses spends one (status cleared); a king in check with no status moves for free", () => {
	reset();
	const kingOf = (st, c) => st.board.sq.find((q) => q && q.c === c && q.t === "k");
	const kingActs = (st) => legalActions(st, "w").filter((a) => a.card === "king").map((a) => a.to).sort();
	const freeze = (st) => { st.statuses = { [kingOf(st, "w").id]: [{ s: "frozen", left: 2, by: "b" }] }; return st; };
	// A FROZEN KING, NOT IN CHECK
	let s = freeze(game("4k3/8/8/8/8/8/8/4K3 w - - 0 1"));
	assert.equal(s.players.w.kingSkulls, KING_SKULLS);
	let r = applyAction(s, "w", kingMove(s, "w", "d1"));
	assert.deepEqual([r.state.players.w.kingSkulls, r.state.statuses], [KING_SKULLS - 1, {}]);
	assert.deepEqual(ofType(r.events, "king-skull"), [{ type: "king-skull", player: "w", left: KING_SKULLS - 1, why: "status" }]);
	assert.deepEqual(ofType(r.events, "status-ended").map((e) => e.s), ["frozen"]);
	s = freeze(game("4k3/8/8/8/8/8/8/4K3 w - - 0 1"));
	s.players.w.kingSkulls = 0;
	assert.deepEqual(kingActs(s), []); // NO SKULL: THE FROZEN KING STAYS
	assert.throws(() => applyAction(s, "w", { type: "move", card: "king", from: "e1", to: "d1" }), IllegalAction);
	// IN CHECK (BLACK'S ROOK ON a1), NO STATUS: FREE, WITH SKULLS OR WITH NONE
	const checked = (skulls) => { const st = game("4k3/8/8/8/8/5B2/8/r3K3 w - - 0 1"); st.players.w.moves = [card("b", "t1")]; st.players.w.kingSkulls = skulls; return st; };
	for (const n of [KING_SKULLS, 0]) {
		s = checked(n);
		assert.deepEqual(kingActs(s), ["d2", "e2", "f2"]);
		r = applyAction(s, "w", kingMove(s, "w", "e2"));
		assert.deepEqual([r.state.players.w.kingSkulls, ofType(r.events, "king-skull").length], [n, 0]);
	}
	// IN CHECK AND FROZEN: ONE SKULL (THE STATUS); WITH NONE ONLY THE BISHOP'S BLOCK REMAINS
	s = freeze(checked(KING_SKULLS));
	r = applyAction(s, "w", kingMove(s, "w", "f2"));
	assert.deepEqual([r.state.players.w.kingSkulls, r.state.statuses], [KING_SKULLS - 1, {}]);
	s = freeze(checked(0));
	assert.deepEqual(kingActs(s), []);
	assert.ok(legalActions(s, "w").some((a) => a.card === "t1" && a.from === "f3" && a.to === "d1"));
	// A QUIET KING MOVE, NO STATUSES: FREE
	s = game("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
	r = applyAction(s, "w", kingMove(s, "w", "d2"));
	assert.deepEqual([r.state.players.w.kingSkulls, ofType(r.events, "king-skull")], [KING_SKULLS, []]);
	// A SHAKEN KING CAPTURING: ONE SKULL
	s = game("4k3/8/8/8/8/8/3p4/4K3 w - - 0 1");
	s.statuses = { [kingOf(s, "w").id]: [{ s: "shaken", left: 2, by: "b" }] };
	assert.ok(!legalMoves(s, "w").some((m) => m.t === "k" && m.to === "d2")); // THE HOOKS STILL BIND THE KING
	r = applyAction(s, "w", kingMove(s, "w", "d2"));
	assert.equal(r.state.players.w.kingSkulls, KING_SKULLS - 1);
	// THE TWO KINGS NEVER STAND SIDE BY SIDE, SKULL OR NOT
	s = freeze(game("8/8/8/8/8/3k4/8/4K3 w - - 0 1"));
	assert.ok(!kingActs(s).some((to) => ["d2", "e2"].includes(to)) && kingActs(s).length > 0);
	// A FROZEN KING IN CHECK, NO SKULL, NO ANSWER IN HAND: THE REDRAW, THEN CHECKMATE BY THE CARDS
	const mate = (skulls) => { const st = freeze(game("4k3/8/8/8/8/8/1r6/4K3 b - - 0 1")); st.players.b.moves = [card("r", "t2")]; st.players.w.kingSkulls = skulls; return st; };
	r = applyAction(mate(0), "b", rookMove(mate(0), "b", "b2", "b1"));
	assert.deepEqual(r.state.result, { winner: "b", reason: "checkmate" });
	assert.equal(ofType(r.events, "redraw").length, 1);
	assert.equal(applyAction(mate(1), "b", rookMove(mate(1), "b", "b2", "b1")).state.result, null);
	// BOTH PLAYERS' SKULLS ARE PUBLIC AND SURVIVE A ROUND TRIP
	s = fresh();
	s.players.b.kingSkulls = 1;
	assert.deepEqual([playerView(s, "w").players.b.kingSkulls, playerView(s, "b").players.w.kingSkulls], [1, KING_SKULLS]);
	assert.deepEqual(JSON.parse(JSON.stringify(s)).players.b.kingSkulls, 1);
	assert.equal(fromView(playerView(s, "w"), 3).players.b.kingSkulls, 1);
});

test("a move that takes the enemy king is legal even if the mover's own king stays attacked (the game ends on it)", () => {
	reset();
	register({ key: "t-trap", kind: "active", name: "x", rarity: "common", text: "", on: { move: (ctx, o, ev, src) => {
		if (ev.player === o || ev.to !== src.data.square) return false;
		const q = at(ctx.state, ev.to);
		if (q && q.t !== "k") ctx.capture(o, q.id);
		return true;
	} } });
	const s = game("4r2k/8/8/7B/8/8/8/4K2R w - - 0 1"); // WHITE IN CHECK FROM e8; Bh5-e2 BLOCKS AND DISCOVERS Rh1 ON h8; BLACK'S TRAP TAKES THE BISHOP
	s.players.w.moves = [card("b", "t1")];
	s.enchant = [{ id: "e1", key: "t-trap", owner: "b", pieces: [], left: null, data: { square: "e2" } }];
	s.statuses = { [at(s, "h8").id]: [{ s: "frozen", left: 3, by: "w" }] };
	Object.assign(s.players.b, { kingSkulls: 0, moves: [card("r", "t9")], actives: [] });
	const r = applyAction(s, "w", { type: "move", card: "t1", from: "h5", to: "e2" }).state;
	assert.ok(inCheck(r, "w") && inCheck(r, "b"));
	assert.equal(r.result, null); // NOT CHECKMATE FOR BLACK: IT CAN TAKE THE KING
	const take = { type: "move", card: "t9", from: "e8", to: "e1" };
	assert.ok(legalActions(r, "b").some((a) => actionKey(a) === actionKey(take)));
	assert.deepEqual(applyAction(r, "b", take).state.result, { winner: "b", reason: "king" });
});

test("a skull spent on a king move is part of the move: its events come after move and capture, and no trigger can make the move stale", () => {
	reset();
	passive("t-snatch", { on: { "status-ended": (ctx, owner) => { // TRIES TO REMOVE THE PIECE THE KING IS TAKING
		const q = at(ctx.state, "d2");
		if (!q || q.t === "k") return false;
		ctx.capture(owner, q.id);
		return true;
	} } });
	const s = game("4k3/8/8/8/8/8/3p4/4K3 w - - 0 1"), king = at(s, "e1").id, pawn = at(s, "d2").id;
	s.statuses = { [king]: [{ s: "shaken", left: 2, by: "b" }] };
	s.effects = [placed("c90", "t-snatch", "b", 0)];
	const { state, events } = applyAction(s, "w", kingMove(s, "w", "d2"));
	assert.deepEqual(events.slice(0, 4).map((e) => e.type), ["move", "capture", "status-ended", "king-skull"]);
	assert.deepEqual([events[1].piece, events[1].by], [pawn, king]);
	assert.equal(at(state, "d2").id, king);
	assert.deepEqual(state.players.b.captured, ["p"]);
	assert.ok(!events.some((e) => e.type === "passive-fired")); // THE HANDLER SAW THE KING ON d2
});

test("the double-move skull is spent only when the two-move turn would go on", () => {
	reset();
	const s = game("4k3/8/8/8/8/8/8/R3K3 w - - 0 1");
	Object.assign(s.players.w, { moves: [card("r", "t1")], king: false }); // NO SECOND MOVE: NO OTHER CARD, NO KING CARD
	s.multi = { player: "w", left: 2, moved: [], differ: true };
	const r = applyAction(s, "w", { type: "move", card: "t1", from: "a1", to: "a8" });
	assert.deepEqual([r.state.board.turn, r.state.players.b.kingSkulls, ofType(r.events, "king-skull").length], ["b", KING_SKULLS, 0]);
	assert.ok(inCheck(r.state, "b"));
});

test("choice and duel are reserved: a card that adds one has it dropped, and applying one with nothing pending is illegal", () => {
	reset();
	curse("t-sneaky", {
		rules: { actions: (st, player, acts, src) => (player === src.owner ? [...acts, { type: "choice", card: src.card.id, option: 1 }, { type: "duel", card: src.card.id, pick: 0 }] : acts) },
		act: () => {},
	});
	const s = fresh();
	s.players.w.curses = [{ id: "c90", key: "t-sneaky" }];
	assert.ok(!legalActions(s, "w").some((a) => a.type === "choice" || a.type === "duel"));
	for (const a of [{ type: "choice", card: "c90", option: 1 }, { type: "duel", card: "c90", pick: 0 }, { type: "choice", option: 1 }]) assert.throws(() => applyAction(s, "w", a), IllegalAction);
});

test("a pawn that takes a king while promoting still emits promote, and the taken king's statuses leave the state", () => {
	reset();
	const s = game("k7/1P6/8/8/8/8/8/4K3 w - - 0 1"), king = at(s, "a8").id;
	s.players.w.moves = [card("p", "t1")];
	s.statuses = { [king]: [{ s: "frozen", left: 2, by: "w" }] };
	const { state, events } = applyAction(s, "w", { type: "move", card: "t1", from: "b7", to: "a8", promotion: "q" });
	assert.deepEqual(events.map((e) => e.type), ["move", "capture", "promote", "game-over"]);
	assert.deepEqual(state.result, { winner: "w", reason: "king" });
	assert.deepEqual(state.statuses, {});
});

test("the registry holds 17 actives, 23 passives and 11 curses, each with key, kind, name, text and (actives, passives) rarity", { todo: true }, () => {
	const dir = path.resolve(__dirname, "../../cards-engine/cards");
	for (const k of Object.keys(require.cache)) if (k.startsWith(dir)) delete require.cache[k]; // THE REAL REGISTRY, NOT THE ONE THE TESTS ABOVE EMPTIED
	const { CARDS, ACTIVE_KEYS, PASSIVE_KEYS, CURSE_KEYS } = require("../../cards-engine/cards/index.js");
	assert.equal(ACTIVE_KEYS.length, 17); assert.equal(PASSIVE_KEYS.length, 23); assert.equal(CURSE_KEYS.length, 11);
	for (const k of [...ACTIVE_KEYS, ...PASSIVE_KEYS, ...CURSE_KEYS]) for (const f of ["key", "kind", "name", "text"]) assert.ok(CARDS[k][f], k + " " + f);
	for (const k of [...ACTIVE_KEYS, ...PASSIVE_KEYS]) assert.ok(k in CARDS && CARDS[k].rarity in RARITY_WEIGHTS, k);
	assert.deepEqual(PASSIVE_KEYS.filter((k) => CARDS[k].oncePerGame).sort(), ["grace", "unbroken-line"]);
});

test("a check made off a chess move is announced once: by a choice's resolve, by a card-defined action, not twice by an active that already said it", () => {
	reset();
	// WHITE ROOK e1 BEHIND BLACK'S e7 PAWN: REMOVING THE PAWN CHECKS THE e8 KING
	const FEN = "4k3/4p3/8/8/8/8/8/4RK2 w - - 0 1";
	active("t-ask-cap", (ctx, p) => ctx.ask(p, "pick", ["e7"], { card: "t-ask-cap" }), { choice: { resolve: (ctx, pend, opt) => ctx.capture(pend.player, at(ctx.state, opt).id) } });
	const s = game(FEN);
	s.players.w.actives = [{ id: "c80", key: "t-ask-cap" }];
	const asked = applyAction(s, "w", { type: "active", card: "c80" });
	assert.deepEqual(ofType(asked.events, "check"), []); // NOT IN CHECK YET: THE CHOICE IS OPEN
	const chosen = applyAction(asked.state, "w", { type: "choice", option: "e7" });
	assert.ok(inCheck(chosen.state, "b"));
	assert.deepEqual(ofType(chosen.events, "check"), [{ type: "check", player: "b" }]);

	curse("t-clear-cap", {
		rules: { actions: (st, player, acts, src) => (player === src.owner ? [...acts, { type: "clear", card: src.card.id }] : acts) },
		act: (ctx, pl) => { ctx.capture(pl, at(ctx.state, "e7").id); },
	});
	const c = game(FEN);
	c.players.w.curses = [{ id: "c90", key: "t-clear-cap" }];
	assert.deepEqual(ofType(applyAction(c, "w", { type: "clear", card: "c90" }).events, "check"), [{ type: "check", player: "b" }]);

	active("t-says-check", (ctx, p) => { ctx.capture(p, at(ctx.state, "e7").id); ctx.emit({ type: "check", player: other(p) }); }, { targets: (st) => (at(st, "e7") ? [null] : []) });
	const d = game(FEN);
	d.players.w.actives = [{ id: "c81", key: "t-says-check" }];
	assert.equal(ofType(applyAction(d, "w", { type: "active", card: "c81" }).events, "check").length, 1);
});

test("a card-defined action that gives check announces it with the action, before the next turn starts (checkAfter)", () => {
	reset();
	curse("t-clear-cap2", {
		rules: { actions: (st, player, acts, src) => (player === src.owner ? [...acts, { type: "clear", card: src.card.id }] : acts) },
		act: (ctx, pl) => { ctx.capture(pl, at(ctx.state, "e7").id); },
	});
	const s = game("4k3/4p3/8/8/8/8/8/4RK2 w - - 0 1"); // REMOVING e7 OPENS THE e-FILE ON e8
	s.players.w.curses = [{ id: "c91", key: "t-clear-cap2" }];
	const types = applyAction(s, "w", { type: "clear", card: "c91" }).events.map((e) => e.type);
	assert.equal(types.filter((x) => x === "check").length, 1);
	assert.ok(types.indexOf("check") < types.indexOf("turn-start"), types.join(" "));
});

test("a capture event names the square the piece stood on: a chess capture, en passant (the pawn's square), a card's capture", () => {
	const s = game("4k3/8/8/2pP4/8/8/8/4K3 w - c6 0 1"), pawn = at(s, "c5").id;
	s.players.w.moves = [card("p", "c95")];
	const ep = applyAction(s, "w", { type: "move", card: "c95", from: "d5", to: "c6" });
	assert.deepEqual(ofType(ep.events, "capture").map((e) => [e.piece, e.sq]), [[pawn, "c5"]]);
	const FEN = "4k3/8/8/8/7r/8/8/4K2R w - - 0 1", t = game(FEN), rook = at(t, "h4").id;
	t.players.w.moves = [card("r", "c96")];
	const mv = applyAction(t, "w", { type: "move", card: "c96", from: "h1", to: "h4" });
	assert.deepEqual(ofType(mv.events, "capture").map((e) => [e.piece, e.sq]), [[rook, "h4"]]);
	const ctx = makeCtx(game(FEN));
	assert.equal(ctx.capture("w", rook), true);
	assert.deepEqual(ofType(ctx.events, "capture").map((e) => [e.piece, e.sq, e.by]), [[rook, "h4", null]]);
});

test("a trigger that leaves the mover in check during a two-move turn is announced at once, and once", () => {
	reset();
	// BLACK ROOK e8, WHITE BISHOP e2 SHIELDS THE e1 KING. THE GUARD TAKES THE BISHOP WHEN WHITE'S a-PAWN MOVES
	passive("t-snipe", { on: { move: (ctx, o, ev) => { if (ev.player === o) return false; ctx.capture(o, at(ctx.state, "e2").id); return true; } } });
	const s = game("4r1k1/8/8/8/8/8/P3B3/4K2R w - - 0 1");
	s.multi = { player: "w", left: 2, moved: [], differ: true };
	s.players.w.moves = [card("p", "t1"), card("r", "t2")];
	s.effects = [placed("c90", "t-snipe", "b", 1)];
	const { state, events } = applyAction(s, "w", { type: "move", card: "t1", from: "a2", to: "a3" });
	assert.equal(state.board.turn, "w"); // THE TWO-MOVE TURN GOES ON
	assert.ok(inCheck(state, "w"));
	assert.deepEqual(ofType(events, "check"), [{ type: "check", player: "w" }]);
});
