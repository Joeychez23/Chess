const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Chess } = require("chess.js");
const { capturesAt } = require("../src/js/gameplay/captures/index.js");

function play(moves, fen) { const c = fen ? new Chess(fen) : new Chess(); moves.forEach((m) => c.move(m)); return c.fen(); }
const GAME = ["e4", "d5", "exd5", "Qxd5", "Nc3", "Qa5"];

test("captures in order, by the taken piece's colour", () => {
	assert.deepEqual(capturesAt(GAME, null, play(GAME)), [{ type: "p", color: "b" }, { type: "p", color: "w" }]);
});
test("a replay position earlier in the game only has its own captures", () => {
	assert.deepEqual(capturesAt(GAME, null, play(GAME.slice(0, 3))), [{ type: "p", color: "b" }]);
	assert.deepEqual(capturesAt(GAME, null, play([])), []);
});
test("a move on the board that the list hasn't got yet counts", () => {
	assert.deepEqual(capturesAt(GAME.slice(0, 3), null, play(GAME.slice(0, 4))), [{ type: "p", color: "b" }, { type: "p", color: "w" }]);
});
test("en passant takes a pawn", () => {
	const moves = ["e4", "a6", "e5", "d5", "exd6"];
	assert.deepEqual(capturesAt(moves, null, play(moves)), [{ type: "p", color: "b" }]);
});
test("a promotion by capture is kept, and a later capture follows it", () => {
	const start = "1n5k/P7/8/8/8/8/8/R6K w - - 0 1";
	const moves = ["axb8=Q+", "Kg7", "Qb7+", "Kf6", "Qb6+", "Kg5", "Qb5+", "Kh4", "Qb4+", "Kh3", "Qe1", "Kg4", "Qg1+", "Kf5", "Qg8", "Ke5", "Qe8+", "Kd6", "Qd8+", "Kc6", "Qd1", "Kb7", "Qd7+", "Kb8", "Qd8+", "Kb7", "Ra7+", "Kxa7"];
	const taken = capturesAt(moves, start, play(moves, start));
	assert.deepEqual(taken[0], { type: "n", color: "b" });
	assert.deepEqual(taken[taken.length - 1], { type: "r", color: "w" });
});
test("a promoted piece that is later taken goes to the pile as a queen", () => {
	const start = "1n5k/P7/8/8/8/8/8/R6K w - - 0 1";
	const moves = ["axb8=Q+", "Kg7", "Qb7+", "Kf6", "Qe7+", "Kxe7"];
	assert.deepEqual(capturesAt(moves, start, play(moves, start)), [{ type: "n", color: "b" }, { type: "q", color: "w" }]);
});
test("a pending move that promotes by capturing counts", () => {
	const start = "1n5k/P7/8/8/8/8/8/R6K w - - 0 1";
	assert.deepEqual(capturesAt([], start, play(["axb8=N"], start)), [{ type: "n", color: "b" }]);
});
test("a set position starts with nothing taken", () => {
	const start = "4k3/8/8/8/8/8/8/4K2R w K - 0 1";
	assert.deepEqual(capturesAt([], start, start), []);
});
test("a saved move that can't be played stops the replay, nothing throws", () => {
	assert.deepEqual(capturesAt(["e4", "d5", "exd5", "Zz9", "Qxd5"], null, play(GAME.slice(0, 3))), [{ type: "p", color: "b" }]);
	assert.deepEqual(capturesAt(["Zz9"], null, "not a fen"), []);
});
test("a board the history never reached falls back to the whole history", () => {
	assert.deepEqual(capturesAt(GAME, null, "8/8/8/4k3/8/8/8/4K3 w - - 0 1"), [{ type: "p", color: "b" }, { type: "p", color: "w" }]);
});

/* ---- REPLAY CACHE ---- */
const LONG = ["e4", "d5", "exd5", "Qxd5", "Nc3", "Qa5", "d4", "c6", "Nf3", "Bg4", "Bf4", "e6", "h3", "Bxf3", "Qxf3", "Bb4"];
const OTHER = ["d4", "d5", "c4", "dxc4", "e3", "b5", "a4", "c6", "axb5", "cxb5"];
const cold = (moves, startFen, fen) => { capturesAt(OTHER, null, play(OTHER)); return capturesAt(moves, startFen, fen); }; // A DIFFERENT HISTORY IN BETWEEN: NOTHING TO REUSE
test("one more move gives what a cold call gives", () => {
	for (let n = 0; n <= LONG.length; n++) {
		const warm = capturesAt(LONG.slice(0, n), null, play(LONG.slice(0, n)));
		assert.deepEqual(warm, cold(LONG.slice(0, n), null, play(LONG.slice(0, n))));
	}
});
test("a shorter list, a changed earlier move or another start after a longer one is still right", () => {
	capturesAt(LONG, null, play(LONG));
	assert.deepEqual(capturesAt(GAME.slice(0, 3), null, play(GAME.slice(0, 3))), [{ type: "p", color: "b" }]);
	capturesAt(LONG, null, play(LONG));
	const changed = ["d4", "d5", "c4", "dxc4"];
	assert.deepEqual(capturesAt(changed, null, play(changed)), [{ type: "p", color: "w" }]);
	capturesAt(LONG, null, play(LONG));
	const start = "4k3/8/8/8/8/8/8/4K2R w K - 0 1";
	assert.deepEqual(capturesAt(["Rh2"], start, play(["Rh2"], start)), []);
	assert.deepEqual(capturesAt(LONG, null, play(LONG)), cold(LONG, null, play(LONG)));
});
test("a history with an unplayable move answers the same twice, and picks up when it is fixed", () => {
	const bad = ["e4", "d5", "exd5", "Zz9", "Qxd5"];
	const board = play(GAME.slice(0, 3));
	assert.deepEqual(capturesAt(bad, null, board), [{ type: "p", color: "b" }]);
	assert.deepEqual(capturesAt(bad, null, board), [{ type: "p", color: "b" }]);
	assert.deepEqual(capturesAt(GAME, null, play(GAME)), [{ type: "p", color: "b" }, { type: "p", color: "w" }]);
});
test("changing a returned array doesn't change the next answer", () => {
	const first = capturesAt(GAME, null, play(GAME));
	first.push({ type: "q", color: "w" });
	first[0].type = "k";
	assert.deepEqual(capturesAt(GAME, null, play(GAME)), [{ type: "p", color: "b" }, { type: "p", color: "w" }]);
});
