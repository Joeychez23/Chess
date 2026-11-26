/*
 *  framework-triggers.test.js  --  chess cards engine tests
 *	The card framework (cards-engine/cards/index.js, ctx.js, turn/index.js): triggers, passives firing, enchantment durations and endings, pending choices, capture events
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, playerView, fromView, IllegalAction } = require("../../../../cards-engine/index.js");
const { inCheck } = require("../../../../cards-engine/rules.js");
const { makeCtx } = require("../../../../cards-engine/ctx.js");
const hand = require("../../../../cards-engine/hand.js");
const { register, reset } = require("../../../../cards-engine/cards/index.js");
const { other, fresh, game, card, placed, passive, curse, active, ofType, at } = require("../../helpers/framework.js");

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
	register({ key: "t-curse", kind: "curse", name: "t-curse", rarity: "common", text: "", on: { capture: (ctx, owner, ev, src) => { log.push(src.card.id + owner); return true; } } });
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
	register({ key: "t-greedy", kind: "curse", name: "t-greedy", rarity: "common", text: "", on: { draw: (ctx, owner, ev) => {
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
	assert.throws(() => applyAction(state, "w", { type: "discard", cards: [state.players.w.moves[0].id, state.players.w.moves[1].id] }), IllegalAction);
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
	let ev = step("b", "move"); // e2 IS BLACK'S, GIVEN ON WHITE'S TURN: BLACK'S FIRST TURN COUNTS
	assert.deepEqual(ofType(ev, "enchant-ended"), [{ type: "enchant-ended", player: "b", id: e2, key: "t-spell" }]);
	step("w", "move");
	assert.deepEqual(s.enchant.map((e) => [e.id, e.left]), [[e1, 1], [e3, null]]);
	step("b", "move");
	ev = step("w", "move");
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
	step("b", "move");
	assert.deepEqual(owners(), ["w"]); // BLACK'S: GONE AFTER ITS OWNER'S NEXT TURN; WHITE'S: STILL UP AFTER THE OPPONENT'S TURN
	step("w", "move");
	assert.deepEqual(owners(), []); // WHITE'S: GONE AFTER ITS OWNER'S NEXT TURN
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
	active("t-any", () => {});
	const s = game("k7/8/8/8/8/8/PP6/KB6 w - - 0 1"); // KING BOXED IN BY ITS OWN HEXED PIECES: THE ACTIVE IS THE ONLY CARD ACTION
	for (const q of ["a2", "b2", "b1"]) s.statuses[at(s, q).id] = [{ s: "hexed", left: 2, by: "b" }];
	s.players.w.actives = [{ id: "c91", key: "t-any" }];
	s.players.w.curses = [{ id: "c90", key: "t-ask-discard" }];
	const { state } = applyAction(s, "w", { type: "discard", cards: ["c91"] }); // ASKS, THEN NO CARD ACTION: THE REDRAW, THEN STALEMATE
	assert.deepEqual(state.result, { winner: null, reason: "stalemate" });
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

test("the capture event names the capturing piece, or null for a card", () => {
	const s = captureGame(), mover = at(s, "e4").id;
	const r = applyAction(s, "w", { type: "move", card: "t1", from: "e4", to: "d5" });
	assert.equal(ofType(r.events, "capture")[0].by, mover);
	const ctx = makeCtx(r.state);
	assert.equal(ctx.capture("b", at(r.state, "d5").id), true); // A REAL CAPTURE SAYS SO
	assert.deepEqual(ofType(ctx.events, "capture")[0], { type: "capture", player: "b", piece: mover, t: "p", c: "w", by: null, sq: "d5" });
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
