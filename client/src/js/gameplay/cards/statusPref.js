/*
 *  statusPref.js  --  chess frontend
 *	Chess Cards Status Display
 *	How a piece's statuses are shown: "effects" (on the piece) or "badges". A change applies at once (the onChange listeners, three/statusFx) & is then saved:
 *	guests in localStorage, signed in players on their account (PUT /api/user/settings/status-display). The server lets one save through every 5 minutes, so a
 *	signed in player's first change saves at once & the later ones wait until 5 minutes after the last save, then save only if the mode still differs.
 *	The settings page & the play page's menu (gameplay/menu/index.js) change it, the play page seeds it (init, pages/play/index.js). No DOM, the tests require it
 *
 */

const MODES = ["effects", "badges"];
const KEY = "STATUS_DISPLAY"; // localStorage: A GUEST'S MODE
const URL = "/api/user/settings/status-display";
const SAVE_GAP = 5 * 60 * 1000 + 10 * 1000; // ms BETWEEN SAVES: THE SERVER'S limitStatusDisplay (5 min, server/middleware/rateLimit.js) COUNTS FROM WHEN A PUT ARRIVED, NOT WHEN IT WAS SENT, SO 10 s OF MARGIN

let mode = "effects";
let signedIn = false;
let savedMode = null; // THE MODE THE ACCOUNT HAS, AS FAR AS THIS PAGE KNOWS
let lastSave = null; // WHEN THIS PAGE LAST SAVED (Date.now), null: NOT YET
let timer = null; // THE DEFERRED SAVE
let retried = false; // THE LAST SAVE THAT FAILED IS ALREADY BEING RETRIED: ONE MORE FAILURE GIVES UP
let send = null; // (url, options) -> Promise, validate/index.js request BY DEFAULT
let storage = null; // localStorage BY DEFAULT
const listeners = [];

const valid = (m) => (MODES.includes(m) ? m : "effects");

/**
 * @description Seeds the mode when the page starts: a signed in player's from the server, a guest's from localStorage. Anything invalid or missing is "effects".
 * The listeners aren't called: nothing is drawn yet
 * @param  {[object]} opts [{ signedIn, saved (the server's status_display), fetch & storage (the tests' fakes) }]
 */
function init(opts = {}) {
	signedIn = Boolean(opts.signedIn);
	send = opts.fetch || ((url, options) => require("../validate/index.js").request(url, options)); // LOADED ON THE FIRST SAVE: THE TESTS NEVER LOAD IT, A 401 REFRESHES THE SESSION
	storage = opts.storage || null;
	clearTimeout(timer);
	timer = null;
	lastSave = null;
	retried = false;
	if (signedIn) { mode = valid(opts.saved); }
	else { try { mode = valid(store().getItem(KEY)); } catch { mode = "effects"; } } // STORAGE BLOCKED (PRIVATE MODE)
	savedMode = mode;
}

/**
 * @return {[string]} mode ["effects" or "badges"]
 */
function current() { return mode; }

/**
 * @description Applies a mode at once (every onChange listener), then saves it. The same mode or an invalid one changes nothing
 * @param  {[string]} next ["effects" or "badges"]
 */
function set(next) {
	if (!MODES.includes(next) || next === mode) { return; }
	mode = next;
	listeners.forEach((fn) => fn(mode));
	if (!signedIn) {
		try { store().setItem(KEY, mode); } catch { } // NOT SAVED (PRIVATE MODE) -> ONLY UNTIL THE PAGE RELOADS
		return;
	}
	if (timer) { return; } // THE DEFERRED SAVE TAKES WHATEVER THE MODE IS THEN
	const wait = lastSave === null ? 0 : lastSave + SAVE_GAP - Date.now();
	if (wait <= 0) { save(); } else { timer = setTimeout(save, wait); } // shortcut: A PAGE CLOSED BEFORE THE DEFERRED SAVE LOSES THE CHANGE, AS RULED
}

/**
 * @description Registers a listener for every change
 * @param  {[function]} fn [called with the new mode]
 */
function onChange(fn) { listeners.push(fn); }

// SAVES THE MODE IF THE ACCOUNT DOESN'T HAVE IT. THE MODE COUNTS AS SAVED ONLY ONCE THE SERVER SAYS 200
function save() {
	timer = null;
	if (mode === savedMode) { retried = false; return; } // SWITCHED BACK: THE NEXT CHANGE GETS ITS OWN RETRY
	const sent = mode;
	lastSave = Date.now();
	const done = (res) => { if (res?.status == 200) { savedMode = sent; retried = false; } else { failed(); } };
	try { Promise.resolve(send(URL, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status_display: sent }) })).then(done, failed); } catch { failed(); }
}

// NO ANSWER, A 429 OR AN ERROR: THE MODE STAYS UNSAVED & IS TRIED ONCE MORE AT THE NEXT ALLOWED TIME, THEN DROPPED QUIETLY (IT STILL APPLIES ON THIS PAGE)
function failed() {
	if (retried) { retried = false; return; }
	retried = true;
	if (!timer) { timer = setTimeout(save, lastSave + SAVE_GAP - Date.now()); } // A LATER CHANGE'S DEFERRED SAVE, IF ARMED, IS THE RETRY
}

function store() { return storage || globalThis.localStorage; } // READ INSIDE THE CALLER'S TRY, THE ACCESSOR CAN THROW

module.exports = { current, set, onChange, init, MODES };
