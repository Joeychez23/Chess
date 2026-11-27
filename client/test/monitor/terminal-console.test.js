/*
 *  terminal-console.test.js  --  chess frontend tests
 *	The terminal's console: its commands, the session's events & the fault and maker's screens.
 *	One describe per source file, each as it was in its own test file. Run with npm run test:client
 *
 */

const { describe: group } = require("node:test");

// /
group("commands", () => {
	const { test } = require("node:test");
	const assert = require("node:assert/strict");
	const { INPUT_MAX, run, boardLines } = require("../../src/js/gameplay/three/monitor/commands.js");

	/* ---------------------------------------------------------------- */
	// Helpers
	/* ---------------------------------------------------------------- */

	const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
	const ALL = ["hint", "takeback", "draw", "restart", "pgn"].map((id) => ({ id, label: id, shown: true, enabled: true }));

	// A bot game, the player is White, nothing played yet, every action shown & enabled
	function base(over = {}) {
		return {
			gameId: "g1", who: "GUEST", signedIn: false, cards: false, ai: true, over: false, yourTurn: true, playerColor: "w",
			offline: false, thinking: false, saving: false, fen: START, check: false, result: null, material: 0,
			moves: [], opening: null, opponent: "Bot", hint: null, offers: { draw: null, takeback: null }, sound: true, actions: ALL,
			...over,
		};
	}

	// Actions with one entry changed
	const actions = (id, patch) => ALL.map((a) => (a.id === id ? { ...a, ...patch } : a));

	// Fake handlers that record every call; move answers with `moveReply`
	function fakes(moveReply = { san: "e4" }) {
		const calls = [];
		const h = {};
		for (const name of ["hint", "takeback", "draw", "declineDraw", "declineTakeback", "restart", "forfeit", "sound", "screen", "clear", "exit"]) {
			h[name] = (...args) => { calls.push([name, ...args]); };
		}
		h.move = (text) => { calls.push(["move", text]); return moveReply; };
		return { h, calls };
	}

	// Run one line; returns the printed lines, the calls & the term
	function go(line, over = {}, opts = {}) {
		const { h, calls } = fakes(opts.moveReply);
		const term = opts.term || { flipped: false, confirm: null };
		const out = run(line, { data: base(over), handlers: h, term });
		return { out, calls, term };
	}

	const UNKNOWN = [["Unknown command. Type help.", "hot"]];

	/* ---------------------------------------------------------------- */
	// The basics
	/* ---------------------------------------------------------------- */

	test("INPUT_MAX is 36", () => {
		assert.equal(INPUT_MAX, 36);
	});

	test("an empty or blank line prints nothing", () => {
		assert.deepEqual(go("").out, []);
		assert.deepEqual(go("   ").out, []);
	});

	/* ---------------------------------------------------------------- */
	// One test per command
	/* ---------------------------------------------------------------- */

	test("help prints the 13 command lines then the Also line, all dim", () => {
		const { out } = go("help");
		assert.deepEqual(out, [
			"board     print the board", "move e2e4 or just e2e4, Nf3", "moves     the moves so far", "status    whose turn it is",
			"hint      request guidance", "takeback  request a reversal", "draw      propose terms", "resign    end the session",
			"init      open a new session", "flip      turn the printed board", "clock     both players' time", "whoami    who is seated",
			"clear     wipe this window", "Also: log mail systems exit help [cmd]",
		].map((t) => [t, "dim"]));
	});

	test("help leaves out hint, takeback and draw when their actions are not shown", () => {
		const hidden = { actions: ALL.filter((a) => a.id === "restart").concat([{ id: "draw", shown: false, enabled: false }]) };
		const text = go("help", hidden).out.map(([t]) => t);
		assert.equal(text.length, 11);
		for (const name of ["hint ", "takeback ", "draw "]) { assert.ok(!text.some((t) => t.startsWith(name)), name); }
	});

	test("help with hint not shown has no hint line", () => {
		const text = go("help", { actions: actions("hint", { shown: false }) }).out.map(([t]) => t);
		assert.ok(!text.some((t) => t.startsWith("hint")));
		assert.equal(text.length, 13);
	});

	test("help <name> gives two dim lines, the second an example", () => {
		const { out } = go("help move");
		assert.equal(out.length, 2);
		assert.ok(out.every(([, tone]) => tone === "dim"));
		assert.ok(out[1][0].startsWith("Example: "));
	});

	test("help <name> covers every listed command plus log, mail, systems, exit, help", () => {
		const names = ["board", "move", "moves", "status", "hint", "takeback", "draw", "resign", "init", "flip", "clock", "whoami", "clear", "log", "mail", "systems", "exit", "help"];
		for (const name of names) {
			const { out } = go(`help ${name}`);
			assert.equal(out.length, 2, name);
			assert.ok(out[1][0].startsWith("Example: "), name);
		}
	});

	test("help <name> for a name that is not a command gives the unknown reply", () => {
		assert.deepEqual(go("help banana").out, UNKNOWN);
		assert.deepEqual(go("help hand").out, UNKNOWN);
	});

	test("help <name> for a hidden action gives the unknown reply", () => {
		for (const id of ["hint", "takeback", "draw"]) {
			assert.deepEqual(go(`help ${id}`, { actions: actions(id, { shown: false }) }).out, UNKNOWN, id);
		}
		assert.deepEqual(go("help hint", { actions: undefined }).out, UNKNOWN);
	});

	test("board prints 8 ink rows from White's side then the dim file letters", () => {
		const { out } = go("board");
		assert.equal(out.length, 9);
		assert.deepEqual(out[0], ["8 r n b q k b n r", "ink"]);
		assert.deepEqual(out[1], ["7 p p p p p p p p", "ink"]);
		assert.deepEqual(out[4], ["4 . . . . . . . .", "ink"]);
		assert.deepEqual(out[7], ["1 R N B Q K B N R", "ink"]);
		assert.deepEqual(out[8], ["  a b c d e f g h", "dim"]);
	});

	test("board prints from Black's side when term.flipped", () => {
		const { out } = go("board", {}, { term: { flipped: true, confirm: null } });
		assert.deepEqual(out[0], ["1 R N B K Q B N R", "ink"]);
		assert.deepEqual(out[7], ["8 r n b k q b n r", "ink"]);
		assert.deepEqual(out[8], ["  h g f e d c b a", "dim"]);
	});

	test("move with no move prints the usage line", () => {
		const { out, calls } = go("move");
		assert.deepEqual(out, [["Usage: move e2e4", "dim"]]);
		assert.deepEqual(calls, []);
	});

	test("move when the game is over says the session is closed", () => {
		const { out, calls } = go("e2e4", { over: true });
		assert.deepEqual(out, [["Session closed. Type init.", "dim"]]);
		assert.deepEqual(calls, []);
	});

	test("move when it is not your turn names who is awaited", () => {
		assert.deepEqual(go("e2e4", { yourTurn: false }).out, [["Awaiting [UNIT].", "dim"]]);
		assert.deepEqual(go("e2e4", { yourTurn: false, ai: false }).out, [["Awaiting [REMOTE].", "dim"]]);
	});

	test("move in a card game is refused", () => {
		const { out, calls } = go("move e2e4", { cards: true });
		assert.deepEqual(out, [["Moves are made on the board here.", "dim"]]);
		assert.deepEqual(calls, []);
	});

	test("move that is illegal is rejected naming the move", () => {
		const { out } = go("e2e5", {}, { moveReply: { reason: "Illegal move" } });
		assert.deepEqual(out, [["Rejected: e2e5 is not legal.", "hot"]]);
	});

	test("move with another reason is rejected with that reason", () => {
		const { out } = go("e2e4", {}, { moveReply: { reason: "Still saving" } });
		assert.deepEqual(out, [["Rejected: Still saving", "hot"]]);
	});

	test("move that is played prints nothing", () => {
		const { out, calls } = go("e2e4");
		assert.deepEqual(out, []);
		assert.deepEqual(calls, [["move", "e2e4"]]);
	});

	test("e2e4, Nf3, O-O and move e2e4 all reach handlers.move", () => {
		for (const [line, m] of [["e2e4", "e2e4"], ["Nf3", "Nf3"], ["O-O", "O-O"], ["0-0", "0-0"], ["exd5", "exd5"], ["move e2e4", "e2e4"]]) {
			assert.deepEqual(go(line).calls, [["move", m]], line);
		}
	});

	test("moves with none played says so", () => {
		assert.deepEqual(go("moves").out, [["No moves yet.", "dim"]]);
		assert.deepEqual(go("moves", { moves: undefined }).out, [["No moves yet.", "dim"]]);
	});

	test("moves prints numbered moves wrapped at 38 letters", () => {
		const moves = [];
		for (let n = 1; n <= 10; n++) { moves.push({ number: n, white: "Nf3", black: "Nf6" }); }
		moves.push({ number: 11, white: "e4" });
		const { out } = go("moves", { moves });
		assert.ok(out.length > 1);
		assert.ok(out.every(([t]) => t.length <= 38));
		assert.ok(out[0][0].startsWith("1. Nf3 Nf6 2. Nf3 Nf6"));
		assert.equal(out.map(([t]) => t).join(" "), moves.map((m) => [`${m.number}.`, m.white, m.black].filter(Boolean).join(" ")).join(" "));
	});

	test("status names the move and who is awaited", () => {
		assert.deepEqual(go("status").out, [["Move 1. Awaiting [GUEST].", "ink"]]);
		const moves = [{ number: 1, white: "e4", black: "e5" }, { number: 2, white: "Nf3" }];
		assert.deepEqual(go("status", { moves, yourTurn: false, playerColor: "w" }).out, [["Move 2. Awaiting [UNIT].", "ink"]]);
	});

	test("status when over says the session is closed", () => {
		assert.deepEqual(go("status", { over: true }).out, [["Session closed.", "ink"]]);
	});

	test("status adds check, the opening and the remote opponent", () => {
		const { out } = go("status", { check: true, opening: { eco: "C20", name: "King's Pawn Game" }, ai: false, opponent: "alice" });
		assert.deepEqual(out, [
			["Move 1. Awaiting [GUEST].", "ink"], ["Notice: check.", "hot"], ["Opening: C20 King's Pawn Game", "dim"], ["Remote: alice", "dim"],
		]);
	});

	test("hint not enabled says no guidance", () => {
		const { out, calls } = go("hint", { actions: actions("hint", { enabled: false }) });
		assert.deepEqual(out, [["No guidance available.", "dim"]]);
		assert.deepEqual(calls, []);
	});

	test("hint enabled requests guidance", () => {
		const { out, calls } = go("hint");
		assert.deepEqual(out, [["Guidance requested.", "dim"]]);
		assert.deepEqual(calls, [["hint"]]);
	});

	test("takeback not enabled is not permitted", () => {
		const { out, calls } = go("takeback", { actions: actions("takeback", { enabled: false }) });
		assert.deepEqual(out, [["Reversal not permitted.", "hot"]]);
		assert.deepEqual(calls, []);
	});

	test("takeback requests, or grants an incoming request", () => {
		let r = go("takeback");
		assert.deepEqual(r.out, [["Reversal requested.", "dim"]]);
		assert.deepEqual(r.calls, [["takeback"]]);
		r = go("takeback", { offers: { draw: null, takeback: "incoming" } });
		assert.deepEqual(r.out, [["Reversal granted.", "dim"]]);
		assert.deepEqual(r.calls, [["takeback"]]);
	});

	test("draw when over says the session is closed", () => {
		assert.deepEqual(go("draw", { over: true }).out, [["Session closed. Type init.", "dim"]]);
	});

	test("draw not enabled says terms are not available", () => {
		const { out, calls } = go("draw", { actions: actions("draw", { enabled: false }) });
		assert.deepEqual(out, [["Terms not available.", "dim"]]);
		assert.deepEqual(calls, []);
	});

	test("draw accepts an incoming offer at once", () => {
		const { out, calls } = go("draw", { offers: { draw: "incoming", takeback: null } });
		assert.deepEqual(out, [["Terms accepted.", "dim"]]);
		assert.deepEqual(calls, [["draw"]]);
	});

	test("draw asks to confirm, then sends on the second draw", () => {
		const term = { flipped: false, confirm: null };
		const first = go("draw", {}, { term });
		assert.deepEqual(first.out, [["Propose a draw? Type draw again to confirm.", "hot"]]);
		assert.deepEqual(first.calls, []);
		assert.equal(term.confirm, "draw");
		const second = go("draw", {}, { term });
		assert.deepEqual(second.out, [["Terms sent.", "dim"]]);
		assert.deepEqual(second.calls, [["draw"]]);
		assert.equal(term.confirm, null);
	});

	test("resign when over says the session is closed", () => {
		assert.deepEqual(go("resign", { over: true }).out, [["Session closed. Type init.", "dim"]]);
	});

	test("resign asks to confirm, then forfeits with no line", () => {
		const term = { flipped: false, confirm: null };
		assert.deepEqual(go("resign", {}, { term }).out, [["End the session? Type resign again to confirm.", "hot"]]);
		assert.equal(term.confirm, "resign");
		const second = go("resign", {}, { term });
		assert.deepEqual(second.out, []);
		assert.deepEqual(second.calls, [["forfeit"]]);
	});

	test("resign then board then resign does not forfeit", () => {
		const term = { flipped: false, confirm: null };
		go("resign", {}, { term });
		go("board", {}, { term });
		assert.equal(term.confirm, null);
		const third = go("resign", {}, { term });
		assert.deepEqual(third.calls, []);
		assert.equal(term.confirm, "resign");
	});

	test("held Enter on resign forfeits once only; a third run says closed only when over", () => {
		const { h, calls } = fakes();
		const term = { flipped: false, confirm: null };
		run("resign", { data: base(), handlers: h, term });
		run("resign", { data: base(), handlers: h, term });
		assert.deepEqual(calls, [["forfeit"]]);
		assert.deepEqual(run("resign", { data: base({ over: true }), handlers: h, term }), [["Session closed. Type init.", "dim"]]);
		assert.deepEqual(run("resign", { data: base(), handlers: h, term }), [["End the session? Type resign again to confirm.", "hot"]]);
		assert.deepEqual(calls, [["forfeit"]]);
	});

	test("init while the session is open says resign first", () => {
		const { out, calls } = go("init");
		assert.deepEqual(out, [["Session open. Type resign first.", "dim"]]);
		assert.deepEqual(calls, []);
	});

	test("init with restart not enabled says not available", () => {
		const { out, calls } = go("init", { over: true, actions: actions("restart", { enabled: false }) });
		assert.deepEqual(out, [["Not available.", "dim"]]);
		assert.deepEqual(calls, []);
	});

	test("init restarts, and says a rematch was requested in a friend game", () => {
		let r = go("init", { over: true });
		assert.deepEqual(r.out, []);
		assert.deepEqual(r.calls, [["restart"]]);
		r = go("init", { over: true, ai: false });
		assert.deepEqual(r.out, [["Rematch requested.", "dim"]]);
		assert.deepEqual(r.calls, [["restart"]]);
	});

	test("flip toggles term.flipped then prints the board", () => {
		const term = { flipped: false, confirm: null };
		const { out } = go("flip", {}, { term });
		assert.equal(term.flipped, true);
		assert.deepEqual(out[8], ["  h g f e d c b a", "dim"]);
		go("flip", {}, { term });
		assert.equal(term.flipped, false);
	});

	test("clock says there is no clock", () => {
		assert.deepEqual(go("clock").out, [["No clock in this session.", "dim"]]);
	});

	test("whoami names the signed-in player or GUEST", () => {
		assert.deepEqual(go("whoami", { signedIn: true, who: "alice" }).out, [["alice [clearance: standard]", "ink"]]);
		assert.deepEqual(go("whoami").out, [["GUEST [clearance: none]", "ink"]]);
	});

	test("clear calls handlers.clear", () => {
		const { out, calls } = go("clear");
		assert.deepEqual(out, []);
		assert.deepEqual(calls, [["clear"]]);
	});

	test("log, mail and systems open their screens", () => {
		for (const id of ["log", "mail", "systems"]) {
			const { out, calls } = go(id);
			assert.deepEqual(out, []);
			assert.deepEqual(calls, [["screen", id]], id);
		}
	});

	test("exit calls handlers.exit and is not taken for a move", () => {
		const { out, calls } = go("exit");
		assert.deepEqual(out, []);
		assert.deepEqual(calls, [["exit"]]);
	});

	test("anything else gives the unknown reply", () => {
		assert.deepEqual(go("banana").out, UNKNOWN);
	});

	/* ---------------------------------------------------------------- */
	// Edge cases
	/* ---------------------------------------------------------------- */

	test("HELP works in upper case", () => {
		assert.equal(go("HELP").out.length, 14);
	});

	test("hand, play x, discard x and card x give the unknown reply in traditional and card games", () => {
		for (const cards of [false, true]) {
			for (const line of ["hand", "play x", "discard x", "card x"]) {
				const { out, calls } = go(line, { cards });
				assert.deepEqual(out, UNKNOWN, `${line} cards=${cards}`);
				assert.deepEqual(calls, []);
			}
		}
	});

	test("no help line and no help <name> text mentions cards or curses", () => {
		const names = ["board", "move", "moves", "status", "hint", "takeback", "draw", "resign", "init", "flip", "clock", "whoami", "clear", "log", "mail", "systems", "exit", "help"];
		const all = go("help").out.concat(...names.map((n) => go(`help ${n}`).out), go("help card").out);
		for (const [text] of all) { assert.ok(!/card|curse/i.test(text), text); }
	});

	test("help plus one echo line fits in 15 lines", () => {
		assert.ok(go("help").out.length + 1 <= 15);
	});

	test("a 400-letter line gives the unknown reply without throwing", () => {
		assert.deepEqual(go("z".repeat(400)).out, UNKNOWN);
	});

	test("run never throws for odd input or sparse data", () => {
		const lines = [null, undefined, 42, "help", "help hint", "status", "moves", "board", "draw", "takeback", "hint", "init", "e2e4", "whoami", "😀", "é"];
		const datas = [{}, { actions: null, moves: null, offers: null, opening: null }, { over: true }];
		for (const data of datas) {
			for (const line of lines) {
				assert.doesNotThrow(() => run(line, { data, handlers: { move: () => undefined }, term: { flipped: false, confirm: null } }), String(line));
			}
		}
	});

	/* ---------------------------------------------------------------- */
	// boardLines
	/* ---------------------------------------------------------------- */

	test("boardLines gives 8 rows of dots for a bad or missing FEN", () => {
		for (const fen of [undefined, null, "", "garbage", "8/8/8", "rnbqkbnr/ppppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w"]) {
			const out = boardLines(fen, false);
			assert.equal(out.length, 9, String(fen));
			for (let i = 0; i < 8; i++) { assert.equal(out[i][0], `${8 - i} . . . . . . . .`); }
		}
	});

	test("boardLines reads only the piece placement", () => {
		const out = boardLines("4k3/8/8/8/8/8/8/4K3", false);
		assert.deepEqual(out[0], ["8 . . . . k . . .", "ink"]);
		assert.deepEqual(out[7], ["1 . . . . K . . .", "ink"]);
	});

	test("a move handler that is missing, throws or answers nothing is a refusal, not silence or an error", () => {
		const d = { yourTurn: true, actions: [] };
		for (const move of [undefined, () => { throw new Error("x"); }, () => undefined]) {
			assert.deepEqual(run("e2e4", { data: d, handlers: { move }, term: { flipped: false, confirm: null } }), [["Rejected: Not available.", "hot"]]);
		}
	});

	test("a missing name prints as GUEST and a null row in the move list is skipped", () => {
		const term = { flipped: false, confirm: null };
		assert.equal(run("status", { data: { yourTurn: true }, handlers: {}, term })[0][0], "Move 1. Awaiting [GUEST].");
		assert.equal(run("whoami", { data: { signedIn: true }, handlers: {}, term })[0][0], "GUEST [clearance: standard]");
		assert.deepEqual(run("moves", { data: { moves: [null, { number: 1, white: "e4" }] }, handlers: {}, term }), [["1. e4", "ink"]]);
	});

	test("new is no longer a command", () => {
		assert.deepEqual(run("new", { data: { over: true, actions: [] }, handlers: {}, term: { flipped: false, confirm: null } }), [["Unknown command. Type help.", "hot"]]);
	});
});

