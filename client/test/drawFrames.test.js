/*
 *  drawFrames.test.js  --  chess frontend tests
 *	The 2D board's frames (gameplay/draw/): draw/index.js runs on stubs (no DOM, no canvas) & every canvas call, every call to its
 *	neighbours & the game state after each frame is recorded, then hashed per scenario. The hashes were recorded from draw/index.js
 *	before Task 26 split it into draw.tile.js & draw.slide.js, so the split draws exactly what the one file drew: the same calls, in
 *	the same order, with the same numbers. A hash changes with any change to what a frame draws: when that's on purpose, put the new
 *	hash (in the failure message) in HASHES. DRAW_FRAMES_FILE runs the same frames on another copy of draw/index.js.
 *	The log holds chess.js's answers too (moves, fen, check), so a chess.js upgrade can change hashes with no drawing change: after
 *	an upgrade, check the 2D board by eye in the browser, then run this file and put each new hash from its failure message in HASHES.
 *	draw/index.js mixes require & export: a load hook turns its require lines into imports & a resolve hook swaps every neighbour
 *	but facing.js for a data: module that records through globalThis.__DRAW
 *
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { registerHooks } = require("node:module");
const { Chess } = require("chess.js");

const target = path.resolve(process.env.DRAW_FRAMES_FILE || path.join(__dirname, "../src/js/gameplay/draw/index.js"));
const drawDir = path.dirname(target);
const FACING = pathToFileURL(path.join(__dirname, "../src/js/gameplay/draw/facing.js")).href;
const isDrawFile = (url) => url && url.startsWith(pathToFileURL(drawDir).href + "/") && /\/(index|draw\.[a-z]+)\.js$/.test(url);

const G = globalThis.__DRAW = { log: [], timers: [], now: 1000 };
const log = (...entry) => G.log.push(entry);

/* ---- recorders ---- */

G.ctx = new Proxy({}, {
	get: (t, prop) => (...args) => log("ctx." + String(prop), ...args),
	set: (t, prop, value) => { log("ctx." + String(prop) + "=", value); return true; },
});
G.images = new Proxy({}, { get: (t, n) => ({ image: "img:" + String(n) }) });
const chess = new Chess();
G.chess = new Proxy(chess, {
	get: (t, prop) => {
		const value = t[prop];
		if (typeof value !== "function") return value;
		return (...args) => {
			const out = value.apply(t, args);
			if (prop !== "board") log("chess." + String(prop), args, prop === "moves" ? out.map((m) => m.san) : out);
			return out;
		};
	},
});
G.game = {};

globalThis.setTimeout = (fn, ms) => { log("setTimeout", ms); G.timers.push(fn); return G.timers.length; };
Object.defineProperty(globalThis, "performance", { value: { now: () => G.now }, configurable: true, writable: true });

const SPRITES = ["tableShdw", "wRightKnightImg", "wLeftKnightImg", "wRightKnightShdw", "wLeftKnightShdw", "wRightKnightRefl", "wLeftKnightRefl",
	"bRightKnightImg", "bLeftKnightImg", "bRightKnightShdw", "bLeftKnightShdw", "bRightKnightRefl", "bLeftKnightRefl",
	"moveHighlight", "takeableHighlight", "checkHighlight"];

