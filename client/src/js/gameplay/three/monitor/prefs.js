/*
 *  prefs.js  --  chess frontend
 *	The CRT Monitor's Settings
 *	Which channels the monitor offers, which one opens first & the opponent channel's background. Kept in localStorage under KEY; this is the only
 *	file that touches it, & every access is in a try, since storage can be blocked or full.
 *	No DOM & no three.js here, so the tests load it in Node (client/test/monitorPrefs.test.js)
 *
 */

const CHANNELS = ["face", "opponent", "eval", "moves", "actions", "setup"];
const LOCKED = ["face", "setup"]; // CAN'T BE TURNED OFF, SO THE MONITOR ALWAYS HAS A FACE & A WAY TO CHANGE ITS SETTINGS
const IDLES = ["card", "stars", "pipes"]; // THE OPPONENT CHANNEL'S BACKGROUNDS
const KEY = "MONITOR";

/* ---------------------------------------------------------------- */
// Settings
/* ---------------------------------------------------------------- */

/**
 * @description The settings a new player starts with
 * @return {object} defaultChannel null means by game: the face against a bot, the opponent against a friend
 */
export function defaults() {
	return { version: 1, defaultChannel: null, enabled: [...CHANNELS], idle: "stars" };
}

/**
 * @description Make any stored value into valid settings
 * @param {*} raw whatever was parsed from storage
 * @return {object} settings; anything that is not a version 1 object gives the defaults
 */
export function clean(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.version !== 1) { return defaults(); }
	const asked = Array.isArray(raw.enabled) ? raw.enabled : [];
	const enabled = CHANNELS.filter((id) => LOCKED.includes(id) || asked.includes(id)); // CHANNELS ORDER, UNKNOWN IDS DROPPED
	return {
		version: 1,
		defaultChannel: enabled.includes(raw.defaultChannel) ? raw.defaultChannel : null,
		enabled,
		idle: IDLES.includes(raw.idle) ? raw.idle : "stars",
	};
}

/* ---------------------------------------------------------------- */
// Storage
/* ---------------------------------------------------------------- */

/**
 * @description Read the settings from storage
 * @param {object} [storage] anything with getItem, localStorage by default
 * @return {object} settings; the defaults when storage is blocked, empty or broken
 */
export function loadPrefs(storage) {
	try {
		const store = storage || globalThis.localStorage; // READ INSIDE THE TRY, THE ACCESSOR CAN THROW
		return clean(JSON.parse(store.getItem(KEY)));
	} catch {
		return defaults();
	}
}

/**
 * @description Write the settings to storage
 * @param {object} prefs the settings
 * @param {object} [storage] anything with setItem, localStorage by default
 * @return {boolean} whether it was saved
 */
export function savePrefs(prefs, storage) {
	try {
		const store = storage || globalThis.localStorage; // READ INSIDE THE TRY, THE ACCESSOR CAN THROW
		store.setItem(KEY, JSON.stringify(prefs));
		return true;
	} catch {
		return false;
	}
}

export { CHANNELS, LOCKED, IDLES, KEY };