// /
group("termEvents", () => {
	const { test } = require("node:test");
	const assert = require("node:assert/strict");
	const { tagOf, plies, eventsFrom } = require("../../src/js/gameplay/three/monitor/events.js");

	/* ---------------------------------------------------------------- */
	// Helpers
	/* ---------------------------------------------------------------- */

	const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

	// A bot game, the player is White, nothing played yet
	function base(over = {}) {
		return {
			gameId: "g1", who: "GUEST", signedIn: false, cards: false, ai: true, over: false, yourTurn: true, playerColor: "w",
			offline: false, thinking: false, saving: false, fen: START, check: false, result: null, material: 0,
			moves: [], opening: null, opponent: "Bot", hint: null, offers: { draw: null, takeback: null }, sound: true, actions: [],
			...over,
		};
	}

	const one = (text, tone, mail = null) => ({ text, tone, mail });

	/* ---------------------------------------------------------------- */
	// tagOf & plies
	/* ---------------------------------------------------------------- */

	test("tagOf gives [UNIT] for a bot and [REMOTE] for a friend", () => {
		assert.equal(tagOf(base()), "[UNIT]");
		assert.equal(tagOf(base({ ai: false })), "[REMOTE]");
	});

	test("plies flattens the move rows in order, the last row without black", () => {
		assert.deepEqual(plies(base({ moves: [{ number: 1, white: "e4", black: "e5" }, { number: 2, white: "Nf3" }] })), ["e4", "e5", "Nf3"]);
		assert.deepEqual(plies({}), []);
	});

	/* ---------------------------------------------------------------- */
	// eventsFrom
	/* ---------------------------------------------------------------- */

	test("a null prev gives no events", () => {
		assert.deepEqual(eventsFrom(null, base()), []);
	});

	test("an identical pair gives no events", () => {
		assert.deepEqual(eventsFrom(base(), base()), []);
	});

	test("a sparse snapshot pair gives no events and does not throw", () => {
		assert.deepEqual(eventsFrom({ gameId: "g1" }, { gameId: "g1" }), []);
	});

	test("a new game id opens a new session and nothing else", () => {
		const next = base({ gameId: "g2", moves: [{ number: 1, white: "e4" }], check: true, offline: true });
		assert.deepEqual(eventsFrom(base(), next), [one("New session opened.", "ink")]);
	});

	test("a new ply by the player prints the player's name and the move", () => {
		assert.deepEqual(eventsFrom(base(), base({ moves: [{ number: 1, white: "e4" }] })), [one("[GUEST] e4", "ink")]);
	});

	test("a 20-letter name is not cut", () => {
		const who = "ABCDEFGHIJKLMNOPQRST";
		assert.deepEqual(eventsFrom(base({ who }), base({ who, moves: [{ number: 1, white: "e4" }] })), [one(`[${who}] e4`, "ink")]);
	});

	test("a new ply by the other side prints the tag and the move", () => {
		const prev = base({ moves: [{ number: 1, white: "e4" }] });
		assert.deepEqual(eventsFrom(prev, base({ moves: [{ number: 1, white: "e4", black: "e5" }] })), [one("[UNIT] e5", "ink")]);
		assert.deepEqual(eventsFrom({ ...prev, ai: false }, base({ ai: false, moves: [{ number: 1, white: "e4", black: "e5" }] })), [one("[REMOTE] e5", "ink")]);
	});

	test("a capture by the other side also mails Asset lost", () => {
		const prev = base({ moves: [{ number: 1, white: "e4", black: "d5" }, { number: 2, white: "Nc3" }] });
		const next = base({ moves: [{ number: 1, white: "e4", black: "d5" }, { number: 2, white: "Nc3", black: "dxe4" }] });
		assert.deepEqual(eventsFrom(prev, next), [one("[UNIT] dxe4", "ink"), one("Asset lost.", "ink", "lost")]);
	});

	test("a capture by the player mails nothing", () => {
		const prev = base({ moves: [{ number: 1, white: "e4", black: "d5" }] });
		const next = base({ moves: [{ number: 1, white: "e4", black: "d5" }, { number: 2, white: "exd5" }] });
		assert.deepEqual(eventsFrom(prev, next), [one("[GUEST] exd5", "ink")]);
	});

	test("two plies in one update give two events in order", () => {
		const next = base({ moves: [{ number: 1, white: "e4", black: "e5" }] });
		assert.deepEqual(eventsFrom(base(), next), [one("[GUEST] e4", "ink"), one("[UNIT] e5", "ink")]);
	});

	test("the player as Black owns the odd plies", () => {
		const next = base({ playerColor: "b", moves: [{ number: 1, white: "e4", black: "e5" }] });
		assert.deepEqual(eventsFrom(base({ playerColor: "b" }), next), [one("[UNIT] e4", "ink"), one("[GUEST] e5", "ink")]);
	});

	test("check on a new position prints a notice, mailed when the player is in check", () => {
		const prev = base({ moves: [{ number: 1, white: "e4" }], fen: "x b - - 0 1" });
		const theirs = base({ moves: [{ number: 1, white: "e4" }, { number: 2, white: "Bb5" }], fen: "y b - - 0 2", check: true });
		assert.deepEqual(eventsFrom(prev, theirs).at(-1), one("Notice: check.", "hot"));
		const mine = base({ fen: "z w - - 0 2", check: true });
		assert.deepEqual(eventsFrom(base({ fen: "q b - - 0 1" }), mine), [one("Notice: check.", "hot", "check")]);
	});

	test("check on the same position prints nothing again", () => {
		assert.deepEqual(eventsFrom(base({ check: true }), base({ check: true })), []);
	});

	test("fewer plies in a game still going prints the reversal", () => {
		const prev = base({ moves: [{ number: 1, white: "e4", black: "e5" }] });
		assert.deepEqual(eventsFrom(prev, base()), [one("Reversal granted. Noted.", "ink")]);
		assert.deepEqual(eventsFrom(prev, base({ over: true, result: "DRAW" })), [one("Draw. Session closed.", "hot")]);
	});

	test("the game ending prints the result in sentence case and closes the session", () => {
		const next = base({ over: true, result: "WHITE WINS! BY CHECKMATE" });
		assert.deepEqual(eventsFrom(base(), next), [one("White wins! By checkmate. Session closed.", "hot")]);
		assert.deepEqual(eventsFrom(base(), base({ over: true })), [one("Session closed.", "hot")]);
	});

	test("the link dropping prints and mails a line fault", () => {
		assert.deepEqual(eventsFrom(base(), base({ offline: true })), [one("Line fault.", "hot", "fault")]);
	});

	test("the link coming back prints a restart", () => {
		assert.deepEqual(eventsFrom(base({ offline: true }), base()), [one("Link restarted.", "ink")]);
	});

	test("an incoming draw offer prints and mails terms", () => {
		const next = base({ offers: { draw: "incoming", takeback: null } });
		assert.deepEqual(eventsFrom(base(), next), [one("[UNIT] proposes terms.", "hot", "terms")]);
		assert.deepEqual(eventsFrom(base({ offers: { draw: "sent" } }), base({ offers: { draw: "sent" } })), []);
	});

	test("an incoming takeback request prints and mails a reversal", () => {
		const next = base({ ai: false, offers: { draw: null, takeback: "incoming" } });
		assert.deepEqual(eventsFrom(base({ ai: false }), next), [one("[REMOTE] requests a reversal.", "hot", "reversal")]);
	});

	test("a new hint prints and mails the guidance", () => {
		assert.deepEqual(eventsFrom(base(), base({ hint: ["e2", "e4"] })), [one("Guidance: e2e4", "dim", "guidance")]);
		assert.deepEqual(eventsFrom(base({ hint: ["e2", "e4"] }), base({ hint: ["e2", "e4"] })), []);
		assert.deepEqual(eventsFrom(base({ hint: ["e2", "e4"] }), base()), []);
	});

	/* ---------------------------------------------------------------- */
	// Black to move first, rulings & malformed data
	/* ---------------------------------------------------------------- */

	test("plies drops the blank White cell of a game that starts with Black to move", () => {
		assert.deepEqual(plies(base({ moves: [{ number: 5, white: "…", black: "Bxe5" }, { number: 6, white: "Nf3" }] })), ["Bxe5", "Nf3"]);
	});

	test("a game that starts with Black to move gives each ply to the right side", () => {
		const first = [{ number: 5, white: "…", black: "Bxe5" }];
		const second = [{ number: 5, white: "…", black: "Bxe5" }, { number: 6, white: "Nxe5" }];
		assert.deepEqual(eventsFrom(base(), base({ moves: first })), [one("[UNIT] Bxe5", "ink"), one("Asset lost.", "ink", "lost")]);
		assert.deepEqual(eventsFrom(base({ moves: first }), base({ moves: second })), [one("[GUEST] Nxe5", "ink")]);
		const black = { playerColor: "b" };
		assert.deepEqual(eventsFrom(base(black), base({ ...black, moves: first })), [one("[GUEST] Bxe5", "ink")]);
		assert.deepEqual(eventsFrom(base({ ...black, moves: first }), base({ ...black, moves: second })), [one("[UNIT] Nxe5", "ink"), one("Asset lost.", "ink", "lost")]);
	});

	test("a takeback onto a position in check prints the notice but mails nothing", () => {
		const prev = base({ fen: "x w - - 0 3", moves: [{ number: 1, white: "e4", black: "e5" }, { number: 2, white: "Qh5" }] });
		const next = base({ fen: "y w - - 0 2", check: true, moves: [{ number: 1, white: "e4" }] });
		assert.deepEqual(eventsFrom(prev, next), [one("Notice: check.", "hot"), one("Reversal granted. Noted.", "ink")]);
	});

	test("checkmate prints no check notice, only the closing line", () => {
		const prev = base({ fen: "x b - - 0 1", moves: [{ number: 1, white: "e4" }] });
		const next = base({ fen: "y w - - 0 2", check: true, over: true, result: "BLACK WINS! BY CHECKMATE", moves: [{ number: 1, white: "e4", black: "Qh4#" }] });
		assert.deepEqual(eventsFrom(prev, next), [one("[UNIT] Qh4#", "ink"), one("Black wins! By checkmate. Session closed.", "hot")]);
	});

	test("a missing or empty name prints as GUEST", () => {
		const moves = [{ number: 1, white: "e4" }];
		assert.deepEqual(eventsFrom(base({ who: undefined }), base({ who: undefined, moves })), [one("[GUEST] e4", "ink")]);
		assert.deepEqual(eventsFrom(base({ who: "" }), base({ who: "", moves })), [one("[GUEST] e4", "ink")]);
	});

	test("malformed snapshots and move lists do not throw", () => {
		assert.deepEqual(eventsFrom(base(), null), [one("New session opened.", "ink")]);
		assert.deepEqual(eventsFrom({}, undefined), []);
		assert.deepEqual(eventsFrom(base(), base({ moves: {} })), []);
		assert.deepEqual(eventsFrom(base(), base({ moves: [null, { number: 1, white: "e4" }] })), [one("[GUEST] e4", "ink")]);
		assert.deepEqual(plies(base({ moves: [{ number: 1, white: "e4", black: 5 }] })), ["e4", "5"]);
	});

	test("a hint without two squares prints nothing", () => {
		assert.deepEqual(eventsFrom(base(), base({ hint: [] })), []);
		assert.deepEqual(eventsFrom(base(), base({ hint: ["e2"] })), []);
	});

	test("check after a new ply is noticed even without a fen", () => {
		assert.deepEqual(eventsFrom({ gameId: 1 }, { gameId: 1, check: true, moves: [{ white: "e4" }] }).at(-1), one("Notice: check.", "hot"));
	});

	test("a takeback and a new ply in one update print both", () => {
		const prev = base({ moves: [{ number: 1, white: "e4", black: "e5" }] });
		const next = base({ moves: [{ number: 1, white: "e4", black: "c5" }] });
		assert.deepEqual(eventsFrom(prev, next), [one("[UNIT] c5", "ink"), one("Reversal granted. Noted.", "ink")]);
	});
});

