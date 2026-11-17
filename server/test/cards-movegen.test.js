/*
 *  cards-movegen.test.js  --  chess cards engine tests
 *	Chess move generation and legality (cards-engine/movegen.js, rules.js), checked against chess.js
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Chess } = require("chess.js");
const rng = require("../../cards-engine/rng.js");
const { fromFen, toFen, sqName, sqIndex, pieceById } = require("../../cards-engine/board.js");
const { pseudoMoves, makeMove, applyMove } = require("../../cards-engine/movegen.js");
const { attacks, inCheck, legalMoves, drawReason, hooksFor } = require("../../cards-engine/rules.js");

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const PERFT = [ // STANDARD perft POSITIONS (chessprogramming.org), DEPTHS KEPT SHORT FOR CI
	["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 3, 8902],
	["r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", 2, 2039],
	["8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", 4, 43238],
	["r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", 3, 9467],
];

const lan = (m) => m.from + m.to + (m.promotion || "");
const chessLan = (c) => c.moves({ verbose: true }).map((m) => m.lan).sort();
// CHESS.JS'S VERBOSE MOVES BUILD A FEN PER MOVE (~1.3 MS A POSITION), SO THE PER-PLY COMPARISON READS ITS INTERNAL 0X88 MOVE LIST INSTEAD
const sq88 = (s) => "abcdefgh"[s & 15] + (8 - (s >> 4));
const fastLan = (c) => c._moves().map((m) => sq88(m.from) + sq88(m.to) + (m.promotion || "")).sort();
// HOOK HELPERS: A BISHOP THAT ALSO MOVES LIKE A KING, AND THE CASTLE SIDES A POSITION ALLOWS
const kingLike = (s, p) => {
	if (p.t !== "b") return [];
	const i = pieceById(s.board, p.id), out = [];
	for (const [dr, df] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
		const r = (i >> 3) + dr, f = (i & 7) + df, v = r >= 0 && r < 8 && f >= 0 && f < 8 && s.board.sq[r * 8 + f];
		if (v === false || (v && v.c === p.c)) continue;
		out.push({ from: sqName(i), to: sqName(r * 8 + f), piece: p.id, t: p.t, ...(v ? { capture: v.id } : {}) });
	}
	return out;
};
const at = (state, name) => state.board.sq[sqIndex(name)];
const castlesOf = (fen, hooks) => {
	const state = { board: fromFen(fen) };
	return legalMoves(state, state.board.turn, null, hooks).filter((m) => m.castle).map((m) => m.castle).sort().join("");
};
const play = (state, l) => ({ board: makeMove(state.board, legalMoves(state, state.board.turn).find((m) => lan(m) === l)) });

/**
 * @description Count leaf nodes of the legal move tree.
 */
function perft(state, depth) {
	const moves = legalMoves(state, state.board.turn);
	if (depth === 1) return moves.length;
	let n = 0;
	for (const m of moves) n += perft({ board: makeMove(state.board, m) }, depth - 1);
	return n;
}

/**
 * @description The engine's draw reason must agree with chess.js for this position.
 */
function checkDraw(state, chess, where) {
	const r = drawReason(state);
	assert.equal(r !== null, chess.isDraw(), `draw vs isDraw ${where} reason=${r}`);
	if (r === "stalemate") assert.ok(chess.isStalemate(), where);
	if (r === "repetition") assert.ok(chess.isThreefoldRepetition(), where);
	if (r === "fifty") assert.ok(chess.isDrawByFiftyMoves(), where);
	if (r === "material") assert.ok(chess.isInsufficientMaterial(), where);
	return r;
}

test("perft matches the known counts", () => {
	for (const [fen, d, n] of PERFT) { assert.equal(perft({ board: fromFen(fen) }, d), n, fen); }
});

