/*
 *  prefs.js  --  chess frontend
 *	The CRT Monitor's Settings
 *	Which colour theme the terminal shows. Kept in localStorage under KEY; this is the only file that touches it, & every access is in a try,
 *	since storage can be blocked or full.
 *	No DOM & no three.js here, so the tests load it in Node (client/test/monitor/monitorPrefs.test.js)
 *
 */

import { THEME_IDS, DEFAULT_THEME } from "./themes.js";

const KEY = "MONITOR";

/* ---------------------------------------------------------------- */
// Settings
/* ---------------------------------------------------------------- */

/**
 * @description The settings a new player starts with
 * @return {object} version 2 settings on the default theme
 */
export function defaults() {
	return { version: 2, theme: DEFAULT_THEME };
}

/**
 * @description Make any stored value into valid settings
 * @param {*} raw whatever was parsed from storage
 * @return {object} settings; anything that is not a version 2 object with a known theme gives the defaults (so old version 1 settings are dropped)
 */
export function clean(raw) {
	if (!raw || typeof raw !== "object" || raw.version !== 2 || !THEME_IDS.includes(raw.theme)) { return defaults(); }
	return { version: 2, theme: raw.theme };
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
		store.setItem(KEY, JSON.stringify(clean(prefs)));
		return true;
	} catch {
		return false;
	}
}

export { KEY };