// /
group("boot", () => {
	const { test, describe } = require("node:test");
	const assert = require("node:assert/strict");
	const boot = require("../../src/js/gameplay/three/monitor/boot.js");
	const { textWidth } = require("../../src/js/gameplay/three/pixelFont.js");

	const { FAULT_MS, SPLASH_MS, CHAR_MS, nextPhase, typed, faultRows, drawFault, drawSplash } = boot;

	// EVERY COLOUR DIFFERENT, SO A TEST CAN TELL WHICH ONE A PART USED
	const T = { id: "t", label: "Test", bg: "#000001", ink: "#000002", dim: "#000003", faint: "#000004", hot: "#000005", bar: "#000006", brand: "#000007", splash: "#000008", glow: false };

	function fake() {
		const calls = [];
		return { calls, fillStyle: "", fillRect(x, y, w, h) { calls.push({ x, y, w, h, color: this.fillStyle }); } };
	}
	const whole = (c) => [c.x, c.y, c.w, c.h].every(Number.isInteger);
	const onGrid = (c) => c.x >= 0 && c.y >= 0 && c.x + c.w <= 320 && c.y + c.h <= 240;

	describe("boot timing", () => {
		test("the timing constants match the plan", () => {
			assert.deepEqual([FAULT_MS, SPLASH_MS, CHAR_MS], [5000, 3000, 45]);
		});
		test("the boot lines: a guest, a signed in player, a long name cut before the clearance, a game with moves", () => {
			assert.equal(boot.LINE_MS, 400);
			assert.ok(boot.bootLines({}).includes("User: GUEST [clearance: none]"));
			assert.ok(boot.bootLines({ who: "joe", signedIn: true }).includes("User: joe [clearance: standard]"));
			const long = boot.bootLines({ who: "W".repeat(60), signedIn: true }).find((l) => l.startsWith("User:"));
			assert.ok(long.endsWith("[clearance: standard]") && long.length <= 40, long);
			assert.equal(boot.bootLines({ moves: [{ number: 1, white: "e4", black: "e5" }, { number: 2, white: "Nf3" }] }).at(-1), "Session restored at move 2.");
			assert.ok(!boot.bootLines({}).join(" ").includes("operator"));
		});
		test("one more boot line every 400 ms, the newest whole by the time the next starts; all at once under reduced motion", () => {
			const lines = boot.bootLines({});
			assert.deepEqual(boot.bootRows(lines, 0, false).map((r) => r.text), [""]);
			assert.deepEqual(boot.bootRows(lines, 399, false).map((r) => r.text), [lines[0]]);
			assert.deepEqual(boot.bootRows(lines, 400, false).map((r) => [r.x, r.y]), [[47, 57], [47, 66]]);
			assert.deepEqual(boot.bootRows(lines, 1e6, false).map((r) => r.text), lines);
			assert.deepEqual(boot.bootRows(lines, 0, true).map((r) => r.text), lines);
			assert.deepEqual(boot.bootRows(lines, -200, false).map((r) => r.text), [""]);
			assert.deepEqual(boot.bootRows(null, 500, false), []);
		});
		test("the phases walk fault, maker's screen, then none", () => {
			assert.equal(nextPhase("fault", 4999, { offline: false }), "fault");
			assert.equal(nextPhase("fault", 5000, { offline: false }), "splash");
			assert.equal(nextPhase("splash", 2999, { offline: false }), "splash");
			assert.equal(nextPhase("splash", 3000, { offline: false }), null);
			assert.equal(nextPhase(null, 100000, { offline: true }), null);
		});
		test("the old boot phase and an unknown phase give none", () => {
			assert.equal(nextPhase("boot", 0, { lines: 9 }), "boot");
			assert.equal(nextPhase("boot", 3599, { lines: 9 }), "boot");
			assert.equal(nextPhase("boot", 3600, { lines: 9 }), null);
			assert.equal(nextPhase("boot", NaN, { lines: 9 }), null);
			assert.equal(nextPhase("boot", 0), null);
			assert.equal(nextPhase("other", 0, {}), null);
		});
		test("the fault waits however long the link stays down", () => {
			assert.equal(nextPhase("fault", 5000, { offline: true }), "fault");
			assert.equal(nextPhase("fault", 3600000, { offline: true }), "fault");
		});
		test("a lines field in the third argument is ignored", () => {
			assert.equal(nextPhase("splash", 3000, { lines: 9 }), "boot");
			assert.equal(nextPhase("splash", 2999, { lines: 0 }), "splash");
			assert.equal(nextPhase("fault", 5000, { lines: 9 }), "splash");
		});
		test("a missing or null third argument does not throw", () => {
			assert.equal(nextPhase("fault", 6000), "splash");
			assert.equal(nextPhase("fault", 6000, null), "splash");
			assert.equal(nextPhase("splash", 3000, null), null);
		});
		test("an elapsed that is not a number ends the maker's screen", () => {
			for (const e of [NaN, undefined, "x", null]) { assert.equal(nextPhase("splash", e, {}), null, String(e)); }
		});
		test("an elapsed that is not a number holds the fault until a real one arrives", () => {
			for (const e of [NaN, undefined, "x", "6000", null]) { assert.equal(nextPhase("fault", e, { offline: false }), "fault", String(e)); }
			assert.equal(nextPhase("fault", NaN, { offline: true }), "fault");
		});
		test("a clock stepped forward online reaches no phase in bounded time", () => {
			for (const start of ["fault", "splash"]) {
				for (const step of [1, 16, 250, 1000, 9000]) {
					let phase = start, began = 0, t = 0;
					while (phase && t <= FAULT_MS + SPLASH_MS + 2 * step) {
						t += step;
						const next = nextPhase(phase, t - began, { offline: false });
						if (next !== phase) { phase = next; began = t; }
					}
					assert.equal(phase, null, `${start} by ${step} ms`);
				}
			}
		});
		test("typed never shows half of a two-unit character", () => {
			assert.equal(typed("😀😀", 45), "😀");
			assert.equal(typed("a😀b", 90), "a😀");
		});
		test("typed shows one letter per 45 ms and nothing before it starts", () => {
			assert.equal(typed("abc", 90), "ab");
			assert.equal(typed("abc", 0), "");
			assert.equal(typed("abc", -500), "");
			assert.equal(typed("abc", 10000), "abc");
		});
	});

	describe("boot drawing", () => {
		test("the fault fills the grid in the background, then types its two lines in ink", () => {
			assert.deepEqual(faultRows(0, false).map((r) => r.text), ["", ""]);
			assert.deepEqual(faultRows(100000, false).map((r) => [r.text, r.x, r.y]), [["A fault has occurred.", 60, 44], ["The session will resume shortly.", 60, 56]]);
			assert.deepEqual(faultRows(0, true).map((r) => r.text), ["A fault has occurred.", "The session will resume shortly."]);
			const ctx = fake();
			drawFault(ctx, T, 100000, false);
			assert.deepEqual(ctx.calls[0], { x: 0, y: 0, w: 320, h: 240, color: T.bg });
			assert.ok(ctx.calls.length > 1 && ctx.calls.slice(1).every((c) => c.color === T.ink && whole(c) && onGrid(c)));
		});
		test("the maker's screen is a splash block with MERIDIAN and the version in the background colour", () => {
			const ctx = fake();
			drawSplash(ctx, T);
			assert.deepEqual(ctx.calls[0], { x: 0, y: 0, w: 320, h: 240, color: T.bg });
			assert.deepEqual(ctx.calls[1], { x: 16, y: 4, w: 288, h: 228, color: T.splash });
			const rest = ctx.calls.slice(2);
			assert.ok(rest.every((c) => c.color === T.bg && whole(c)));
			const name = rest.filter((c) => c.y >= 102 && c.y < 102 + 21);
			const left = Math.min(...name.map((c) => c.x)), right = Math.max(...name.map((c) => c.x + c.w));
			assert.equal(right - left, textWidth("MERIDIAN") * 3);
			assert.deepEqual([left, right], [90, 231]); // MIDDLE COLUMN 160
			const ver = rest.filter((c) => c.y >= 132 && c.y < 139);
			assert.equal(Math.max(...ver.map((c) => c.x + c.w)), 234);
		});
	});
});
