/*
 *  commands.js  --  chess frontend
 *	The Terminal Console's Commands
 *	One typed line in, the lines the console prints out; a command may call one of the handlers. Every field of the game data may be missing.
 *	No DOM & no three.js here, so the tests load it in Node (client/test/monitor/commands.test.js)
 *
 */

import { tagOf, plies } from "./events.js";

export const INPUT_MAX = 36;

const WRAP = 38;
const BARE_MOVE = /^([a-h][1-8x]|[KQRBN]|O-O|0-0)/;
const UNKNOWN = ["Unknown command. Type help.", "hot"];
const CLOSED = ["Session closed. Type init.", "dim"];

// [name, help line, what it does, example]; names with a help line are the ones help lists
const COMMANDS = [
	["board", "board     print the board", "Prints the board as it stands.", "board"],
	["move", "move e2e4 or just e2e4, Nf3", "Plays a move by squares or by name.", "move e2e4"],
	["moves", "moves     the moves so far", "Lists the moves of this session.", "moves"],
	["status", "status    whose turn it is", "Shows the move and whose turn it is.", "status"],
	["hint", "hint      request guidance", "Asks for guidance on a move.", "hint"],
	["takeback", "takeback  request a reversal", "Asks to take back the last move.", "takeback"],
	["draw", "draw      propose terms", "Proposes terms, or accepts them.", "draw"],
	["resign", "resign    end the session", "Ends the session. Asks to confirm.", "resign"],
	["init", "init      open a new session", "Opens a new session once closed.", "init"],
	["flip", "flip      turn the printed board", "Turns the printed board around.", "flip"],
	["clock", "clock     both players' time", "Shows both players' time.", "clock"],
	["whoami", "whoami    who is seated", "Shows who is seated.", "whoami"],
	["clear", "clear     wipe this window", "Wipes this window.", "clear"],
	["log", null, "Opens the log.", "log"],
	["mail", null, "Opens the mail.", "mail"],
	["systems", null, "Opens the systems readout.", "systems"],
	["exit", null, "Leaves the terminal.", "exit"],
	["help", null, "Lists the commands, or explains one.", "help move"],
];

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */

// The game data's entry for an action; a missing one is neither shown nor enabled
function action(d, id) {
	return (Array.isArray(d.actions) ? d.actions : []).find((a) => a && a.id === id) || {};
}

// hint, takeback & draw are commands only while their action is shown
function hidden(d, name) {
	return ["hint", "takeback", "draw"].includes(name) && !action(d, name).shown;
}

const dim = (text) => [text, "dim"];

/**
 * @description The board printed from a FEN's piece placement
 * @param {string} fen any FEN; only the first field is read, & a bad or missing one gives an empty board
 * @param {boolean} flipped true prints it from Black's side
 * @return {Array} 8 ink rows "8 r n b q k b n r" (White upper case, empty ".") then the dim file letters
 */
export function boardLines(fen, flipped) {
	let rows = String(fen || "").split(" ")[0].split("/").map((rank) => rank.replace(/[1-8]/g, (n) => ".".repeat(n)));
	if (rows.length !== 8 || !rows.every((r) => /^[pnbrqkPNBRQK.]{8}$/.test(r))) { rows = Array(8).fill("........"); }
	let out = rows.map((r, i) => [`${8 - i} ${r.split("").join(" ")}`, "ink"]);
	let files = "a b c d e f g h";
	if (flipped) {
		out = out.reverse().map(([t, tone]) => [t[0] + " " + t.slice(2).split(" ").reverse().join(" "), tone]);
		files = files.split(" ").reverse().join(" ");
	}
	return [...out, dim(`  ${files}`)];
}

// "1. e4 e5 2. Nf3" wrapped at WRAP letters; a move number stays with White's move
function moveLines(d) {
	const words = (Array.isArray(d.moves) ? d.moves : []).map((row) => row || {}).flatMap(({ number, white, black }, i) =>
		[white && `${number || i + 1}. ${white}`, black].filter(Boolean));
	if (!words.length) { return [dim("No moves yet.")]; }
	const lines = [""];
	for (const w of words) {
		const last = lines[lines.length - 1];
		if (last && last.length + 1 + w.length > WRAP) { lines.push(w); } else { lines[lines.length - 1] = last ? `${last} ${w}` : w; }
	}
	return lines.map((t) => [t, "ink"]);
}

