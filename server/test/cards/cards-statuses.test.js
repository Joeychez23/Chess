/*
 *  cards-statuses.test.js  --  chess cards engine tests
 *	Piece statuses (cards-engine/statuses.js) and card-aware check (rules.js)
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fromFen } = require("../../../cards-engine/board.js");
const { attacks, inCheck, legalMoves } = require("../../../cards-engine/rules.js");
const statuses = require("../../../cards-engine/statuses.js");

// A STATE WITH NO STATUSES YET AND THE MINIMAL ctx TASK 4'S makeCtx MUST KEEP
const setup = (fen) => {
	const state = { board: fromFen(fen), statuses: {} };
	return { state, ctx: { state, events: [], emit(ev) { this.events.push(ev); } } };
};
const idAt = (state, i) => state.board.sq[i].id;
const lan = (m) => m.from + m.to;

test("a Shaken rook gives no check", () => {
	const { state, ctx } = setup("R6k/8/8/8/8/8/8/4K3 b - - 0 1");
	assert.equal(inCheck(state, "b"), true);
	assert.equal(statuses.give(ctx, idAt(state, 0), "shaken"), true);
	assert.equal(inCheck(state, "b"), false);
	assert.ok(legalMoves(state, "b").some((m) => m.to === "g8"));
});

test("a Frozen piece has no moves", () => {
	const { state, ctx } = setup("4k3/8/8/8/8/8/8/1N2K3 w - - 0 1");
	const onB1 = (m) => m.from === "b1";
	assert.equal(legalMoves(state, "w", onB1).length, 3);
	statuses.give(ctx, idAt(state, 57), "frozen", 2);
	assert.deepEqual(legalMoves(state, "w", onB1), []);
	assert.ok(legalMoves(state, "w").length > 0);
});

test("a Warded piece can't be captured", () => {
	const { state, ctx } = setup("4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1");
	const qxd5 = (m) => m.from === "d1" && m.to === "d5";
	assert.ok(legalMoves(state, "w").some(qxd5));
	statuses.give(ctx, idAt(state, 27), "warded");
	assert.equal(legalMoves(state, "w").some(qxd5), false);
	assert.ok(legalMoves(state, "w").some((m) => m.from === "d1" && m.to === "d4"));
});

test("the king is never Warded", () => {
	const { state, ctx } = setup("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
	const kingId = idAt(state, 60);
	assert.equal(statuses.give(ctx, kingId, "warded", 2), false);
	assert.equal(statuses.has(state, kingId, "warded"), false);
	assert.deepEqual(ctx.events, []);
});

test("durations count the owner's turns", () => {
	const { state, ctx } = setup("4k3/8/8/8/8/8/8/1N2K3 w - - 0 1");
	const id = idAt(state, 57);
	ctx.turn = "b"; // GIVEN ON BLACK'S TURN TO A WHITE PIECE
	statuses.give(ctx, id, "frozen", 2);
	assert.equal(statuses.has(state, id, "frozen"), true);
	statuses.tick(ctx, "b");
	statuses.tick(ctx, "b");
	assert.deepEqual(state.statuses[id], [{ s: "frozen", left: 2, by: "b" }]);
	statuses.tick(ctx, "w");
	assert.equal(statuses.has(state, id, "frozen"), true);
	statuses.tick(ctx, "w");
	assert.equal(statuses.has(state, id, "frozen"), false);
	assert.equal(state.statuses[id], undefined);
	assert.deepEqual(ctx.events.map((e) => e.type), ["status", "status-ended"]);
});

test("give defaults to 3 turns, refreshes instead of stacking, and clear ends it", () => {
	const { state, ctx } = setup("4k3/8/8/8/8/8/8/1N2K3 w - - 0 1");
	const id = idAt(state, 57);
	statuses.give(ctx, id, "marked");
	statuses.give(ctx, id, "marked");
	assert.deepEqual(state.statuses[id], [{ s: "marked", left: 3, by: "w", fresh: true }]); // WHITE'S PIECE, GIVEN ON WHITE'S TURN
	statuses.give(ctx, id, "hexed", null);
	for (let n = 0; n < 5; n++) statuses.tick(ctx, "w");
	assert.deepEqual(state.statuses[id], [{ s: "hexed", left: null, by: "w" }]);
	statuses.clear(ctx, id, "hexed");
	assert.equal(statuses.has(state, id, "hexed"), false);
	assert.equal(ctx.events.filter((e) => e.type === "status-ended").length, 2);
});

test("a hexed piece still moves and gives check", () => {
	const { state, ctx } = setup("R6k/8/8/8/8/8/8/4K3 b - - 0 1");
	statuses.give(ctx, idAt(state, 0), "hexed");
	assert.equal(statuses.has(state, idAt(state, 0), "hexed"), true);
	assert.equal(inCheck(state, "b"), true);
	assert.ok(legalMoves(state, "w").some((m) => m.from === "a8"));
});

test("a status given on the owner's own turn does not count that turn", () => {
	const { state, ctx } = setup("4k3/8/8/8/8/8/8/1N2K3 w - - 0 1");
	const id = idAt(state, 57);
	ctx.turn = "w";
	statuses.give(ctx, id, "frozen", 1);
	statuses.tick(ctx, "w");
	assert.equal(statuses.has(state, id, "frozen"), true);
	statuses.tick(ctx, "w");
	assert.equal(statuses.has(state, id, "frozen"), false);
	ctx.turn = "b";
	statuses.give(ctx, id, "frozen", 1);
	statuses.tick(ctx, "w");
	assert.equal(statuses.has(state, id, "frozen"), false);
});

test("whose turn it is falls back to the board when ctx.turn is unset", () => {
	const { state, ctx } = setup("4k3/8/8/8/8/8/8/1N2K3 b - - 0 1");
	const id = idAt(state, 57);
	statuses.give(ctx, id, "frozen", 1);
	assert.equal(state.statuses[id][0].by, "b");
	statuses.tick(ctx, "w");
	assert.equal(statuses.has(state, id, "frozen"), false);
});

test("an explicit giver is stored and named on the status event", () => {
	const { state, ctx } = setup("4k3/8/8/8/8/8/8/1N2K3 w - - 0 1");
	const id = idAt(state, 57);
	ctx.turn = "w";
	statuses.give(ctx, id, "shaken", 2, "b");
	assert.equal(state.statuses[id][0].by, "b");
	assert.equal(state.statuses[id][0].fresh, true); // FRESH FOLLOWS THE TURN IN PROGRESS, NOT THE GIVER
	assert.equal(ctx.events[0].player, "b");
});

test("the owner is read from the board, not the id", () => {
	const { state, ctx } = setup("4k3/8/8/8/8/8/8/1N2K3 b - - 0 1");
	const knight = state.board.sq[57];
	knight.id = "b9"; // A PIECE HANDED TO WHITE KEEPS ITS OLD ID
	statuses.give(ctx, "b9", "frozen", 1);
	statuses.tick(ctx, "b");
	assert.equal(statuses.has(state, "b9", "frozen"), true);
	statuses.tick(ctx, "w");
	assert.equal(statuses.has(state, "b9", "frozen"), false);
	assert.equal(ctx.events.at(-1).player, "w");
});

test("a tick drops the statuses of a piece no longer on the board, with no event", () => {
	const { state, ctx } = setup("4k3/8/8/8/8/8/8/1N2K3 w - - 0 1");
	state.statuses.w99 = [{ s: "marked", left: 3, by: "b" }];
	statuses.tick(ctx, "b");
	assert.equal(state.statuses.w99, undefined);
	assert.deepEqual(ctx.events, []);
});

test("a Frozen piece gives no check", () => {
	const { state, ctx } = setup("R6k/8/8/8/8/8/8/4K3 b - - 0 1");
	statuses.give(ctx, idAt(state, 0), "frozen");
	assert.equal(inCheck(state, "b"), false);
});

test("a Frozen rook blocks castling on its side", () => {
	const { state, ctx } = setup("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
	const castles = () => legalMoves(state, "w").filter((m) => m.castle).map((m) => m.castle).sort().join("");
	assert.equal(castles(), "KQ");
	statuses.give(ctx, idAt(state, 63), "frozen");
	assert.equal(castles(), "Q");
});

test("a Warded pawn can't be taken en passant", () => {
	const { state, ctx } = setup("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
	const ep = (m) => m.ep && lan(m) === "e5d6";
	assert.ok(legalMoves(state, "w").some(ep));
	statuses.give(ctx, idAt(state, 27), "warded");
	assert.equal(legalMoves(state, "w").some(ep), false);
});

test("a Shaken piece does not defend: the king may take what it guards", () => {
	const { state, ctx } = setup("k3r3/8/8/8/8/8/4p3/4K3 w - - 0 1");
	const e2 = 52;
	assert.ok(attacks(state, "b").has(e2));
	statuses.give(ctx, idAt(state, 4), "shaken");
	assert.equal(attacks(state, "b").has(e2), false);
	assert.ok(legalMoves(state, "w").some((m) => lan(m) === "e1e2"));
});

test("a Frozen king still keeps the enemy king away", () => {
	const { state, ctx } = setup("8/8/8/8/8/2k5/8/K7 b - - 0 1");
	statuses.give(ctx, idAt(state, 56), "frozen", 2);
	assert.equal(legalMoves(state, "b").some((m) => lan(m) === "c3b2"), false);
	assert.ok(legalMoves(state, "b").some((m) => lan(m) === "c3c2"));
});

test("clearing a status of a piece no longer on the board drops it with no event", () => {
	const { state, ctx } = setup("4k3/8/8/8/8/8/8/1N2K3 w - - 0 1");
	state.statuses.w99 = [{ s: "marked", left: 3, by: "b" }];
	statuses.clear(ctx, "w99", "marked");
	assert.equal(state.statuses.w99, undefined);
	assert.deepEqual(ctx.events, []);
});

test("a shorter repeat never cuts a longer or permanent one (no change, no event, true); a longer one replaces a shorter one", () => {
	const { state, ctx } = setup("4k3/8/8/8/8/8/8/1N2K3 b - - 0 1");
	const id = idAt(state, 57);
	assert.equal(statuses.give(ctx, id, "marked", null), true);
	ctx.events.length = 0;
	assert.equal(statuses.give(ctx, id, "marked", 1), true);
	assert.deepEqual([state.statuses[id], ctx.events], [[{ s: "marked", left: null, by: "b" }], []]);
	statuses.give(ctx, id, "frozen", 3);
	ctx.events.length = 0;
	assert.equal(statuses.give(ctx, id, "frozen", 2), true);
	assert.equal(statuses.give(ctx, id, "frozen", 3), true);
	assert.deepEqual(ctx.events, []);
	assert.equal(state.statuses[id].find((e) => e.s === "frozen").left, 3);
	assert.equal(statuses.give(ctx, id, "frozen", 5), true);
	assert.equal(state.statuses[id].find((e) => e.s === "frozen").left, 5);
	assert.equal(statuses.give(ctx, id, "frozen", null), true);
	assert.equal(state.statuses[id].find((e) => e.s === "frozen").left, null);
	assert.equal(ctx.events.length, 2);
});
