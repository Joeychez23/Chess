// A CHESS CARDS ANSWER'S BOARD STEPS ON THE 3D BOARD (three/board/motion.js playBoardStep, TASK 21a C & D) ON A STUBBED BOARD: A RESOLVE HOOK SWAPS three/index.js & three/board/pieces.js FOR
// test/helpers/threeStub.mjs (motion.js ITSELF UNCHANGED), A PIECE IS A PLAIN OBJECT, & THE ANIMATIONS ARE STEPPED BY HAND (stepAnim AT A TIME, finishAnims AT ONCE AS ON REDUCE MOTION OR A LOST CONTEXT)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { registerHooks } = require("node:module");
const { pathToFileURL } = require("node:url");

global.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) }; // constants.js READS REDUCE MOTION AS IT LOADS
const STUB = path.join(__dirname, "../helpers/threeStub.mjs");
registerHooks({
	resolve: (specifier, context, next) => (context.parentURL && context.parentURL.endsWith("/three/board/motion.js") && (specifier === "../index.js" || specifier === "./pieces.js")
		? { url: pathToFileURL(STUB).href, shortCircuit: true } : next(specifier, context)),
});
const { playBoardStep, stepAnim, finishAnims } = require("../../src/js/gameplay/three/board/motion.js");
const board = require(STUB);

// A BOARD WITH THESE PIECES ({ e2: "wp" }) AS THE VIEW
function setup(pieces) {
	const v = { pieces: new Map(), anims: new Set(), arriving: new Set(), taken: new Map(), held: null, lost: false };
	board.setView(v);
	for (const [square, code] of Object.entries(pieces)) { board.place(board.addPiece(code[1], code[0]), square); }
	return v;
}
const on = (v) => Object.fromEntries([...v.pieces].map(([square, m]) => [square, m.userData.color + m.userData.type]));
const stands = (mesh, square) => mesh.position.x === board.center(board.fileOf(square)) && mesh.position.y === 0 && mesh.position.z === board.center(board.rowOf(square));
const ended = (p) => Promise.race([p.then(() => true), new Promise((done) => setTimeout(() => done(false), 20))]); // true: IT HAS ENDED (WITHIN 20 ms)
async function play(step) { const done = playBoardStep(step); finishAnims(); assert.ok(await ended(done), `${step.op} ended`); }

test("playBoardStep move: the piece slides there; taken names the piece it takes, null takes none (no en passant guess beside it)", async () => {
	let v = setup({ b4: "wp", a4: "wp", a5: "bn" });
	const pawn = v.pieces.get("b4"), knight = v.pieces.get("a5");
	await play({ op: "move", from: "b4", to: "a5", taken: "a5" });
	assert.deepEqual(on(v), { a5: "wp", a4: "wp" });
	assert.ok(v.pieces.get("a5") === pawn && stands(pawn, "a5"));
	assert.deepEqual([...v.arriving], [knight], "handed to setTaken, as a drawn move's capture");
	v = setup({ b4: "wp", a4: "bp" });
	await play({ op: "move", from: "b4", to: "a5", taken: null });
	assert.deepEqual(on(v), { a5: "wp", a4: "bp" }, "a fog-hidden piece taken on a5: the pawn beside it stays");
	assert.equal(v.arriving.size, 0);
});

test("playBoardStep swap: the two pieces trade squares, neither taken", async () => {
	const v = setup({ h8: "br", c6: "bn" });
	const rook = v.pieces.get("h8"), knight = v.pieces.get("c6");
	await play({ op: "swap", a: "h8", b: "c6" });
	assert.ok(v.pieces.get("c6") === rook && v.pieces.get("h8") === knight && stands(rook, "c6") && stands(knight, "h8"));
	assert.equal(v.arriving.size, 0);
});

test("playBoardStep take: the piece leaves the board at once, fades out and is removed", async () => {
	const v = setup({ c6: "bn" });
	const knight = v.pieces.get("c6");
	const done = playBoardStep({ op: "take", square: "c6" });
	assert.equal(v.pieces.has("c6"), false);
	finishAnims();
	assert.ok(await ended(done));
	assert.equal(knight.userData.opacity, 0);
	assert.equal(board.scene.has(knight), false);
});

test("playBoardStep out & back: the bishop goes to the square and home; a hidden one (piece) is put on its square first and removed when it is home", async () => {
	let v = setup({ b4: "bb" });
	const bishop = v.pieces.get("b4");
	await play({ op: "out", from: "b4", to: "a3", piece: null });
	assert.ok(v.pieces.get("a3") === bishop && stands(bishop, "a3"));
	await play({ op: "back", from: "a3", to: "b4", piece: null });
	assert.ok(v.pieces.get("b4") === bishop && stands(bishop, "b4") && board.scene.has(bishop));
	v = setup({});
	await play({ op: "out", from: "c6", to: "a4", piece: { c: "b", t: "b" } });
	const ghost = v.pieces.get("a4");
	assert.deepEqual(on(v), { a4: "bb" });
	await play({ op: "back", from: "a4", to: "c6", piece: { c: "b", t: "b" } });
	assert.deepEqual(on(v), {});
	assert.equal(board.scene.has(ghost), false);
});