test("legal moves, check, mate and draws match chess.js over 300 random games", { timeout: 20000 }, () => {
	// SEEDED RANDOM PLAYOUTS: AT EVERY PLY THE SORTED LAN LISTS ARE EQUAL, AND inCheck / mate / drawReason AGREE WITH isCheck / isCheckmate / isDraw
	for (let seed = 1; seed <= 300; seed++) {
		const r = { rng: rng.seed(seed) }, chess = new Chess();
		let state = { board: fromFen(chess.fen()) };
		for (let ply = 0; ply < 100; ply++) {
			const where = `seed ${seed} ply ${ply} ${chess.fen()}`;
			const legal = legalMoves(state, state.board.turn), theirs = fastLan(chess);
			assert.deepEqual(legal.map(lan).sort(), theirs, where);
			if (ply % 10 === 0) assert.deepEqual(chessLan(chess), theirs, where); // THE PUBLIC LAN LIST, EVERY 10 PLIES
			assert.equal(inCheck(state, state.board.turn), chess.isCheck(), where);
			assert.equal(legal.length === 0 && inCheck(state, state.board.turn), chess.isCheckmate(), where);
			const drawn = checkDraw(state, chess, where); // COMPARED BEFORE THE BREAK, SO A STALEMATE MET IN PLAY COUNTS
			if (legal.length === 0 || drawn) break; // GAME OVER, AS chess.isGameOver()
			const pick = theirs[rng.int(r, theirs.length)];
			chess.move({ from: pick.slice(0, 2), to: pick.slice(2, 4), promotion: pick[4] });
			state = { board: makeMove(state.board, legal.find((m) => lan(m) === pick)) };
			const [a, b] = [toFen(state.board).split(" "), chess.fen().split(" ")];
			assert.deepEqual([a[0], a[1], a[2], a[4], a[5]], [b[0], b[1], b[2], b[4], b[5]], `after ${pick}, ${where}`);
			assert.ok(b[3] === "-" || a[3] === b[3], `ep after ${pick}, ${where}`); // chess.js PRINTS "-" WHEN THE CAPTURE IS NOT LEGAL
		}
		assert.equal(state.board.history.length, chess.history().length + 1, `history seed ${seed}`);
	}
});

test("draw reasons match chess.js on stalemate, material, fifty moves and repetition", () => {
	const fens = [
		["7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", "stalemate"],
		["8/8/8/4k3/8/8/8/4K3 w - - 0 1", "material"],
		["8/8/8/4k3/8/8/5N2/4K3 w - - 0 1", "material"],
		["8/8/8/4k3/8/8/5B2/4K3 w - - 0 1", "material"],
		["8/8/3b4/4k3/8/8/5B2/4K3 w - - 0 1", "material"], // BISHOPS ON THE SAME SQUARE COLOUR
		["8/8/4b3/4k3/8/8/5B2/4K3 w - - 0 1", null], // OPPOSITE COLOURS
		["8/8/8/4k3/8/8/5N2/3NK3 w - - 0 1", null], // TWO KNIGHTS ARE NOT INSUFFICIENT
		["8/8/8/4k3/8/8/5R2/4K3 w - - 0 1", null],
		["8/8/8/4k3/8/8/8/R3K3 w - - 100 80", "fifty"],
		["8/8/8/4k3/8/8/8/R3K3 w - - 99 80", null],
		[START, null],
	];
	for (const [fen, want] of fens) {
		assert.equal(checkDraw({ board: fromFen(fen) }, new Chess(fen), fen), want, fen);
	}
	// CHECKMATE ON THE 100TH HALF-MOVE IS A WIN, NOT A DRAW (chess.js's isDraw() says true here, the one place we differ on purpose)
	assert.equal(drawReason({ board: fromFen("7k/6Q1/6K1/8/8/8/8/8 b - - 100 80") }), null);
	let state = { board: fromFen(START) };
	const chess = new Chess();
	for (const l of ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"]) {
		assert.equal(drawReason(state), null);
		chess.move({ from: l.slice(0, 2), to: l.slice(2, 4) });
		state = play(state, l);
	}
	assert.equal(checkDraw(state, chess, "repetition"), "repetition");
});

