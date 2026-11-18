/*
 *  serverError.js
 *	The last error handler (index.js & the test server mount it after every route): a bad request body or a refusal answers its 4xx, anything else is logged & answers 500
 *
 */

/**
 * @description Answers an error no route handled: 400 for a body that isn't JSON or fails validation, 413 for one too large, the error's own status below 500, otherwise 500 (logged, without the request body)
 * @param  {[object]} err [the error thrown or passed to next()]
 * @return {[object]} response [{ error }]
 */
function serverError(err, req, res, next) {
	if (res.headersSent) return next(err);
	if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Request body must be valid JSON." });
	if (err.type === "entity.too.large") return res.status(413).json({ error: "Request is too large." });
	if (err.name === "ValidationError") return res.status(400).json({ error: err.message });
	if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
	delete err.body; // A REQUEST BODY (A LOGIN'S PASSWORD) IS NEVER LOGGED, BAD JSON IS ANSWERED ABOVE WITHOUT LOGGING
	console.error(err);
	res.status(500).json({ error: "Something went wrong on our side." });
}

module.exports = { serverError };
