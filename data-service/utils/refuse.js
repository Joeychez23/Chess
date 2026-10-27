/*
 *  refuse.js  --  data service
 *	Refused Requests
 *  Every check that turns a request away answers through refuse(), so each one is a single log line (journalctl -u data-service | grep REFUSED).
 *  The line says which route & why, never the body, the player's token or a guest's cookie
 *
 */

/* ---------------------------------------------------------------- */
// Refuse
/* ---------------------------------------------------------------- */
/**
 * @description Answers a refused request with its HTTP status & logs it. A request the data service handles answers 200 with
 * dynamoDB.js's { status, game_data, message } (even "Game data not found"), so the 4xx here are only the refusals
 * @param  {[object]} req [express request, the path has the game id]
 * @param  {[object]} res [express response]
 * @param  {[number]} status [400 (bad body), 401 (no player or a bad token), 403 (not their game), 409 (not now: game over, not their turn, ...)]
 * @param  {[string]} reason [why, also the response's message]
 */
function refuse(req, res, status, reason) {
	console.log(`REFUSED ${req.method} ${req.baseUrl}${req.path} ${status} ${reason}`); // baseUrl: /games INSIDE THE GAME ROUTES, NO QUERY STRING
	return res.status(status).json({ status, message: reason });
}


module.exports = { refuse };
