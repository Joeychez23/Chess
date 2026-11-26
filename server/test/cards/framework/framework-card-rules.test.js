/*
 *  framework-card-rules.test.js  --  chess cards engine tests
 *	The card framework (cards-engine/cards/index.js, ctx.js, turn/index.js, rules.js): card rules hooks and card-defined actions, and the checks they announce
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, actionKey, IllegalAction } = require("../../../../cards-engine/index.js");
const { sqIndex } = require("../../../../cards-engine/board.js");
const { legalMoves, inCheck } = require("../../../../cards-engine/rules.js");
const { register, reset } = require("../../../../cards-engine/cards/index.js");
const { other, fresh, game, card, placed, passive, curse, active, ofType, at, rookMove } = require("../../helpers/framework.js");

test("card rules from passives, curses and enchantments combine with statuses: AND for the checks, union for extra moves", () => {
	reset();
	const seen = [];
	passive("t-chain", { rules: { canMove: (s, p, src) => { seen.push(src.owner); return p.c === src.owner || p.t !== "n"; } } }); // OPPONENT'S KNIGHTS STUCK
	register({ key: "t-leap", kind: "curse", name: "t-leap", rarity: "common", text: "", rules: { extraMoves: (s, p, src) => (p.c === src.owner && p.t === "r" ? [{ from: "a1", to: "b3", piece: p.id, t: "r" }] : []) } });
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
	assert.ok(!has((a) => a.type === "active") && has((a) => a.type === "discard" && a.cards[0] === "c90") && has(castle));
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
	const clear = { type: "clear", card: "c90" };
	assert.ok(legalActions(s, "w").some((a) => actionKey(a) === actionKey(clear)));
	assert.ok(!legalActions(s, "b").some((a) => a.type === "clear"));
	assert.throws(() => applyAction(s, "w", { type: "clear", card: "c91" }), IllegalAction); // NO SUCH SOURCE
	const r = applyAction(s, "w", clear);
	assert.deepEqual(r.state.players.w.curses, []);
	assert.deepEqual([r.state.board.turn, r.state.ply], ["b", s.ply + 1]); // USES THE TURN
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
	s.players.w.moves = [card("m", "t1"), card("r", "t2")];
	const listed = (st, a) => legalActions(st, "w").some((x) => actionKey(x) === actionKey(a));
	const bad = [
		{ type: "move", card: "king", from: "e2", to: "d3" }, // NOT A KING
		{ type: "move", card: "t1", from: "e2", to: "d3" }, // PINNED
		{ type: "move", card: "t2", from: "e1", to: "d1" }, // A ROOK CARD FOR THE KING
		{ type: "move", card: "t1", from: "e8", to: "e7" }, // BLACK'S ROOK
		{ type: "move", card: "t1", from: "a1", to: "a2" }, // A KNIGHT / BISHOP CARD FOR A ROOK
		{ type: "move", card: "zz", from: "a1", to: "a2" }, // NO SUCH CARD
		{ type: "move" },
		{ type: "active", card: "c90" }, { type: "discard", cards: ["king"] }, { type: "passive" }, // BUILT-IN TYPES A CARD MAY NOT ADD
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
	// AN OLD KNIGHT CARD (FROM BEFORE THE KNIGHT / BISHOP CARD) FITS NO PIECE: A CARD CAN'T ADD ITS MOVE
	const old = game("4k3/8/8/8/8/8/8/1N2K3 w - - 0 1");
	old.players.w.curses = [{ id: "c90", key: "t-mirage" }];
	old.players.w.moves = [card("n", "t1")];
	add = [{ card: "t1", from: "b1", to: "c3" }];
	assert.ok(!listed(old, { type: "move", card: "t1", from: "b1", to: "c3" }));
	assert.throws(() => applyAction(old, "w", { type: "move", card: "t1", from: "b1", to: "c3" }), IllegalAction);
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
