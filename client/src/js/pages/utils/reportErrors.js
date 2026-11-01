/*
 *  reportErrors.js  --  chess frontend
 *	Browser Error Reports (#194)
 *  Sends uncaught errors, rejected promises & failed requests to POST /api/client-errors, where they become lines in the server's log.
 *  A 4xx is left out: those are normal answers (an expired session, a refused move). Game ids & queries are left out of every path
 *
 */

const ENDPOINT = "/api/client-errors";
const MAX_REPORTS = 10; // PER PAGE LOAD, THE SERVER HAS ITS OWN LIMITS TOO

/**
 * @description A URL's path without its query or game id
 * @param  {[string]} url [absolute or relative]
 * @param  {[object]} win [the window]
 * @return {[string]} path [e.g. "/api/chess/game/:id/move", undefined when it isn't a URL]
 */
function cleanPath(url, win) {
	try {
		return new URL(url, win.location.href).pathname.replace(/\/(game|play)\/[^/]+/, "/$1/:id");
	} catch {
		return undefined;
	}
}

/**
 * @description Starts reporting. Each entry point calls this before the rest of its code runs
 * @param  {[object]} win [the window, a stand-in in the tests]
 */
function startErrorReports(win = window) {
	const realFetch = win.fetch.bind(win);
	const seen = new Set();
	let leaving = false;

	function report(kind, details) {
		const key = `${kind}:${details.message}`; // THE SAME ERROR IN A LOOP IS ONE REPORT
		if (leaving || seen.has(key) || seen.size >= MAX_REPORTS) { return; }
		seen.add(key);
		const body = JSON.stringify({ kind, page: cleanPath(win.location.href, win), ...details });
		win.navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" })); // NOT fetch, SO A REPORT THAT FAILS CAN'T REPORT ITSELF
	}

	win.addEventListener("pagehide", () => { leaving = true; }); // REQUESTS CUT OFF BY LEAVING THE PAGE AREN'T ERRORS
	win.addEventListener("pageshow", () => { leaving = false; }); // BACK TO THIS PAGE FROM THE BROWSER'S CACHE

	win.addEventListener("error", (event) => {
		if (!event.filename) { return; } // "Script error." FROM ANOTHER SITE'S SCRIPT (A BROWSER EXTENSION), NOTHING TO GO ON
		report("error", { message: event.message, source: cleanPath(event.filename, win), line: event.lineno, column: event.colno });
	});

	win.addEventListener("unhandledrejection", (event) => {
		report("rejection", { message: event.reason?.message || String(event.reason) });
	});

	win.fetch = async (url, options) => {
		const request = `${options?.method || "GET"} ${cleanPath(url?.url || url, win)}`;
		try {
			const res = await realFetch(url, options);
			if (res.status >= 500) { report("request", { message: `${request} answered ${res.status}`, status: res.status }); }
			return res;
		} catch (err) {
			if (err.name != "AbortError") { report("request", { message: `${request} failed: ${err.message}` }); }
			throw err;
		}
	};
}


module.exports = { startErrorReports };
