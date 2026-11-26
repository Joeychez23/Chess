// A CARD ROUTE'S ANSWER PLAYED ON THE BOARD AS STEPS (TASK 21a C): WHAT EACH ANSWER SHOWS (cards/boardShow.js boardSteps) ON REAL VIEWS OF ENGINE GAMES, & THE STEP PLAYER (playSteps) WITH FAKE STEPS
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { boardSteps, playSteps } = require("../../src/js/gameplay/cards/boardShow.js");
const { newGame, applyAction, playerView, playerEvents, legalActions } = require("../../../cards-engine/index.js");
const { fromFen, sqName } = require("../../../cards-engine/board.js");
const { register, reset } = require("../../../cards-engine/cards/index.js");

reset();
register(require("../../../cards-engine/cards/passive/overwatch.js"));
register(require("../../../cards-engine/cards/active/swap.js"));
register(require("../../../cards-engine/cards/active/all-or-nothing.js")); // A FORFEIT BY ITS OWN SIDE (TASK 25b: HUNGER REMOVES NO PAWN, INSIDIOUS NULLIFICATION FORFEITS NONE)
register(require("../../../cards-engine/cards/active/opposing-finality.js"));

const json = (x) => JSON.parse(JSON.stringify(x));
const SET = { op: "set" };

// A GAME ON THIS FEN WITH EMPTY HANDS, OVERWATCH PLACED FOR owner (null: NONE), & A FOG OF WAR OF fog's (null: NONE)
function game(fen, owner, fog = null) {
	const s = newGame({ cardGuy: "b", level: 1300, seed: 1 });
	s.board = fromFen(fen);
	for (const c of ["w", "b"]) { Object.assign(s.players[c], { moves: [], actives: [], passive: null }); }
	if (owner) { s.effects.push({ id: "c801", owner, card: { id: "c801", key: "overwatch" }, placedAt: s.ply }); }
	if (fog) { s.enchant.push({ id: "e1", key: "fog-of-war", owner: fog, pieces: [], left: 2, data: {} }); }
	return s;
}

// player PLAYS from-to WITH A MOVE CARD OF piece (card "king": THE KING CARD), PROMOTING TO promotion WHEN GIVEN; THE STEPS OF THE ANSWER AS THE CARD ROUTES GIVE IT TO WHITE (cardsResponse)
function steps(s, player, from, to, piece, promotion) {
	if (piece !== "king") { s.players[player].moves = [{ id: "t1", key: "move", piece }]; }
	const r = applyAction(s, player, { type: "move", card: piece === "king" ? "king" : "t1", from, to, ...(promotion ? { promotion } : {}) }), state = json(r.state);
	return boardSteps(playerView(s, "w"), playerView(state, "w"), playerEvents(state, r.events, "w"));
}

// player PLAYS SWAP ON ITS PIECES ON a & b; THE STEPS OF THE ANSWER AS WHITE GETS IT
function swapSteps(s, player, a, b) {
	s.players[player].actives = [{ id: "c900", key: "swap" }];
	const at = (pid) => sqName(s.board.sq.findIndex((p) => p && p.id === pid));
	const action = legalActions(s, player).find((x) => x.type === "active" && x.card === "c900" && x.target.pieces.map(at).sort().join() === [a, b].sort().join());
	const r = applyAction(s, player, action), state = json(r.state);
	return boardSteps(playerView(s, "w"), playerView(state, "w"), playerEvents(state, r.events, "w"));
}

test("boardSteps: Card Guy's Overwatch on the player's move: the move, the take, the bishop out to the square and back, then the view", () => {
	assert.deepEqual(steps(game("4k3/7p/8/8/1b6/8/7P/R6K w - - 5 1", "b"), "w", "a1", "a3", "r"), [
		{ op: "move", from: "a1", to: "a3" },
		{ op: "take", square: "a3" },
		{ op: "out", from: "b4", to: "a3", piece: null },
		{ op: "back", from: "a3", to: "b4", piece: null },
		SET,
	]);
});

