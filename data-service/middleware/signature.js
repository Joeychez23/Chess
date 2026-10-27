/*
 *  signature.js  --  data service
 *	Signed Requests Only
 *  Every request but /health must come signed from the chess server (utils/signature.js): the signature matches the method, path, body,
 *  time & request id, the time is within 30 seconds of now, and the request id hasn't been seen in that time (a replayed request).
 *  Anything else is refused with a 401, before the player or the body is looked at
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const config = require("../config");
const { signatureMatches, HEADERS } = require("../utils/signature.js");
const { refuse } = require("../utils/refuse.js");

const MAX_AGE = 30 * 1000; // A REQUEST FROM FURTHER AWAY THAN THIS (EITHER WAY, FOR CLOCK DRIFT) IS REFUSED
const REQUEST_ID = /^[A-Za-z0-9_-]{16,64}$/; // signedHeaders() SENDS 22 CHARACTERS (16 RANDOM BYTES)
const TIMESTAMP = /^\d{1,15}$/; // EPOCH MILLISECONDS

const seen = new Map(); // REQUEST ID -> WHEN IT CAN BE FORGOTTEN (EPOCH MS): BY THEN ITS TIMESTAMP IS TOO OLD TO BE ACCEPTED AGAIN

/* ---------------------------------------------------------------- */
// Check Signature
/* ---------------------------------------------------------------- */
/**
 * @description Refuses a request (401) that isn't signed with DATA_SERVICE_SECRET (or DATA_SERVICE_SECRET_OLD while it's being changed),
 * is more than 30 seconds from now, or has a request id seen in the last 30 seconds. Runs after express.json, which keeps the body as sent (req.rawBody)
 */
function checkSignature(req, res, next) {
	const timestamp = req.get(HEADERS.timestamp);
	const requestId = req.get(HEADERS.requestId);
	const signature = req.get(HEADERS.signature);
	if (!timestamp || !requestId || !signature) { return refuse(req, res, 401, "Unsigned request"); }
	if (!TIMESTAMP.test(timestamp) || !REQUEST_ID.test(requestId)) { return refuse(req, res, 401, "Bad signature headers"); }

	const request = { method: req.method, path: req.originalUrl, timestamp, requestId, body: req.rawBody || "" };
	if (!signatureMatches([config.dataServiceSecret, config.dataServiceSecretOld], request, signature)) { return refuse(req, res, 401, "Bad signature"); }

	const now = Date.now();
	if (Math.abs(now - Number(timestamp)) > MAX_AGE) { return refuse(req, res, 401, "Request too old"); }
	forgetOld(now);
	if (seen.has(requestId)) { return refuse(req, res, 401, "Replayed request"); }
	seen.set(requestId, Number(timestamp) + MAX_AGE);
	next();
}

/**
 * @description Drops the request ids whose time is past MAX_AGE, a request carrying one would be refused as too old anyway
 * @param  {[number]} now [epoch ms]
 */
function forgetOld(now) {
	for (const [requestId, until] of seen) {
		if (until < now) { seen.delete(requestId); }
	}
}

/**
 * @description Keeps the body exactly as sent, the signature covers those bytes (express.json's verify option)
 */
function keepRawBody(req, res, buffer) {
	req.rawBody = buffer.toString("utf8");
}


module.exports = { checkSignature, keepRawBody };
