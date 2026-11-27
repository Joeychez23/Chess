/*
 *  events.js  --  chess frontend
 *	The Terminal's Session Events
 *	Two game data snapshots in, the lines the terminal prints (& the ones it mails) out. Every field of the data may be missing.
 *	No DOM & no three.js here, so the tests load it in Node (client/test/monitor/termEvents.test.js)
 *
 */

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */

/**
 * @description The other side's tag
 * @param {object} d game data
 * @return {string} "[UNIT]" against a bot, "[REMOTE]" against a friend
 */
export function tagOf(d) {
	return d.ai ? "[UNIT]" : "[REMOTE]";
}

/**
 * @description The game's moves as one list
 * @param {object} d game data
 * @return {string[]} SAN in order, White's first
 */
export function plies(d) {
	return sided(d).map(({ san }) => san);
}

// Each ply with its colour; a game set up with Black to move has "…" in the first row's White cell, which is no ply
function sided(d) {
	const rows = Array.isArray(d.moves) ? d.moves.filter((row) => row && typeof row === "object") : [];
	return rows.flatMap(({ white, black }) => [{ san: white, side: "w" }, { san: black, side: "b" }])
		.filter(({ san }) => san && san !== "…").map(({ san, side }) => ({ san: String(san), side }));
}

// "WHITE WINS! BY CHECKMATE" -> "White wins! By checkmate"; kept local since kit.js is being rewritten
function sentence(text) {
	return String(text).toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (all, gap, letter) => gap + letter.toUpperCase());
}

// The colour to move, from the FEN's second field; without one, by whose turn it is
function toMove(d) {
	const side = String(d.fen || "").split(" ")[1];
	if (side === "w" || side === "b") { return side; }
	return d.yourTurn ? d.playerColor : (d.playerColor === "w" ? "b" : "w");
}

/* ---------------------------------------------------------------- */
// Events
/* ---------------------------------------------------------------- */

/**
 * @description What changed between two snapshots, as terminal events
 * @param {object|null} prev the snapshot before; null gives no events
 * @param {object} next the snapshot now
 * @return {object[]} [{ text, tone, mail }], mail one of "check", "lost", "terms", "reversal", "guidance", "fault", "answer" or null
 */
export function eventsFrom(prev, next) {
	if (!prev) { return []; }
	next = next || {};
	const out = [];
	const say = (text, tone, mail = null) => out.push({ text, tone, mail });
	if (prev.gameId !== next.gameId) {
		say("New session opened.", "ink");
		return out;
	}
	const tag = tagOf(next);
	const before = sided(prev);
	const after = sided(next);
	// The first ply that differs: anything before the old end changed is a takeback, everything after it is new
	let from = 0;
	while (from < before.length && from < after.length && before[from].san === after[from].san) { from++; }
	const reversal = from < before.length && !next.over;
	for (const { san, side } of after.slice(from)) {
		if (side === next.playerColor) {
			say(`[${next.who || "GUEST"}] ${san}`, "ink");
		} else {
			say(`${tag} ${san}`, "ink");
			if (san.includes("x")) { say("Asset lost.", "ink", "lost"); }
		}
	}
	// Mate is told by the closing line; a takeback onto check is not a new check, so it is not mailed
	const moved = next.fen !== prev.fen || from < Math.max(before.length, after.length);
	if (next.check && moved && !next.over) { say("Notice: check.", "hot", toMove(next) === next.playerColor && !reversal ? "check" : null); }
	if (reversal) { say("Reversal granted. Noted.", "ink"); }
	if (next.over && !prev.over) {
		const result = next.result ? sentence(next.result).replace(/[.\s]+$/, "") : "";
		say(result ? `${result}. Session closed.` : "Session closed.", "hot");
	}
	if (next.offline && !prev.offline) { say("Line fault.", "hot", "fault"); }
	if (!next.offline && prev.offline) { say("Link restarted.", "ink"); }
	const was = prev.offers || {};
	const now = next.offers || {};
	if (now.draw === "incoming" && was.draw !== "incoming") { say(`${tag} proposes terms.`, "hot", "terms"); }
	// The player's own terms went out: a bot answers at once (an accepted offer ends the game instead, told by the closing line)
	if (now.draw === "sent" && was.draw !== "sent" && !next.over) { say(next.ai ? `Terms sent. ${tag} declines.` : `Terms sent to ${tag}.`, "ink", "answer"); }
	if (now.takeback === "incoming" && was.takeback !== "incoming") { say(`${tag} requests a reversal.`, "hot", "reversal"); }
	if (Array.isArray(next.hint) && next.hint.length === 2 && next.hint.every((sq) => typeof sq === "string") && String(next.hint) !== String(prev.hint)) { say(`Guidance: ${next.hint[0]}${next.hint[1]}`, "dim", "guidance"); }
	return out;
}
