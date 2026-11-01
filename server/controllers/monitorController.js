/*
 *  monitorController.js  --  chess server
 *	Monitoring (#194)
 *  GET /api/health for the uptime check & POST /api/client-errors for the errors browsers report (client/src/js/pages/utils/reportErrors.js)
 *
 */

const { checkHealth } = require("../utils/health.js");

const KINDS = ["error", "rejection", "request"];
const text = (value, max) => typeof value == "string" ? value.slice(0, max) : undefined;
const count = (value) => Number.isInteger(value) && value >= 0 ? value : undefined;

/**
 * @description 200 when DynamoDB & the engine work, otherwise 503 (the uptime check only reads the status). Says which is down, never why
 */
async function getHealth(req, res) {
	const { ok, checks } = await checkHealth();
	res.set("Cache-Control", "no-store");
	return res.status(ok ? 200 : 503).json({ status: ok ? 200 : 503, checks });
}

/**
 * @description Logs a browser's error report as one line. Anyone can send one, so only these fields are kept, cut short, and
 * JSON.stringify escapes line breaks: a report can't add a line of its own to the log, or start one that an alarm matches
 */
function reportClientError(req, res) {
	const { kind, page, source, line, column, status, message } = req.body || {};
	if (!KINDS.includes(kind) || typeof message != "string") { return res.status(400).json({ status: 400, message: "Bad error report" }); }
	console.error(`CLIENT ERROR ${JSON.stringify({
		kind,
		message: text(message, 500),
		page: text(page, 200),
		source: text(source, 200),
		line: count(line),
		column: count(column),
		status: count(status),
		browser: text(req.get("User-Agent"), 200)
	})}`);
	return res.status(204).end();
}


module.exports = { getHealth, reportClientError };
