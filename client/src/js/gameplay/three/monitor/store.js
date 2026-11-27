/*
 *  store.js  --  chess frontend
 *	Meridian's Kept State
 *	The terminal's printed lines, log, mail & its windows (where each is, its size, open or minimized, & their stacking order: windows.js). Kept in localStorage under KEY; this is the
 *	only file that touches it, & every access is in a try, since storage can be blocked or full. clean() turns anything into a well-formed term.
 *	No DOM & no three.js here, so the tests load it in Node (client/test/monitor/termStore.test.js)
 *
 */

import { defaults as defaultWins, clean as cleanWins } from "./windows.js";

const KEY = "MERIDIAN";
const LINES_MAX = 60;
const LOG_MAX = 200;
const MAIL_MAX = 30;
const TONES = ["ink", "dim", "hot"];
const KINDS = ["check", "lost", "terms", "reversal", "guidance", "fault", "answer"]; // answer: WHAT CAME OF TERMS THE PLAYER SENT

/* ---------------------------------------------------------------- */
// State
/* ---------------------------------------------------------------- */

/**
 * @description The state a fresh terminal starts with
 * @return {object} term
 */
export function blank() {
	return { version: 2, gameId: null, lines: [], log: [], mail: [], wins: defaultWins(), flipped: false };
}

const tone = (t) => (TONES.includes(t) ? t : "ink");
const isTime = (t) => typeof t === "string" || Number.isFinite(t); // A STAMP LIKE "12:01" OR MS
const arr = (a) => (Array.isArray(a) ? a : []);

/**
 * @description Make any stored value into a well-formed term; never throws
 * @param {*} raw whatever was parsed from storage
 * @return {object} term; anything that is not a version 2 object gives blank() (a version 1 state too: it had no windows). Malformed lines, log entries & mails are dropped
 */
export function clean(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.version !== 2) { return blank(); }
	const lines = arr(raw.lines).filter((l) => Array.isArray(l) && typeof l[0] === "string").map((l) => [l[0], tone(l[1])]);
	const log = arr(raw.log).filter((e) => Array.isArray(e) && isTime(e[0]) && typeof e[1] === "string").map((e) => [e[0], e[1], tone(e[2])]);
	const mail = arr(raw.mail)
		.filter((m) => m && typeof m === "object" && KINDS.includes(m.kind) && isTime(m.at) && typeof m.text === "string")
		.map((m) => ({ kind: m.kind, at: m.at, text: m.text, read: m.read === true }));
	return {
		version: 2,
		gameId: typeof raw.gameId === "string" || Number.isFinite(raw.gameId) ? raw.gameId : null,
		lines: lines.slice(-LINES_MAX),
		log: log.slice(-LOG_MAX),
		mail: mail.slice(-MAIL_MAX),
		wins: cleanWins(raw.wins), // ALL OF THEM, ON THE DESK
		flipped: raw.flipped === true,
	};
}

/* ---------------------------------------------------------------- */
// Storage
/* ---------------------------------------------------------------- */

/**
 * @description Read the term from storage
 * @param {object} [storage] anything with getItem, localStorage by default
 * @return {object} term, its windows at their defaults; blank() when storage is blocked, empty or broken
 */
export function loadTerm(storage) {
	try {
		const store = storage || globalThis.localStorage; // READ INSIDE THE TRY, THE ACCESSOR CAN THROW
		return { ...clean(JSON.parse(store.getItem(KEY))), wins: defaultWins() }; // THE WINDOWS START OVER ON EVERY LOAD: ONLY THE LINES, THE LOG & THE MAIL COME BACK
	} catch {
		return blank();
	}
}

/**
 * @description Write the term to storage
 * @param {object} term the kept state
 * @param {object} [storage] anything with setItem, localStorage by default
 * @return {boolean} whether it was saved
 */
export function saveTerm(term, storage) {
	try {
		const store = storage || globalThis.localStorage; // READ INSIDE THE TRY, THE ACCESSOR CAN THROW
		store.setItem(KEY, JSON.stringify(clean(term))); // CLEANED, SO THE CAPS HOLD WHOEVER SAVES
		return true;
	} catch {
		return false;
	}
}

export { KEY, LINES_MAX, LOG_MAX, MAIL_MAX };