const STUBS = {
	"../state/index.js": "const G = globalThis.__DRAW; export const game = G.game; export const ctx = G.ctx; export const chessInst = G.chess;",
	"../images/index.js": "export const images = globalThis.__DRAW.images;",
	"../layout/index.js": "const G = globalThis.__DRAW; export function renderBoard() { G.log.push(['renderBoard']); return G.board; }",
	"../sprites/index.js": SPRITES.map((name) => `export const ${name} = ${JSON.stringify(name)};`).join(" "),
	"../animate/index.js": `const G = globalThis.__DRAW; const game = G.game;
		export function stepSlide(tile, square) {
			G.log.push(['stepSlide', square]);
			const xSquares = tile.xSlideTo - square % 8; const ySquares = tile.ySlideTo - Math.floor(square / 8);
			tile.slideProgress = tile.testProgress;
			tile.xDiff = xSquares * game.tileWidth * tile.slideProgress; tile.yDiff = -ySquares * game.tileHeight * tile.slideProgress;
		}
		export function handleKnightHop(tile) {
			G.log.push(['handleKnightHop', tile.square]);
			let xMoved = 0; let yMoved = 0;
			if (tile.isSliding) {
				if (tile.xSlideTo != tile.x) { xMoved = Math.abs(tile.xDiff) / (Math.abs(tile.xSlideTo - tile.x) * game.tileWidth); }
				if (tile.ySlideTo != tile.y) { yMoved = Math.abs(tile.yDiff) / (Math.abs(tile.ySlideTo - tile.y) * game.tileHeight); }
				game.knightHop = Math.sin(Math.PI * Math.max(xMoved, yMoved));
			} else { game.knightHop = 0; }
		}`,
	"../animate/timing.js": "export const KNIGHT_PAUSE_MS = 100;",
	"./overlay.js": "const G = globalThis.__DRAW; export function overlayShows(game) { G.log.push(['overlayShows']); return G.overlay; }",
	"../moves/index.js": "const G = globalThis.__DRAW; export async function landSlide(index) { G.log.push(['landSlide', index]); G.game.tiles[index].xSlideTo = 0; G.game.tiles[index].ySlideTo = 0; if (G.landRefresh) { G.game.tiles = Array.from({ length: 64 }, (v, q) => ({ refreshed: q })); } await null; G.log.push(['landSlide done', index]); if (G.landThrows) throw new Error('land'); }",
	"./pieceSprites.js": `const G = globalThis.__DRAW; const game = G.game;
		export function setPieceSprites(color, back) {
			G.log.push(['setPieceSprites', color, back]);
			const side = back ? 'Back' : 'Front';
			for (const p of ['King', 'Queen', 'Rook']) { game[color + p + 'Img'] = color + side + p + 'Img'; game[color + p + 'Shdw'] = color + side + p + 'Shdw'; game[color + p + 'Refl'] = color + side + p + 'Refl'; }
			game[color + 'BishopBlackSqImg'] = color + side + 'BishopB'; game[color + 'BishopWhiteSqImg'] = color + side + 'BishopW';
			game[color + 'BishopShdw'] = color + side + 'BishopShdw'; game[color + 'BishopRefl'] = color + side + 'BishopRefl';
		}
		export function handlePawnDirection() {
			G.log.push(['handlePawnDirection']);
			for (const c of ['w', 'b']) { game[c + 'PawnImg'] = c + 'PawnImg'; game[c + 'PawnShdw'] = c + 'PawnShdw'; game[c + 'PawnRefl'] = c + 'PawnRefl'; }
		}
		export function setKnightSide(color, side) {
			G.log.push(['setKnightSide', color, side]);
			const s = side == 'right' ? 'Right' : 'Left';
			game[color + 'KnightImg'] = color + s + 'KnightImg'; game[color + 'KnightShdw'] = color + s + 'KnightShdw'; game[color + 'KnightRefl'] = color + s + 'KnightRefl';
		}`,
	"./taken.js": "const G = globalThis.__DRAW; export function setTakenPieceArr(c) { G.log.push(['setTakenPieceArr', c]); return ['taken-' + c]; } export function renderTakenPieces(t, c, b) { G.log.push(['renderTakenPieces', t, c, b.length]); }",
};