function status(d) {
	const n = Math.floor(plies(d).length / 2) + 1;
	const out = [[d.over ? "Session closed." : `Move ${n}. Awaiting ${d.yourTurn ? `[${d.who || "GUEST"}]` : tagOf(d)}.`, "ink"]];
	if (d.check) { out.push(["Notice: check.", "hot"]); }
	if (d.opening && d.opening.name) { out.push(dim(`Opening: ${[d.opening.eco, d.opening.name].filter(Boolean).join(" ")}`)); }
	if (!d.ai && d.opponent) { out.push(dim(`Remote: ${d.opponent}`)); }
	return out;
}

function move(m, d, h) {
	if (!m) { return [dim("Usage: move e2e4")]; }
	if (d.over) { return [CLOSED]; }
	if (!d.yourTurn) { return [dim(`Awaiting ${tagOf(d)}.`)]; }
	if (d.cards) { return [dim("Moves are made on the board here.")]; }
	let r;
	try { r = (typeof h.move === "function" && h.move(m)) || { reason: "Not available." }; } catch { r = { reason: "Not available." }; } // A HANDLER THAT'S MISSING, ANSWERS NOTHING OR THROWS IS A REFUSAL, NEVER SILENCE
	if (!r.reason) { return []; }
	return [[r.reason === "Illegal move" ? `Rejected: ${m} is not legal.` : `Rejected: ${r.reason}`, "hot"]];
}

/* ---------------------------------------------------------------- */
// Run
/* ---------------------------------------------------------------- */

/**
 * @description Run one typed line
 * @param {string} line what was typed
 * @param {object} ctx { data, handlers, term }: the game data, the handlers a command may call, & { flipped, confirm }, which this changes
 * @return {Array} the lines to print, each [text, tone]
 */
export function run(line, { data, handlers, term } = {}) {
	const d = data || {};
	const h = handlers || {};
	const t = term || {};
	const call = (name, ...args) => { if (typeof h[name] === "function") { h[name](...args); } };
	const words = String(line ?? "").trim().split(/\s+/).filter(Boolean);
	if (!words.length) { return []; }
	const known = COMMANDS.some(([name]) => name === words[0].toLowerCase());
	const [cmd, arg] = !known && BARE_MOVE.test(words[0]) ? ["move", words[0]] : [words[0].toLowerCase(), words[1]];
	const pending = t.confirm;
	t.confirm = null;

	switch (cmd) {
	case "help": {
		if (arg) {
			const name = arg.toLowerCase();
			const entry = COMMANDS.find(([n]) => n === name);
			return entry && !hidden(d, name) ? [dim(entry[2]), dim(`Example: ${entry[3]}`)] : [UNKNOWN];
		}
		return COMMANDS.filter(([name, text]) => text && !hidden(d, name)).map(([, text]) => dim(text))
			.concat([dim("Also: log mail systems exit help [cmd]")]);
	}
	case "board": return boardLines(d.fen, t.flipped);
	case "move": return move(arg, d, h);
	case "moves": return moveLines(d);
	case "status": return status(d);
	case "hint":
		if (!action(d, "hint").enabled) { return [dim("No guidance available.")]; }
		call("hint");
		return [dim("Guidance requested.")];
	case "takeback":
		if (!action(d, "takeback").enabled) { return [["Reversal not permitted.", "hot"]]; }
		call("takeback");
		return [dim((d.offers || {}).takeback === "incoming" ? "Reversal granted." : "Reversal requested.")];
	case "draw":
		if (d.over) { return [CLOSED]; }
		if (!action(d, "draw").enabled) { return [dim("Terms not available.")]; }
		if ((d.offers || {}).draw === "incoming") { call("draw"); return [dim("Terms accepted.")]; }
		if (pending !== "draw") { t.confirm = "draw"; return [["Propose a draw? Type draw again to confirm.", "hot"]]; }
		call("draw");
		return [dim("Terms sent.")];
	case "resign":
		if (d.over) { return [CLOSED]; }
		if (pending !== "resign") { t.confirm = "resign"; return [["End the session? Type resign again to confirm.", "hot"]]; }
		call("forfeit");
		return [];
	case "init":
		if (!d.over) { return [dim("Session open. Type resign first.")]; }
		if (!action(d, "restart").enabled) { return [dim("Not available.")]; }
		call("restart");
		return d.ai ? [] : [dim("Rematch requested.")];
	case "flip":
		t.flipped = !t.flipped;
		return boardLines(d.fen, t.flipped);
	case "clock":
		// shortcut: the app has no timed games, read the clocks here when it does
		return [dim("No clock in this session.")];
	case "whoami": return [[d.signedIn ? `${d.who || "GUEST"} [clearance: standard]` : "GUEST [clearance: none]", "ink"]];
	case "clear": call("clear"); return [];
	case "log": case "mail": case "systems": call("screen", cmd); return [];
	case "exit": call("exit"); return [];
	default: return [UNKNOWN];
	}
}
