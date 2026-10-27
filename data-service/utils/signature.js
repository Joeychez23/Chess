/*
 *  signature.js  --  chess server & data service
 *	Signed Requests
 *  Only the chess server can call the data service: it signs each request with DATA_SERVICE_SECRET (HMAC-SHA256 over the method,
 *  the path with its query, the time, a request id & the body), and the data service checks it (middleware/signature.js).
 *  server/utils/signature.js & data-service/utils/signature.js are the same file, data-service/test/shared.test.js fails when they differ
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const crypto = require("crypto");

const HEADERS = { timestamp: "X-Data-Timestamp", requestId: "X-Data-Request-Id", signature: "X-Data-Signature" };

/* ---------------------------------------------------------------- */
// Sign
/* ---------------------------------------------------------------- */
/**
 * @description The signature of one request
 * @param  {[string]} secret [DATA_SERVICE_SECRET]
 * @param  {[object]} request [{ method ("GET", "POST"), path (with the query string, e.g. "/games/game1?consistent=true"), timestamp (epoch ms, as sent),
 * requestId, body (the exact JSON text sent, "" for none) }]
 * @return {[string]} signature [base64url]
 */
function sign(secret, request) {
	const text = [request.method.toUpperCase(), request.path, request.timestamp, request.requestId, request.body || ""].join("\n");
	return crypto.createHmac("sha256", secret).update(text).digest("base64url");
}

/**
 * @description The headers a request carries when the chess server signs it: the time now, a new request id & the signature
 * @param  {[string]} secret [DATA_SERVICE_SECRET]
 * @param  {[string]} method ["GET" or "POST"]
 * @param  {[string]} path [with the query string]
 * @param  {[string]} body [the exact JSON text sent, "" for none]
 * @return {[object]} headers [{ "X-Data-Timestamp", "X-Data-Request-Id", "X-Data-Signature" }]
 */
function signedHeaders(secret, method, path, body) {
	const timestamp = `${Date.now()}`;
	const requestId = crypto.randomBytes(16).toString("base64url");
	return { [HEADERS.timestamp]: timestamp, [HEADERS.requestId]: requestId, [HEADERS.signature]: sign(secret, { method, path, timestamp, requestId, body }) };
}

/* ---------------------------------------------------------------- */
// Check
/* ---------------------------------------------------------------- */
/**
 * @description True when the signature is this request's under one of the secrets (the current one, & the old one while it's being changed)
 * @param  {[array]} secrets [DATA_SERVICE_SECRET, DATA_SERVICE_SECRET_OLD (null when there's none)]
 * @param  {[object]} request [as in sign()]
 * @param  {[string]} signature [the X-Data-Signature header]
 * @return {[boolean]} matches
 */
function signatureMatches(secrets, request, signature) {
	const given = Buffer.from(signature || "");
	return secrets.filter(Boolean).some((secret) => {
		const expected = Buffer.from(sign(secret, request));
		return given.length == expected.length && crypto.timingSafeEqual(given, expected); // TAKES THE SAME TIME HOWEVER MUCH OF IT MATCHES
	});
}


module.exports = { sign, signedHeaders, signatureMatches, HEADERS };
