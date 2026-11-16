/*
 *  replayPositions.test.js  --  chess server tests
 *	The replay viewer's positions (client/src/js/gameplay/replay/positions.js & keys.js): every position of a game with its
 *	facing, the move labels, how a step is played & the keys that step. Run on the same chess.js & facing rules as the server
 *
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { replayMoves } = require("../utils/validate.js");
const { buildPositions, checkReplay, moveLabel, stepPlan, facePair } = require("../../client/src/js/gameplay/replay/positions.js");
const { replayKeyAction } = require("../../client/src/js/gameplay/replay/keys.js");

const G1 = ["e4", "Nf6", "e5", "d5", "exd6", "Qxd6", "Nf3", "Bf5", "Bc4", "Nc6", "O-O", "O-O-O", "Nc3", "Qxd2"]; // EN PASSANT, BOTH CASTLES, CAPTURES
const G1_FINAL = "2kr1b1r/ppp1pppp/2n2n2/5b2/2B5/2N2N2/PPPq1PPP/R1BQ1RK1 w - - 0 8";
const G2_FEN = "1r5k/P7/8/8/8/8/6p1/K7 w - - 0 40";
const G2 = ["axb8=N", "g1=Q+", "Ka2", "Qd4", "Nc6", "Qd5+"]; // PROMOTION WITH A CAPTURE TO A KNIGHT, PROMOTION TO A QUEEN
const G3_FEN = "r3k3/8/8/8/8/8/8/4K2R b Kq - 0 7";
const G3 = ["Kd7", "O-O", "Ke6"]; // BLACK MOVES FIRST
const asGame = (moves, fen) => ({ moves: { S: moves }, ...(fen ? { start_params: { S: JSON.stringify({ fen }) } } : {}) });

describe("buildPositions", () => {
	test("every position matches the server's replayMoves", () => {
		for (const [moves, fen] of [[G1], [G2, G2_FEN], [G3, G3_FEN]]) {
			const positions = buildPositions(moves, fen);
			assert.equal(positions.length, moves.length + 1);
			positions.forEach((p, i) => {
				const replay = replayMoves(asGame(moves, fen), i);
				assert.equal(p.fen, replay.chess.fen());
				assert.deepEqual(p.facing, replay.facing);
			});
		}
	});

	test("position 0 is the start, each later one keeps its move", () => {
		const p = buildPositions(G1);
		assert.equal(p[0].move, null);
		assert.deepEqual(p[5].move, { color: "w", piece: "p", from: "e5", to: "d6", san: "exd6", captured: "p", promotion: undefined, flags: "e" });
		assert.deepEqual(buildPositions(G2, G2_FEN)[1].move, { color: "w", piece: "p", from: "a7", to: "b8", san: "axb8=N", captured: "r", promotion: "n", flags: "cp" });
	});

	test("each position's facing is its own copy", () => {
		const p = buildPositions(G1);
		p[7].facing.w_knight[1].from = "x";
		assert.notEqual(p[8].facing.w_knight[1].from, "x");
	});

	test("a move that can't be played throws", () => {
		assert.throws(() => buildPositions(["e4", "e4"]));
	});

	test("checkReplay compares the last position with the saved board", () => {
		assert.equal(checkReplay(buildPositions(G1), G1_FINAL), true);
		assert.equal(checkReplay(buildPositions(G1.slice(0, -1)), G1_FINAL), false);
	});
});

describe("moveLabel", () => {
	test("numbers moves from the position they were played in", () => {
		const p = buildPositions(G1);
		assert.equal(moveLabel(p, 0), "Start");
		assert.equal(moveLabel(p, 1), "1. e4");
		assert.equal(moveLabel(p, 6), "3... Qxd6");
		assert.equal(moveLabel(p, 14), "7... Qxd2");
		const s = buildPositions(G3, G3_FEN);
		assert.deepEqual([1, 2, 3].map((i) => moveLabel(s, i)), ["7... Kd7", "8. O-O", "8... Ke6"]);
	});
});


describe("replayKeyAction", () => {
	test("replay keys step only when nothing else owns the key", () => {
		const free = { menuOpen: false, inMoveList: false, inTextBox: false, monitorBusy: false, modifier: false };
		assert.deepEqual(["ArrowLeft", "ArrowRight", "Home", "End", "ArrowUp", "Enter"].map((k) => replayKeyAction(k, free)), ["back", "forward", "first", "last", null, null]);
		for (const flag of Object.keys(free)) { assert.equal(replayKeyAction("ArrowRight", { ...free, [flag]: true }), null); }
	});
});

describe("stepPlan", () => {
	test("slides one step, jumps further or on fast input", () => {
		const p = buildPositions(G1);
		assert.equal(stepPlan(p, 0, 1, { animate: true }).kind, "forward");
		assert.equal(stepPlan(p, 0, 1, { animate: true }).move.san, "e4");
		assert.equal(stepPlan(p, 4, 3, { animate: true }).kind, "back");
		assert.equal(stepPlan(p, 4, 3, { animate: true }).move.san, "d5");
		assert.deepEqual(stepPlan(p, 0, 14, { animate: true }), { kind: "jump", target: 14 });
		assert.deepEqual(stepPlan(p, 5, 6, { animate: false }), { kind: "jump", target: 6 });
		assert.equal(stepPlan(p, 0, -3, { animate: true }), null);
		assert.equal(stepPlan(p, 14, 99, { animate: true }), null);
	});
});

describe("facePair", () => {
	test("keeps the facing a piece had before its move", () => {
		const p = buildPositions(G1), q = buildPositions(G2, G2_FEN);
		const back = (positions, i) => facePair(positions[i - 1].facing, positions[i].move);
		assert.deepEqual(back(p, 11), { from: "e1", to: "e2" }); // O-O: UNMOVED WHITE KING FACES UP
		assert.deepEqual(back(p, 13), { from: "b1", to: "c1" }); // Nc3: UNMOVED b1 KNIGHT FACES THE MIDDLE
		assert.deepEqual(back(p, 6), { from: "d8", to: "d7" }); // Qxd6: UNMOVED BLACK QUEEN FACES DOWN
		assert.deepEqual(back(p, 14), { from: "d8", to: "d6" }); // Qxd2: ITS LAST MOVE WENT DOWN
		assert.deepEqual(back(q, 5), { from: "a7", to: "b8" }); // Nc6: THE PROMOTED KNIGHT
		assert.deepEqual(back(q, 4), { from: "g2", to: "g1" }); // Qd4: THE PROMOTED QUEEN
		assert.equal(back(q, 1), null); // axb8=N SLIDES BACK AS A PAWN
		assert.equal(back(p, 5), null); // exd6 IS A PAWN
		assert.deepEqual(stepPlan(p, 11, 10, { animate: true }).face, { from: "e1", to: "e2" });
	});

	test("an unmoved knight on the e - h files faces the a-file", () => {
		const p = buildPositions(G1);
		assert.deepEqual(facePair(p[6].facing, p[7].move), { from: "g1", to: "f1" }); // Nf3
	});
});
