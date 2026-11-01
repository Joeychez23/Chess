/*
 *  logServerErrors.js  --  chess server
 *	5xx Log Lines (#194)
 *  One line for each 5xx answer, which an alarm counts (terraform/modules/monitoring). It only matches lines that START with "HTTP 5",
 *  so a request can't set it off by putting those words in a URL or an error report. The query is left out: a login's callback has its code there
 *
 */

/**
 * @description Express middleware, logs the answer once it's sent. GET /api/health is left out: its 503 has its own alarm
 */
function logServerErrors(req, res, next) {
	res.on("finish", () => {
		const path = req.originalUrl.split("?")[0];
		if (res.statusCode >= 500 && path != "/api/health") { console.error(`HTTP ${res.statusCode} ${req.method} ${path}`); }
	});
	next();
}


module.exports = { logServerErrors };