test("castling needs rights, empty squares and no check out of, through or into", () => {
	const castles = (fen) => legalMoves({ board: fromFen(fen) }, fromFen(fen).turn).filter((m) => m.castle).map((m) => m.castle).sort().join("");
	assert.equal(castles("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"), "KQ");
	assert.equal(castles("r3k2r/8/8/8/8/8/8/R3K2R w Kkq - 0 1"), "K");
	assert.equal(castles("r3k2r/8/8/8/8/8/8/R3K1NR w KQkq - 0 1"), "Q"); // BLOCKED KINGSIDE
	assert.equal(castles("r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1"), "Q"); // F1 ATTACKED
	assert.equal(castles("r3k2r/8/8/8/8/6r1/8/R3K2R w KQkq - 0 1"), "Q"); // G1 ATTACKED (INTO CHECK)
	assert.equal(castles("r3k2r/8/8/8/8/3r4/8/R3K2R w KQkq - 0 1"), "K"); // D1 ATTACKED
	assert.equal(castles("r3k2r/8/8/8/8/2r5/8/R3K2R w KQkq - 0 1"), "K"); // C1 ATTACKED (INTO CHECK)
	assert.equal(castles("r3k2r/8/8/8/8/8/4r3/R3K2R w KQkq - 0 1"), ""); // IN CHECK
	assert.equal(castles("1r2k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"), "KQ"); // B1 ATTACKED IS FINE
	const state = { board: fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1") };
	const b = makeMove(state.board, legalMoves(state, "w").find((m) => m.castle === "Q"));
	assert.equal(toFen(b), "r3k2r/8/8/8/8/8/8/2KR3R b kq - 1 1");
});

test("en passant is generated and dropped when it would expose the king", () => {
	const ok = { board: fromFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1") };
	const ep = legalMoves(ok, "w").find((m) => m.ep);
	assert.deepEqual([ep.from, ep.to, ep.piece, ep.capture], ["e5", "d6", "w1", "b2"]);
	const after = makeMove(ok.board, ep);
	assert.equal(after.sq[sqIndex("d5")], null);
	assert.equal(after.sq[sqIndex("d6")].id, "w1");
	assert.equal(legalMoves({ board: fromFen("8/8/8/KPp4r/8/8/8/4k3 w - c6 0 1") }, "w").filter((m) => m.ep).length, 0); // PINNED ALONG THE RANK
	assert.equal(legalMoves({ board: fromFen("4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1") }, "w").filter((m) => m.ep).length, 0);
});

test("makeMove is pure and keeps ids, promoting in place", () => {
	const board = fromFen("8/P6k/8/8/8/8/8/K7 w - - 4 9");
	const copy = JSON.stringify(board);
	const promo = pseudoMoves({ board }, "w").filter((m) => m.promotion);
	assert.deepEqual(promo.map((m) => m.promotion).sort(), ["b", "n", "q", "r"]);
	const nb = makeMove(board, promo.find((m) => m.promotion === "n"));
	assert.equal(JSON.stringify(board), copy);
	assert.deepEqual(nb.sq[sqIndex("a8")], { id: "w1", c: "w", t: "n" });
	assert.equal(nb.half, 0); assert.equal(nb.turn, "b"); assert.equal(nb.full, 9);
	assert.equal(nb.history.length, 2); assert.equal(board.history.length, 1);
	assert.equal(applyMove(board, promo[0]).history, board.history); // applyMove LEAVES HISTORY ALONE, SO drawReason WORKS ON IT
	assert.equal(drawReason({ board: applyMove(board, promo[0]) }), null);
});

test("hooks: canMove, canCapture, givesCheck and extraMoves change the generated moves", () => {
	const state = { board: fromFen("4k3/8/8/8/3p4/8/3R4/4K3 w - - 0 1") };
	const rook = state.board.sq[sqIndex("d2")];
	assert.ok(pseudoMoves(state, "w", {}).some((m) => m.piece === rook.id));
	assert.ok(!pseudoMoves(state, "w", { canMove: (s, p) => p.id !== rook.id }).some((m) => m.piece === rook.id));
	assert.ok(pseudoMoves(state, "w").some((m) => m.capture));
	assert.ok(!pseudoMoves(state, "w", { canCapture: () => false }).some((m) => m.capture));
	const extra = { from: "e1", to: "e8", piece: "w9", t: "k" };
	assert.ok(pseudoMoves(state, "w", { extraMoves: (s, p) => (p.t === "k" ? [extra] : []) }).includes(extra));
	const check = { board: fromFen("4k3/8/8/8/8/8/4R3/4K3 w - - 0 1") };
	assert.equal(inCheck(check, "b"), true);
	assert.equal(inCheck(check, "b", { givesCheck: () => false }), false);
	assert.equal(inCheck(check, "b", { canCapture: () => false }), false);
	assert.equal(attacks(check, "w").has(sqIndex("e8")), true);
	assert.equal(attacks(check, "w", { canMove: () => false }).size, 0);
	const kings = legalMoves(state, "w", (m) => m.t === "k");
	assert.ok(kings.length > 0 && kings.every((m) => m.t === "k"));
});

test("hooksFor gives plain chess in this task", () => {
	assert.deepEqual(hooksFor({ board: fromFen(START) }), {});
});

test("extra moves count as attacks and checks", () => {
	const hooks = { extraMoves: kingLike };
	const state = { board: fromFen("8/8/3k4/8/3B4/8/8/4K3 b - - 0 1") };
	assert.ok(legalMoves(state, "b").some((m) => lan(m) === "d6d5")); // PLAIN CHESS: D5 IS SAFE
	assert.ok(!legalMoves(state, "b", null, hooks).some((m) => lan(m) === "d6d5"));
	assert.ok(attacks(state, "w", hooks).has(sqIndex("d5")) && !attacks(state, "w").has(sqIndex("d5")));
	const on = { board: fromFen("8/8/8/3k4/3B4/8/8/4K3 b - - 0 1") };
	assert.ok(pseudoMoves(on, "w", hooks).some((m) => m.capture === at(on, "d5").id));
	assert.equal(inCheck(on, "b"), false);
	assert.equal(inCheck(on, "b", hooks), true);
});

test("extra moves that duplicate a normal move are listed once", () => {
	const state = { board: fromFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1") };
	const dup = (s, p) => (p.t === "k" ? [{ from: "e1", to: "d1", piece: p.id, t: "k" }] : []);
	assert.equal(pseudoMoves(state, "w", { extraMoves: dup }).filter((m) => lan(m) === "e1d1").length, 1);
});

test("an extra move that lands in an attacked square is filtered out", () => {
	const state = { board: fromFen("4k3/8/8/8/8/r7/8/4K3 w - - 0 1") };
	const jump = (s, p) => (p.t === "k" && p.c === "w" ? [{ from: "e1", to: "e3", piece: p.id, t: "k" }, { from: "e1", to: "e4", piece: p.id, t: "k" }] : []);
	const got = legalMoves(state, "w", null, { extraMoves: jump }).map(lan);
	assert.ok(got.includes("e1e4") && !got.includes("e1e3"));
});

test("a supplied givesCheck narrows canMove and canCapture, it does not replace them", () => {
	const check = { board: fromFen("4k3/8/8/8/8/8/4R3/4K3 w - - 0 1") };
	assert.equal(inCheck(check, "b", { canCapture: () => false, givesCheck: () => true }), false);
	assert.equal(inCheck(check, "b", { canMove: () => false, givesCheck: () => true }), false);
	assert.equal(inCheck(check, "b", { givesCheck: () => true }), true);
});

test("canMove false: the piece has no legal moves and gives no check", () => {
	const state = { board: fromFen("4k3/8/8/8/8/8/4R3/4K3 w - - 0 1") };
	const rook = at(state, "e2"), hooks = { canMove: (s, p) => p.id !== rook.id };
	assert.ok(legalMoves(state, "w").some((m) => m.piece === rook.id));
	const got = legalMoves(state, "w", null, hooks);
	assert.ok(got.length > 0 && !got.some((m) => m.piece === rook.id));
	assert.equal(inCheck(state, "b", hooks), false);
});

test("canCapture is asked about the target: a protected piece cannot be taken", () => {
	const state = { board: fromFen("4k3/8/8/8/3p4/8/3R4/4K3 w - - 0 1") };
	const pawn = at(state, "d4");
	assert.ok(legalMoves(state, "w").some((m) => lan(m) === "d2d4"));
	const got = legalMoves(state, "w", null, { canCapture: (s, a, t) => t.id !== pawn.id });
	assert.ok(got.length > 0 && !got.some((m) => lan(m) === "d2d4"));
});

test("castling through a square follows the hooks, like landing on it", () => {
	const f8 = "5r1k/8/8/8/8/8/8/R3K2R w KQ - 0 1", g2 = "4k3/8/8/8/8/8/6p1/R3K2R w KQ - 0 1";
	const rookF8 = at({ board: fromFen(f8) }, "f8").id;
	assert.equal(castlesOf(f8), "Q");
	assert.equal(castlesOf(f8, { canCapture: (s, a) => a.id !== rookF8 }), "KQ"); // A SHAKEN ROOK CANNOT CAPTURE, SO F1 IS SAFE
	assert.equal(castlesOf(g2), "Q");
	assert.equal(castlesOf(g2, { givesCheck: (s, a) => a.t !== "p" }), "KQ"); // PAWNS DO NOT CHECK
	assert.equal(castlesOf(f8, { givesCheck: () => false }), "KQ");
	assert.equal(castlesOf("r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1", { canMove: () => true }), "Q"); // HOOKS PRESENT, PLAIN RESULT
});

test("attacks honours canCapture and givesCheck on empty squares", () => {
	const state = { board: fromFen("5r1k/8/8/8/8/8/8/R3K3 w Q - 0 1") };
	const f1 = sqIndex("f1"), rook = at(state, "f8").id;
	assert.ok(attacks(state, "b").has(f1));
	assert.ok(!attacks(state, "b", { canCapture: (s, a) => a.id !== rook }).has(f1));
	assert.ok(!attacks(state, "b", { givesCheck: () => false }).has(f1));
});

test("castling needs canMove for the rook too: a frozen rook cannot castle", () => {
	const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", rook = at({ board: fromFen(fen) }, "h1").id;
	assert.equal(castlesOf(fen), "KQ");
	assert.equal(castlesOf(fen, { canMove: (s, p) => p.id !== rook }), "Q");
});

test("a king is capturable only by a piece that gives check", () => {
	const pawns = { board: fromFen("4k3/3P4/8/8/8/8/8/4K3 w - - 0 1") };
	assert.ok(legalMoves(pawns, "w").some((m) => m.to === "e8")); // PLAIN CHESS: THE PAWN TAKES THE KING SQUARE
	const hooks = { givesCheck: (s, a) => a.t !== "p" };
	assert.equal(inCheck(pawns, "b", hooks), false);
	assert.ok(!legalMoves(pawns, "w", null, hooks).some((m) => m.to === "e8"));
	const kings = { board: fromFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1") }, black = at(kings, "e8");
	const slide = (s, p) => (p.t === "k" && p.c === "w" ? [{ from: "e1", to: "e8", piece: p.id, t: "k", capture: black.id }] : []); // A QUEEN-MOVING KING
	assert.ok(legalMoves(kings, "w", null, { extraMoves: slide }).some((m) => m.to === "e8"));
	assert.ok(!legalMoves(kings, "w", null, { extraMoves: slide, givesCheck: (s, a) => a.t !== "k" }).some((m) => m.to === "e8"));
});

test("an extra king slide is not a duplicate of castling", () => {
	const fen = "5r1k/8/8/8/8/8/8/4K2R w K - 0 1";
	const slide = (s, p) => (p.t === "k" && p.c === "w" ? [{ from: "e1", to: "g1", piece: p.id, t: "k" }] : []);
	const got = legalMoves({ board: fromFen(fen) }, "w", null, { extraMoves: slide }).filter((m) => lan(m) === "e1g1");
	assert.deepEqual(got.map((m) => m.castle), [undefined]); // THE SLIDE IS LEGAL, THE CASTLE (THROUGH F1) IS NOT
});

test("an extra move onto the mover's own piece is dropped", () => {
	const state = { board: fromFen("4k3/8/8/8/8/8/3P4/3BK3 w - - 0 1") }, bishop = at(state, "d1");
	const onto = (s, p) => (p.id === bishop.id ? [{ from: "d1", to: "d2", piece: p.id, t: "b" }] : []);
	assert.ok(!pseudoMoves(state, "w", { extraMoves: onto }).some((m) => m.piece === bishop.id && m.to === "d2"));
});

test("a king always attacks the enemy king beside it: the kings never stand side by side", () => {
	const state = { board: fromFen("8/8/8/8/8/2k5/8/K7 b - - 0 1") }, king = at(state, "a1").id;
	assert.ok(legalMoves(state, "b").some((m) => lan(m) === "c3c2"));
	assert.ok(!legalMoves(state, "b", null, { canMove: (s, p) => p.id !== king }).some((m) => lan(m) === "c3b2"));
	assert.ok(!legalMoves(state, "b", null, { canCapture: (s, a) => a.id !== king }).some((m) => lan(m) === "c3b2"));
	assert.ok(!legalMoves(state, "b", null, { givesCheck: (s, a) => a.id !== king }).some((m) => lan(m) === "c3b2"));
	assert.equal(attacks(state, "w", { canMove: () => false }).size, 0); // ONLY KING AGAINST KING: EMPTY NEIGHBOURS STAY UNATTACKED
});