test("boardSteps: the player's Overwatch on Card Guy's knight hop, and on a castle's rook", () => {
	assert.deepEqual(steps(game("4k3/8/8/2n5/8/8/8/4KB2 b - - 5 1", "w"), "b", "c5", "d3", "m"), [
		{ op: "move", from: "c5", to: "d3" },
		{ op: "take", square: "d3" },
		{ op: "out", from: "f1", to: "d3", piece: null },
		{ op: "back", from: "d3", to: "f1", piece: null },
		SET,
	]);
	const s = game("4k3/7p/8/1b6/8/8/8/4K2R w K - 0 1", "b");
	s.effects.push({ id: "c802", owner: "w", card: { id: "c802", key: "t-kingguard" }, placedAt: s.ply });
	register({ key: "t-kingguard", kind: "passive", name: "t-kingguard", rarity: "common", text: "", rules: { canCapture: (st, a, t, src) => !(t.t === "k" && t.c === src.owner) } }); // THE BISHOP CAN'T TAKE THE KING, SO f1 IS NOT ATTACKED FOR CASTLING
	assert.deepEqual(steps(s, "w", "e1", "g1", "king"), [
		{ op: "move", from: "e1", to: "g1" },
		{ op: "take", square: "f1" },
		{ op: "out", from: "b5", to: "f1", piece: null },
		{ op: "back", from: "f1", to: "b5", piece: null },
		SET,
	]);
});

test("boardSteps: under Card Guy's Fog of War his hidden bishop shows for the shot: out and back carry it (not in the previous view)", () => {
	const s = game("4k3/7p/2b5/8/8/8/7P/R5K1 w - - 5 1", "b", "b");
	assert.equal(playerView(s, "w").board.sq[18], null, "c6 hidden before");
	assert.deepEqual(steps(s, "w", "a1", "a4", "r"), [
		{ op: "move", from: "a1", to: "a4" },
		{ op: "take", square: "a4" },
		{ op: "out", from: "c6", to: "a4", piece: { c: "b", t: "b" } },
		{ op: "back", from: "a4", to: "c6", piece: { c: "b", t: "b" } },
		SET,
	]);
});

test("boardSteps: a Swap that lands a piece on a watched square is one swap step (neither piece taken), then the take on the swapped piece: Card Guy's, and the player's", () => {
	assert.deepEqual(swapSteps(game("4k2r/7p/2n5/1B6/8/8/7P/4K3 b - - 5 1", "w"), "b", "h8", "c6"), [
		{ op: "swap", a: "h8", b: "c6" },
		{ op: "take", square: "c6" },
		{ op: "out", from: "b5", to: "c6", piece: null },
		{ op: "back", from: "c6", to: "b5", piece: null },
		SET,
	], "Card Guy's rook lands on c6, the player's Bb5 shoots it");
	assert.deepEqual(swapSteps(game("4k3/7p/8/8/1b6/N7/7P/R5K1 w - - 5 1", "b"), "w", "a1", "a3"), [
		{ op: "swap", a: "a3", b: "a1" },
		{ op: "take", square: "a3" },
		{ op: "out", from: "b4", to: "a3", piece: null },
		{ op: "back", from: "a3", to: "b4", piece: null },
		SET,
	], "the player's rook lands on a3, Card Guy's Bb4 shoots it");
});

test("boardSteps: a move's own capture names the square taken (taken), so under Card Guy's fog a pawn taking a hidden piece guesses no en passant beside it", () => {
	assert.deepEqual(steps(game("3bk3/7p/8/n7/PP6/8/7P/6K1 w - - 5 1", "b", "b"), "w", "b4", "a5", "p"), [
		{ op: "move", from: "b4", to: "a5", taken: "a5" },
		{ op: "take", square: "a5" },
		{ op: "out", from: "d8", to: "a5", piece: { c: "b", t: "b" } },
		{ op: "back", from: "a5", to: "d8", piece: { c: "b", t: "b" } },
		SET,
	]);
});

test("boardSteps: a pawn promoting onto a watched square promotes in its move step, then is shot", () => {
	assert.deepEqual(steps(game("4k3/bP5p/8/8/8/8/7P/7K w - - 5 1", "b"), "w", "b7", "b8", "p", "q"), [
		{ op: "move", from: "b7", to: "b8", promotion: "q" },
		{ op: "take", square: "b8" },
		{ op: "out", from: "a7", to: "b8", piece: null },
		{ op: "back", from: "b8", to: "a7", piece: null },
		SET,
	]);
});

