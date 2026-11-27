/*
 *  cards-board.test.js  --  chess cards engine tests
 *	Seeded random generator, board and FEN (cards-engine/rng.js, board.js)
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const rng = require("../../../cards-engine/rng.js");
const board = require("../../../cards-engine/board.js");

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const RFC_KEY = [0x03020100, 0x07060504, 0x0b0a0908, 0x0f0e0d0c, 0x13121110, 0x17161514, 0x1b1a1918, 0x1f1e1d1c]; // KEY BYTES 00..1f, LITTLE-ENDIAN WORDS

test("the ChaCha20 block matches RFC 8439 section 2.3.2", () => {
	const out = rng.block(RFC_KEY, 1, [0x09000000, 0x4a000000, 0x00000000]);
	assert.deepEqual(out, [
		0xe4e7f110, 0x15593bd1, 0x1fdd0f50, 0xc47120a3, 0xc7f4d1c7, 0x0368c033, 0x9aaa2204, 0x4e6cd4c3,
		0x466482d2, 0x09aa9f07, 0x05d7c214, 0xa2028bd9, 0xd19c12b5, 0xb94e16de, 0xe883d0cb, 0x4e3c50a2,
	]);
});
test("seed: a 64-character hex string gives the key bytes as little-endian words; an integer gives [value, 0 x 7]", () => {
	const hex = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0")).join("");
	assert.deepEqual(rng.seed(hex), { key: RFC_KEY, n: 0 });
	assert.deepEqual(rng.seed(hex.toUpperCase()), { key: RFC_KEY, n: 0 });
	assert.deepEqual(rng.seed(42), { key: [42, 0, 0, 0, 0, 0, 0, 0], n: 0 });
	assert.deepEqual(rng.seed(0), { key: [0, 0, 0, 0, 0, 0, 0, 0], n: 0 });
	assert.deepEqual(rng.seed(0xffffffff), { key: [0xffffffff, 0, 0, 0, 0, 0, 0, 0], n: 0 });
	for (const bad of [-1, 1.5, NaN, 2 ** 32, "42", hex.slice(1), hex + "0", "g" + hex.slice(1), null, undefined, {}, [1]]) assert.throws(() => rng.seed(bad), Error, String(bad));
});
test("output n is word n % 16 of block n / 16 (high counter bits in the first nonce word), over 2^32", () => {
	const s = { rng: rng.seed(9) }, b0 = rng.block(s.rng.key, 0, [0, 0, 0]), b1 = rng.block(s.rng.key, 1, [0, 0, 0]);
	const got = Array.from({ length: 20 }, () => rng.next(s) * 4294967296);
	assert.deepEqual(got, [...b0, ...b1.slice(0, 4)]);
	assert.equal(s.rng.n, 20);
	const far = { rng: { key: s.rng.key, n: 16 * 2 ** 32 + 3 } };
	assert.equal(rng.next(far) * 4294967296, rng.block(s.rng.key, 0, [1, 0, 0])[3]);
	assert.equal(far.rng.n, 16 * 2 ** 32 + 4);
});
test("rng is deterministic from the stored state", () => {
	const a = { rng: rng.seed(42) }, b = { rng: rng.seed(42) };
	assert.deepEqual([rng.next(a), rng.next(a), rng.int(a, 10)], [rng.next(b), rng.next(b), rng.int(b, 10)]);
	assert.deepEqual(a.rng, { key: rng.seed(42).key, n: 3 });
	assert.deepEqual(JSON.parse(JSON.stringify(a)), a); // PLAIN JSON
});
test("rng int stays in range, shuffle keeps the elements, pick returns a member", () => {
	const s = { rng: rng.seed(7) };
	for (let i = 0; i < 200; i++) { const n = rng.int(s, 5); assert.ok(Number.isInteger(n) && n >= 0 && n < 5); }
	const arr = [1, 2, 3, 4, 5, 6];
	assert.equal(rng.shuffle(s, arr), arr);
	assert.deepEqual([...arr].sort(), [1, 2, 3, 4, 5, 6]);
	assert.ok(arr.includes(rng.pick(s, arr)));
});
test("rng pins: the first outputs of seed 42 and seed 0", () => {
	const s = { rng: rng.seed(42) };
	assert.equal(rng.next(s), 0.15193880326114595); assert.equal(s.rng.n, 1);
	assert.equal(rng.next({ rng: rng.seed(0) }), 0xade0b876 / 2 ** 32); // RFC 8439 A.1 TEST VECTOR #1 (ALL-ZERO KEY, NONCE AND COUNTER), FIRST WORD
});
test("rng rejects a missing or malformed state", () => {
	const key = [1, 2, 3, 4, 5, 6, 7, 8];
	for (const bad of [{}, { rng: 42 }, { rng: "42" }, { rng: null }, { rng: { key, n: 1.5 } }, { rng: { key, n: -1 } }, { rng: { key } }, { rng: { key: key.slice(1), n: 0 } },
		{ rng: { key: [...key.slice(1), "8"], n: 0 } }, { rng: { key: [...key.slice(1), 2 ** 32], n: 0 } }, { rng: { key: [...key.slice(1), -1], n: 0 } }, { rng: { n: 0 } }]) {
		assert.throws(() => rng.next(bad), /state\.rng missing/, JSON.stringify(bad));
	}
});
test("rng int needs a positive integer; pick on an empty list draws nothing", () => {
	for (const n of [0, -3, 2.5, NaN, undefined]) assert.throws(() => rng.int({ rng: rng.seed(1) }, n), Error, String(n));
	const s = { rng: rng.seed(9) };
	assert.equal(rng.pick(s, []), undefined); assert.equal(s.rng.n, 0);
});
test("rng int reaches every value, shuffle moves things, pick varies", () => {
	const s = { rng: rng.seed(3) }, seen = new Set();
	for (let i = 0; i < 200; i++) seen.add(rng.int(s, 5));
	assert.deepEqual([...seen].sort(), [0, 1, 2, 3, 4]);
	assert.deepEqual(rng.shuffle({ rng: rng.seed(7) }, [1, 2, 3, 4, 5, 6]), [6, 3, 4, 1, 2, 5]);
	const picks = new Set(), p = { rng: rng.seed(5) };
	for (let i = 0; i < 50; i++) picks.add(rng.pick(p, ["a", "b", "c", "d"]));
	assert.ok(picks.size > 1);
});
test("FEN round trips", () => {
	for (const fen of [START, "r3k2r/8/8/3pP3/8/8/8/R3K2R w Kq d6 0 23", "4k3/8/8/8/8/8/8/4K3 b - - 99 150"]) {
		assert.equal(board.toFen(board.fromFen(fen)), fen);
	}
});
test("piece ids are unique and stable", () => {
	const b = board.fromFen(START);
	const ids = b.sq.filter(Boolean).map((p) => p.id);
	assert.equal(new Set(ids).size, 32); assert.ok(ids.every((id) => /^[wb]\d+$/.test(id))); // NO TYPE IN AN ID
	assert.equal(b.sq[0].id, "b1"); assert.equal(b.sq[63].id, "w16");
});
test("square helpers and pieceById", () => {
	assert.equal(board.sqName(0), "a8"); assert.equal(board.sqName(63), "h1");
	for (let i = 0; i < 64; i++) assert.equal(board.sqIndex(board.sqName(i)), i);
	const b = board.fromFen(START);
	assert.equal(board.pieceById(b, "w16"), 63);
	assert.equal(board.pieceById(b, "w99"), -1);
});
test("square helpers reject bad names and indexes", () => {
	for (const bad of ["i1", "E4", "a9", "a0", "", "e44", "e"]) assert.equal(board.sqIndex(bad), -1, bad);
	for (const bad of [64, -1, 1.5, NaN, "3"]) assert.equal(board.sqName(bad), null, String(bad));
});
test("start position holds the right pieces on the right squares", () => {
	const b = board.fromFen(START);
	assert.deepEqual(b.sq[board.sqIndex("e1")], { id: "w13", c: "w", t: "k" });
	assert.equal(b.sq[board.sqIndex("d8")].t, "q");
	assert.strictEqual(b.ep, null); assert.strictEqual(b.half, 0); assert.strictEqual(b.full, 1);
	assert.equal(board.fromFen("r3k2r/8/8/3pP3/8/8/8/R3K2R w Kq d6 0 23").ep, "d6");
});
test("fromFen fills missing fields and rejects bad FENs", () => {
	const ex = board.fromFen("4k3/8/8/8/8/8/8/4K3 w KQ -");
	assert.deepEqual([ex.castling, ex.ep, ex.half, ex.full], ["KQ", null, 0, 1]);
	const two = board.fromFen("  4k3/8/8/8/8/8/8/4K3   b ");
	assert.deepEqual([two.turn, two.castling, two.ep, two.half, two.full], ["b", "-", null, 0, 1]);
	const bad = [
		"", "4k3/8/8/8/8/8/4K3 w - - 0 1", "4k3/8/8/8/8/8/8/8/4K3 w - - 0 1", // 7 AND 9 RANKS
		"4k4/8/8/8/8/8/8/4K3 w - - 0 1", "4k2/8/8/8/8/8/8/4K3 w - - 0 1", // 9 AND 7 SQUARES
		"4x3/8/8/8/8/8/8/4K3 w - - 0 1", "4k3/8/8/8/8/8/8/4K3 x - - 0 1",
		"4k3/8/8/8/8/8/8/4K3 w - - -1 1", "4k3/8/8/8/8/8/8/4K3 w - - 0 1.5", "4k3/8/8/8/8/8/8/4K3 w - - a 1",
	];
	bad.push("4k3/8/8/8/8/8/8/4K3 w XYZ - 0 1", "4k3/8/8/8/8/8/8/4K3 w KK - 0 1", "4k3/8/8/8/8/8/8/4K3 w qK - 0 1", "4k3/8/8/8/8/8/8/4K3 w - z9 0 1", "4k3/8/8/8/8/8/8/4K3 w - e4 0 1");
	for (const fen of bad) assert.throws(() => board.fromFen(fen), Error, JSON.stringify(fen));
});
test("history holds position keys", () => {
	const b = board.fromFen(START);
	assert.deepEqual(b.history, ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"]);
});