test("playBoardStep topple: the piece leaves its square at once, tips over the edge of its foot (slowly at first, flat on its side at the end, its yaw kept), lies there a moment, then fades out", async () => {
	const v = setup({ a2: "wp", h7: "bn" });
	const pawn = v.pieces.get("a2"), yaw = pawn.rotation.y, x = pawn.position.x, z = pawn.position.z, r = 0.34 * pawn.scale.y; // r: THE STUB'S FOOT, ITS WIDEST REACH
	const near = (a, b) => Math.abs(a - b) < 1e-9;
	const done = playBoardStep({ op: "topple", square: "a2" });
	assert.equal(v.pieces.has("a2"), false, "off the board's squares at once");
	const [tip] = v.anims;
	stepAnim(tip, 1000);
	assert.deepEqual([pawn.rotation.z, pawn.position.x, pawn.position.y], [0, x, 0], "standing at the start");
	stepAnim(tip, 1000 + tip.duration / 2);
	const mid = Math.abs(pawn.rotation.z);
	assert.ok(mid > 0 && mid < Math.PI / 4, `slow at first, as in a faint: ${mid} at half time`);
	assert.ok(near(pawn.position.y, r * Math.sin(mid)) && near(pawn.position.x, x - r * (1 - Math.cos(mid))), "turning about the edge of its foot on the board");
	stepAnim(tip, 1000 + tip.duration);
	assert.equal(pawn.rotation.z, Math.PI / 2, "flat, toward the a-file (its nearer edge of the board): +z turns its top to -x");
	assert.ok(near(pawn.position.x, x - r) && near(pawn.position.y, r) && pawn.position.z === z, "lying on its side, its side on the board");
	assert.deepEqual([pawn.rotation.y, pawn.rotation.order], [yaw, "ZYX"], "the yaw kept: the tip turns it about the board's axis after it");
	const [leave] = v.anims;
	assert.ok(leave && leave !== tip && leave.fade === -1 && leave.delay > 0, "then it lies there a moment before it fades out");
	assert.equal(await ended(done), false, "not ended while it lies there");
	finishAnims();
	assert.ok(await ended(done));
	assert.equal(board.scene.has(pawn), false, "removed");
	const knight = v.pieces.get("h7"), knightYaw = knight.rotation.y;
	const cut = playBoardStep({ op: "topple", square: "h7" });
	finishAnims(); // REDUCE MOTION TURNED ON OR A LOST CONTEXT MID-TIP: THE WHOLE TOPPLE LANDS AT ONCE
	assert.ok(await ended(cut));
	assert.deepEqual([knight.rotation.z, knight.rotation.y, v.anims.size, board.scene.has(knight)], [-Math.PI / 2, knightYaw, 0, false], "toward the h-file, cut short: ended & removed");
});

test("playBoardStep handover: the piece slides to its square on the receiving side, turning to its new colour as it lands, exactly on it; nothing when no piece of the giver's stands there", async () => {
	let v = setup({ f3: "wn" });
	const white = v.pieces.get("f3");
	const done = playBoardStep({ op: "handover", from: "f3", to: "g8", c: "b" });
	assert.equal(await ended(done), false, "it slides (played to its end)");
	assert.equal(white.userData.color, "w", "still the giver's while it slides");
	finishAnims();
	assert.ok(await ended(done));
	assert.deepEqual(on(v), { g8: "bn" });
	const black = v.pieces.get("g8");
	assert.ok(black !== white && stands(black, "g8") && board.scene.has(black) && !board.scene.has(white), "a new piece in the new colour on g8, the old one gone");
	v = setup({ f3: "bn" });
	await play({ op: "handover", from: "f3", to: "g8", c: "b" });
	assert.deepEqual(on(v), { f3: "bn" }, "already the receiver's (the board shows another piece there than the one handed over): it stays");
	v = setup({});
	await play({ op: "handover", from: "f3", to: "g8", c: "b" });
	assert.deepEqual(on(v), {}, "a hidden piece (the fog): nothing");
});

test("playBoardStep: no view or a lost context ends at once and changes nothing", async () => {
	const v = setup({ e2: "wp" });
	v.lost = true;
	assert.ok(await ended(playBoardStep({ op: "topple", square: "e2" })));
	assert.deepEqual(on(v), { e2: "wp" });
	assert.equal(v.anims.size, 0);
});