test("boardSteps: a hidden bishop whose shot ends the game (the view shows every piece) shows for it and is not removed after", () => {
	const s = game("4k3/8/2b5/8/8/8/8/R5K1 w - - 5 1", "b", "b");
	s.players.w.moves = [{ id: "t1", key: "move", piece: "r" }];
	const r = applyAction(s, "w", { type: "move", card: "t1", from: "a1", to: "a4" }), state = json(r.state);
	assert.ok(state.result, "K against K and B: a draw");
	assert.deepEqual(boardSteps(playerView(s, "w"), playerView(state, "w"), playerEvents(state, r.events, "w")), [
		{ op: "move", from: "a1", to: "a4" },
		{ op: "take", square: "a4" },
		{ op: "out", from: "c6", to: "a4", piece: { c: "b", t: "b" } },
		{ op: "back", from: "a4", to: "c6", piece: null },
		SET,
	]);
});

// player's action ON s; THE STEPS OF THE ANSWER AS WHITE GETS IT
function answer(s, player, action) {
	const r = applyAction(s, player, action), state = json(r.state);
	return boardSteps(playerView(s, "w"), playerView(state, "w"), playerEvents(state, r.events, "w"));
}
const pieceOn = (s, square) => s.board.sq.find((p, i) => p && sqName(i) === square).id;

test("boardSteps: a forfeit (All or Nothing's lost hand) topples the piece being promoted, the player's and Card Guy's", () => {
	for (const player of ["w", "b"]) {
		const s = game(player === "w" ? "4k3/8/8/8/8/8/P7/7K w - - 5 1" : "4k3/7p/8/8/8/8/8/7K b - - 5 1", null);
		const square = player === "w" ? "a2" : "h7";
		s.players[player].actives = [{ id: "c900", key: "all-or-nothing-epic" }]; // EPIC: THE PIECE ONLY, NO CARDS
		const played = json(applyAction(s, player, { type: "active", card: "c900", target: { piece: pieceOn(s, square) } }).state);
		const low = [2, 3, 4].map((r) => ({ r, s: "c" })), high = [14, 13, 12].map((r) => ({ r, s: "c" }));
		played.duel.hands = player === "w" ? { w: low, b: high } : { w: high, b: low }; // THE PLAYER LOSES
		const picked = json(applyAction(played, player, { type: "duel", pick: 1 }).state);
		assert.deepEqual(answer(picked, player === "w" ? "b" : "w", { type: "duel", pick: 0 }), [{ op: "topple", square }, SET], `${player}'s forfeit`);
	}
});

test("boardSteps: Opposing Finality's handover after the capture that triggers it, in the events' order: a chess capture (the capturer itself handed over), and an Overwatch shot (the shooting bishop handed over); neither topples", () => {
	const s = game("r3k3/7p/1N6/8/8/8/P7/7K w - - 5 1", null);
	s.enchant.push({ id: "e2", key: "opposing-finality", owner: "b", pieces: [pieceOn(s, "a8")], left: null, data: {} });
	s.players.w.moves = [{ id: "t1", key: "move", piece: "m" }];
	assert.deepEqual(answer(s, "w", { type: "move", card: "t1", from: "b6", to: "a8" }), [
		{ op: "move", from: "b6", to: "a8", taken: "a8" },
		{ op: "handover", from: "a8", to: "b8", c: "b" },
		SET,
	], "the knight takes the rook and is handed to Card Guy: b8 in black");
	const o = game("4k3/r6p/8/8/8/3B4/P7/7K b - - 5 1", "w");
	o.enchant.push({ id: "e2", key: "opposing-finality", owner: "b", pieces: [pieceOn(o, "a7")], left: null, data: {} });
	o.players.b.moves = [{ id: "t1", key: "move", piece: "r" }];
	assert.deepEqual(answer(o, "b", { type: "move", card: "t1", from: "a7", to: "a6" }), [
		{ op: "move", from: "a7", to: "a6" },
		{ op: "take", square: "a6" },
		{ op: "out", from: "d3", to: "a6", piece: null },
		{ op: "back", from: "a6", to: "d3", piece: null },
		{ op: "handover", from: "d3", to: "c8", c: "b" },
		SET,
	], "the player's Bd3 shoots Card Guy's enchanted rook, then goes to him: c8 in black");
});

