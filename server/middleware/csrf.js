/*
 *  csrf.js  --  chess server
 *	CSRF Check
 *	The session cookies are SameSite=Lax, which stops another site's form but not a same-site subdomain's. So every write to the api
 *	has to come from our own page: a POST, PUT, PATCH or DELETE from anywhere else gets 403 before its body is read or its session used.
 *	No token: our pages & the api share one origin, & every browser sends Origin on these methods
 *
 */

const config = require("../config");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * @description A request our own page sent: its Origin is the game's, & Sec-Fetch-Site (when the browser sends it) is same-origin.
 * Another site's link, redirect or form gets false (#297)
 */
function fromOurPage(req) {
	const site = req.get("Sec-Fetch-Site");
	return req.get("Origin") === new URL(config.clientUrl).origin && (!site || site === "same-origin");
}

/**
 * @description Refuses a write that didn't come from our own page (403). Reads pass: they change nothing & another site can't see the answer
 */
function requireOurPage(req, res, next) {
	if (SAFE_METHODS.has(req.method) || fromOurPage(req)) { return next(); }
	return res.status(403).json({ status: 403, message: "Forbidden" });
}

module.exports = { requireOurPage };
