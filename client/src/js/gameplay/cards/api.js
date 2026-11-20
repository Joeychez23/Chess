/*
 *  api.js  --  chess frontend
 *	Chess Cards Requests
 *	The card routes on the express server (server/routes/api/cardsRoutes.js, /api/chess/cards), like the chess ones in gameplay/validate/index.js & through its request():
 *	a 401 re-ups the session once, no answer is undefined, a 5xx body is marked serverError. A 409 is an answer: it carries the game as it is now (stale: true when another save landed first)
 *
 */

import { request } from "../validate/index.js";

/**
 * @description New card game vs Card Guy, the server picks the sides (POST /cards)
 * @param  {[string]} gameUrl [chess api, "/api/chess"]
 * @param  {[string]} startColor [the player's color: "alternate" | "random" | "w" | "b", Restart keeps it]
 * @param  {[number]} aiLevel [Card Guy's level, Restart keeps it too]
 * @param  {[boolean]} replaceCurrent [true forfeits the player's open AI or card game first (one at a time), left out = the server answers 409 while one is open]
 * @return {[object]} response [cardsResponse { status, game_id, mode, ai_level, you, view, legal, legal_hidden, events, card_guy_due, result } | { status: 409, game_id (the open one), message }]
 */
export async function newCardsGame(gameUrl, startColor, aiLevel, replaceCurrent) {
	const options = {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ start_color: startColor, ai_level: aiLevel, replace_current: replaceCurrent })
	};
	return request(`${gameUrl}/cards`, options);
}

/**
 * @description The card game as the player may see it (GET /cards/:gameId): loading the page, a reload mid-duel or mid-choice gets it exactly as it was
 * @return {[object]} response [cardsResponse | { status: 409, game_id, message } a game from an older version | { status, message }]
 */
export async function getCardsGame(gameUrl, gameId) {
	return request(`${gameUrl}/cards/${encodeURIComponent(gameId)}`, { method: "GET" });
}

/**
 * @description Plays one of the player's legal actions (POST /cards/:gameId/action)
 * @param  {[object]} action [one of the response's legal]
 * @return {[object]} response [cardsResponse with the action's events | { status: 409, ...cardsResponse, message } refused (stale: true when another save landed first) | { status: 400, message }]
 */
export async function sendAction(gameUrl, gameId, action) {
	const options = {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ action })
	};
	return request(`${gameUrl}/cards/${encodeURIComponent(gameId)}/action`, options);
}

/**
 * @description Card Guy plays one action it owes & it's saved (POST /cards/:gameId/card-guy). Owing nothing, it answers with the game as it is
 * @return {[object]} response [cardsResponse with the action's events, card_guy_due says whether to ask again]
 */
export async function cardGuyTurn(gameUrl, gameId) {
	return request(`${gameUrl}/cards/${encodeURIComponent(gameId)}/card-guy`, { method: "POST" });
}

/**
 * @description Who the Chess Cards opponent is (GET /cards/card-guy): only a name, no avatar, bio or lines
 * @return {[object]} response [{ name }]
 */
export async function getCardGuy(gameUrl) {
	return request(`${gameUrl}/cards/card-guy`, { method: "GET" });
}