registerHooks({
	resolve: (specifier, context, next) => {
		if (isDrawFile(context.parentURL)) {
			if (STUBS[specifier]) return { url: "data:text/javascript," + encodeURIComponent(STUBS[specifier]), shortCircuit: true };
			if (specifier === "./facing.js") return { url: FACING, shortCircuit: true };
		}
		return next(specifier, context);
	},
	load: (url, context, next) => {
		if (!isDrawFile(url)) return next(url, context);
		const out = next(url, { ...context, format: "module" });
		const source = String(out.source)
			.replace(/const (\{[^}]*\}) = require\(("[^"]+")\);/g, "import $1 from $2;")
			.replace(/const (\w+) = require\(("[^"]+")\);/g, "import * as $1 from $2;");
		return { ...out, format: "module", source };
	},
});

const draw = require(target);

/* ---- game state ---- */

function pieceLists() { // EVERY PIECE ON THE BOARD, NEVER MOVED (from: null)
	const lists = { w_piece: [], b_piece: [], w_knight: [], b_knight: [] };
	for (const row of chess.board()) for (const p of row) {
		if (!p) continue;
		lists[p.color + (p.type == "n" ? "_knight" : "_piece")].push({ from: null, to: p.square });
	}
	return lists;
}

function reset(fen, viewColor, extra = {}) {
	chess.load(fen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
	const lists = pieceLists();
	for (const k of Object.keys(G.game)) delete G.game[k];
	Object.assign(G.game, {
		viewColor, playerColor: viewColor, opponentColor: viewColor == "w" ? "b" : "w",
		tiles: Array.from({ length: 64 }, () => ({})),
		tileWidth: 80, tileHeight: 70, xBoardOff: 13, yBoardOff: 17, xPieceOffset: 6, yPieceOffset: 5, cw: 900, ch: 800,
		response: { w_piece: JSON.stringify(lists.w_piece), b_piece: JSON.stringify(lists.b_piece), w_knight: JSON.stringify(lists.w_knight), b_knight: JSON.stringify(lists.b_knight) },
		moveObj: { from: "a1", to: "a1" }, mousedownTile: false, clickedTile: false, availableMovesData: { piece: null, square: null },
		wPieceCount: { king: 0, queen: 0, bishop: 0, knight: 0, rook: 0, pawn: 0 },
		bPieceCount: { king: 0, queen: 0, bishop: 0, knight: 0, rook: 0, pawn: 0 },
		annotations: [], hint: null, lastOpponentMove: null, currPromotion: false, opposingMove: false,
		currSlide: false, slideStart: false, knightHop: 0, tileX: -1, tileY: -1, mouseDownTime: null, refresh: false,
	}, extra);
	G.board = { clickX: 160, clickY: 140 };
	G.overlay = "all";
	G.landThrows = false;
	G.landRefresh = false;
	draw.handleInitialData();
}

function tileIndex(square) { // SCREEN TILE OF A SQUARE
	const column = square.charCodeAt(0) - 97; const rank = Number(square[1]);
	return G.game.viewColor == "b" ? (rank - 1) * 8 + (7 - column) : (8 - rank) * 8 + column;
}

function slide(from, to, progress, extra = {}) { // MARK THE TILE ON from AS SLIDING TO to
	const q = tileIndex(from); const t = tileIndex(to);
	const piece = chess.get(from);
	Object.assign(G.game.tiles[q], { isSliding: true, xSlideTo: t % 8, ySlideTo: Math.floor(t / 8), testProgress: progress, square: from, type: piece.type, color: piece.color }, extra);
	G.game.currSlide = true;
	G.game.moveObj = { from, to };
	return q;
}

async function frame(name) {
	log("=== frame", name);
	await G.game.drawScreen();
	for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
	log("state", JSON.parse(JSON.stringify({ ...G.game, tiles: G.game.tiles, drawScreen: undefined })));
}

async function runTimers() { const timers = G.timers.splice(0); for (const fn of timers) { log("timer fires"); fn(); } }

/* ---- the frames ---- */

const OPEN = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
const MIDDLE = "r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 4 4";

const SCENARIOS = {
	async startWhite() { reset(null, "w"); await frame("start w"); },
	async startBlack() { reset(null, "b"); await frame("start b"); },
	async lastMoveHintAnnotations() {
		for (const view of ["w", "b"]) {
			reset(null, view, { lastOpponentMove: ["e7", "e5"], hint: ["g1", "f3"], annotations: [{ from: "e2", to: "e4" }, { from: "d4", to: "d4" }, { from: "b1", to: "c3" }] });
			await frame("annotations " + view);
		}
	},
	async selectedPiece() {
		for (const view of ["w", "b"]) {
			reset(null, view);
			const q = tileIndex("g1");
			G.game.clickedTile = { type: "n", square: "g1", color: "w" };
			G.game.tiles[q].isClicked = true;
			await frame("selected knight " + view);
			await frame("selected knight again (cached moves) " + view);
			G.game.clickedTile = { type: "p", square: "e2", color: "w" };
			await frame("selected pawn " + view);
		}
	},
	async heldPiecePreview() {
		const fen = "rnbqkbnr/ppp2ppp/8/3pp3/4P3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 0 4";
		const fen2 = "rnbqkbnr/ppp2ppp/8/3pp3/4P3/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 0 4";
		for (const view of ["w", "b"]) {
			for (const [square, type, over, position] of [["e4", "p", "d5"], ["f3", "n", "e5"], ["f3", "n", "g5"], ["f1", "b", "c4"], ["d1", "q", "e2"], ["e1", "k", "e2"], ["h1", "r", "g1"], ["c3", "n", "b5"], ["c1", "b", "g5", fen2], ["e2", "p", "e3", null]]) {
				reset(position === undefined ? fen : position, view);
				const q = tileIndex(square);
				const t = tileIndex(over);
				G.game.mousedownTile = { type, square, color: "w", x: q % 8, y: Math.floor(q / 8) };
				Object.assign(G.game.tiles[q], { isMousedown: true });
				G.game.tileX = t % 8; G.game.tileY = Math.floor(t / 8);
				G.game.mouseDownTime = null;
				await frame(`held ${type} ${square} over ${over} ${view}`);
				G.now = 1200; // LONGER THAN THE DRAG HOLD
				await frame(`held ${type} ${square} over ${over} later ${view}`);
				G.now = 1000;
				G.game.tileX = 0; G.game.tileY = 0; // OFF EVERY MOVE
				await frame(`held ${type} ${square} off moves ${view}`);
				G.game.tileX = 7; G.game.tileY = Math.floor(q / 8); // OFF EVERY MOVE, TO THE RIGHT
				G.game.tiles[q].x = 7;
				await frame(`held ${type} ${square} off moves right ${view}`);
			}
		}
	},
	async heldBlackPiece() {
		const fen = "rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 2 3";
		for (const view of ["w", "b"]) for (const [square, type, over, position] of [["f6", "n", "e4"], ["f6", "n", "g4"], ["f8", "b", "c5"], ["d8", "q", "e7"], ["e8", "k", "e7"], ["h8", "r", "g8"], ["f8", "b", "e7"], ["d7", "p", "d6"], ["c8", "b", "f5", "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2"]]) {
			reset(position || fen, view, { playerColor: "b", opponentColor: "w" });
			const q = tileIndex(square); const t = tileIndex(over);
			G.game.mousedownTile = { type, square, color: "b", x: q % 8, y: Math.floor(q / 8) };
			Object.assign(G.game.tiles[q], { isMousedown: true });
			G.game.tileX = t % 8; G.game.tileY = Math.floor(t / 8);
			await frame(`black held ${type} ${square} over ${over} ${view}`);
			for (const column of [0, 7, q % 8]) {
				G.game.tileX = column; G.game.tileY = 3;
				G.game.tiles[q].x = undefined;
				await frame(`black held ${type} ${square} off moves at column ${column} ${view}`);
			}
		}
	},
	async hoverAndClickedOwnSquare() {
		reset(null, "w");
		G.game.tiles[tileIndex("e2")].isHovering = true;
		G.game.tiles[tileIndex("b1")].isHovering = true;
		await frame("hover");
		reset(null, "w");
		G.game.tiles[tileIndex("d2")].isClicked = true;
		G.game.clickedTile = { type: "p", square: "d2", color: "w" };
		await frame("clicked on own square");
	},
	async opposingMoveAndPromotion() {
		reset(null, "w", { opposingMove: true, clickedTile: { type: "p", square: "e2", color: "w" } });
		await frame("opposing move: no moves drawn");
		for (const overlay of ["all", "picker", "none"]) for (const player of ["w", "b"]) for (const view of ["w", "b"]) {
			reset("8/P6k/8/8/8/8/6Kp/8 w - - 0 1", view, { currPromotion: true, playerColor: player, opponentColor: player == "w" ? "b" : "w" });
			G.overlay = overlay;
			await frame(`promotion ${overlay} ${player} ${view}`);
		}
		for (const overlay of ["picker", "none"]) { reset(null, "b"); G.overlay = overlay; await frame("3D " + overlay); }
		for (const view of ["w", "b"]) {
			reset("8/P6k/8/8/8/8/6Kp/8 w - - 0 1", view, { currPromotion: true });
			slide("g2", "f3", 0.5);
			await frame("promotion with a slide " + view);
		}
	},
	async check() {
		for (const view of ["w", "b"]) {
			reset("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3", view);
			await frame("white in check " + view);
			reset("rnbqkbnr/ppppp2p/5p2/6pQ/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 3", view);
			await frame("black in check " + view);
		}
	},
	async slides() {
		const fen = "r3k2r/pppq1ppp/2n2n2/3pp3/2B1P1b1/2NP1N2/PPPBQPPP/R3K2R w KQkq - 0 1";
		const cases = [
			["d2", "g5"], ["c4", "a6"], ["c4", "b3"], ["e2", "e3"], ["a1", "d1"], ["h2", "h4"], ["g4", "f3"], ["d7", "h3"], ["d5", "e4"],
			["e1", "g1"], ["c6", "b4"], ["a7", "a5"], ["e2", "a6"], ["h1", "f1"], ["a8", "b8"], ["h8", "g8"], ["a1", "b1"], ["c4", "a2"], ["d7", "a4"], ["g4", "h5"], ["d2", "h6"], ["a7", "b8"], ["h2", "g1"],
		];
		for (const view of ["w", "b"]) for (const [from, to] of cases) for (const progress of [0, 0.3, 0.5, 0.75, 1]) {
			reset(fen, view);
			slide(from, to, progress);
			await frame(`slide ${from}-${to} ${progress} ${view}`);
		}
	},
	async knightHop() {
		const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
		for (const view of ["w", "b"]) for (const [from, to, position] of [["b1", "c3"], ["g1", "f3"], ["g8", "f6"], ["b8", "a6"], ["g1", "h3"], ["b8", "c6", OPEN], ["g8", "e7", OPEN], ["c6", "d4", MIDDLE], ["f3", "e5", MIDDLE], ["a6", "b8", "r1bqkbnr/pppppppp/n7/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 1 2"], ["h3", "g1", "rnbqkbnr/pppppppp/8/8/8/7N/PPPPPPPP/RNBQKB1R b KQkq - 1 1"]]) {
			reset(position || fen, view);
			slide(from, to, 0);
			G.game.slideStart = true;
			await frame(`hop ${from}-${to} first frame ${view}`);
			await frame(`hop ${from}-${to} during pause ${view}`);
			await runTimers();
			for (const progress of [0.2, 0.4, 0.5, 0.6, 0.8, 0.99]) {
				G.game.tiles[tileIndex(from)].testProgress = progress;
				await frame(`hop ${from}-${to} ${progress} ${view}`);
			}
			G.game.tiles[tileIndex(from)].testProgress = 1;
			await frame(`hop ${from}-${to} lands ${view}`);
			await frame(`hop ${from}-${to} after landing ${view}`);
			G.game.currSlide = false;
			await frame(`hop ${from}-${to} after landing, slide off ${view}`);
		}
	},
	async hopTimerAfterLanding() {
		reset(null, "w");
		const q = slide("b1", "c3", 0);
		G.game.slideStart = true;
		await frame("hop pause then land before timer");
		G.game.tiles[q].testProgress = 1;
		await frame("land");
		await runTimers();
		await frame("after late timer");
	},
	async landThrows() {
		reset(null, "w");
		slide("e2", "e4", 1);
		G.landThrows = true;
		await frame("land throws (pawn)");
		reset(null, "w");
		slide("b1", "c3", 1);
		G.landThrows = true;
		await frame("land throws (knight)");
	},
	async landingReplacesTiles() { // THE REAL landSlide CAN RUN refreshData (A NEW TILE ARRAY) BEFORE ITS FIRST await, HALFWAY THROUGH THE FRAME
		for (const view of ["w", "b"]) for (const [from, to] of [["c2", "c4"], ["c1", "g5"], ["b1", "c3"], ["g1", "f3"], ["h1", "h3"], ["d1", "h5"]]) {
			reset("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPP2PPP/RNBQKBNR w KQkq - 0 2", view);
			slide(from, to, 1);
			G.landRefresh = true;
			G.game.mousedownTile = { xAvailInt: 3, yAvailInt: 4 };
			await frame(`landing replaces tiles ${from}-${to} ${view}`);
			G.landRefresh = false;
			await frame(`frame after replaced tiles ${from}-${to} ${view}`);
		}
	},
	async noReflections() { // lightObstruction IS ALWAYS true TODAY; THIS ONLY CHECKS A SLIDE WITH THE BOARD SHIFTED
		reset(null, "b", { xPieceOffset: 0, yPieceOffset: 0, xBoardOff: 0.5, yBoardOff: 0.25 });
		slide("c1", "f4", 0.4);
		await frame("offsets");
	},
	async dragWithSlideInFlight() {
		reset("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "w");
		slide("d7", "d5", 0.5);
		G.game.mousedownTile = { type: "n", square: "g1", color: "w" };
		G.game.tiles[tileIndex("g1")].isMousedown = true;
		G.game.tileX = 5; G.game.tileY = 5;
		await frame("held knight while a slide is going");
	},
};

const HASHES = { // Recorded from draw/index.js at 1785d70, before the split
	startWhite: "6fcff9b8634a6d76",
	startBlack: "f850744efe085e9f",
	lastMoveHintAnnotations: "a527ba826d32bf42",
	selectedPiece: "a6cc468e7783edc2",
	heldPiecePreview: "d68146dbb80a59fd",
	heldBlackPiece: "4e8f9e95fe4a3d92",
	hoverAndClickedOwnSquare: "d96935ab1a98aca1",
	opposingMoveAndPromotion: "193b39a4380dc390",
	check: "da6c9e35459bae07",
	slides: "d5ba1d8620afa972",
	knightHop: "4bca24bec13dbedd",
	hopTimerAfterLanding: "6bcb9d85630a9d27",
	landThrows: "79e95c2c2a51a30f",
	landingReplacesTiles: "d38ad83a610d3cd8",
	noReflections: "d09f92d1021b32ea",
	dragWithSlideInFlight: "5b7095df2ae90c40",
};

for (const [name, run] of Object.entries(SCENARIOS)) {
	test(`draw frames: ${name}`, async () => {
		G.log.length = 0;
		await run();
		const hash = createHash("sha256").update(JSON.stringify(G.log)).digest("hex").slice(0, 16);
		assert.equal(hash, HASHES[name], `${name} frames hash ${hash}: the frames drew something else`);
	});
}