test("boardSteps: an answer with nothing played on the board has no steps: a quiet move, a chess capture, a load", () => {
	assert.deepEqual(steps(game("4k3/7p/8/8/1b6/8/7P/R6K w - - 5 1", "b"), "w", "a1", "a2", "r"), []);
	assert.deepEqual(steps(game("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1", null), "w", "e4", "d5", "p"), []);
	const s = game("4k3/7p/8/8/1b6/8/7P/R6K w - - 5 1", "b");
	s.players.w.moves = [{ id: "t1", key: "move", piece: "r" }];
	const r = applyAction(s, "w", { type: "move", card: "t1", from: "a1", to: "a3" });
	assert.deepEqual(boardSteps(null, playerView(r.state, "w"), playerEvents(r.state, r.events, "w")), [], "no previous view");
});

test("playSteps: each step starts once the one before has ended, in order", async () => {
	const log = [];
	const run = (step) => new Promise((done) => { log.push("start " + step.op); setTimeout(() => { log.push("end " + step.op); done(); }, step.op === "take" ? 20 : 1); });
	await playSteps([{ op: "move" }, { op: "take" }, { op: "out" }, SET], run);
	assert.deepEqual(log, ["start move", "end move", "start take", "end take", "start out", "end out", "start set", "end set"]);
});

test("playSteps: a step that throws skips the steps left before the set; the set and what follows it still run, then its error is thrown", async () => {
	const ran = [], boom = new Error("boom");
	const run = async (step) => { ran.push(step.op); if (step.op === "take" || step.op === "deal") { throw boom; } };
	await assert.rejects(playSteps([{ op: "move" }, { op: "take" }, { op: "out" }, { op: "back" }, SET, { op: "end" }], run), boom);
	assert.deepEqual(ran, ["move", "take", "set", "end"]);
	ran.length = 0;
	await assert.rejects(playSteps([{ op: "flip" }, SET, { op: "deal" }], run), boom, "the trailing deal throwing");
	assert.deepEqual(ran, ["flip", "set", "deal"]);
	ran.length = 0;
	const setFails = async (step) => { ran.push(step.op); if (step.op === "set") { throw boom; } };
	await assert.rejects(playSteps([{ op: "flip" }, SET, { op: "end" }], setFails), boom, "the set throwing");
	assert.deepEqual(ran, ["flip", "set", "end"]);
});

// SYNTHETIC EVENTS (REVIEW D M1, M3): THE ORDERS A SEEDED GAME RARELY REACHES
const emptyView = (pieces) => ({ board: { sq: Array.from({ length: 64 }, (_, i) => pieces[sqName(i)] || null) } });

test("boardSteps: a pawn handed over and then removed by its new side in the same answer topples where it landed (not in the previous view there)", () => {
	const prev = emptyView({ d7: { c: "b", t: "p", id: "p9" } });
	const events = [{ type: "handover", player: "w", piece: "p9", from: "d7", to: "d2" }, { type: "capture", player: "w", piece: "p9", t: "p", c: "w", by: null, sq: "d2" }];
	assert.deepEqual(boardSteps(prev, emptyView({}), events), [{ op: "handover", from: "d7", to: "d2", c: "w" }, { op: "topple", square: "d2" }, SET]);
});

test("boardSteps: a removal right after a move is a topple, never that move's own capture", () => {
	const prev = emptyView({ e2: { c: "w", t: "p", id: "p1" }, h7: { c: "b", t: "p", id: "p2" } });
	const events = [{ type: "move", player: "w", piece: "p1", from: "e2", to: "e4" }, { type: "capture", player: "b", piece: "p2", t: "p", c: "b", by: null, sq: "h7" }];
	assert.deepEqual(boardSteps(prev, emptyView({}), events), [{ op: "move", from: "e2", to: "e4" }, { op: "topple", square: "h7" }, SET]);
});

test("a fogged forfeit told without its square (view.js drops sq under the fog) topples nothing & is no capture of the move before it: alone no steps, after a move only the move", () => {
	const prev = emptyView({ e2: { c: "w", t: "p", id: "p1" } }); // THE FORFEITED PIECE IS HIDDEN: NOT ON THE VIEWER'S BOARD
	const forfeit = { type: "capture", player: "b", piece: "p2", t: "?", c: "b", by: null };
	assert.deepEqual(boardSteps(prev, emptyView({ e2: { c: "w", t: "p", id: "p1" } }), [forfeit]), []);
	const steps = boardSteps(prev, emptyView({}), [{ type: "move", player: "w", piece: "p1", from: "e2", to: "e4" }, forfeit]);
	assert.ok(!steps.some((s) => s.op === "topple"), JSON.stringify(steps));
	assert.ok(steps.every((s) => !s.taken), JSON.stringify(steps));
});
