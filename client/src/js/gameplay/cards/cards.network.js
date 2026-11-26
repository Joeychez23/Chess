/*
 *  cards.network.js  --  chess frontend
 *	Chess Cards Network
 *	What flow.js does with a card route's answer that carries no view: a final refusal stops with its message (a game from an
 *	older version offers its forfeit), and an action whose answer was lost reads the game again so the game goes on from it
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game } = require("../state/index.js");
const { cards } = require("./store.js");
const { getCardsGame } = require("./api.js");
const { showStatus, MESSAGE_TIME } = require("../status/index.js");
const { forfeitGame } = require("../validate/index.js");

/* ---------------------------------------------------------------- */
// Refusals
/* ---------------------------------------------------------------- */
/**
 * @description An answer with no view that asking again would only repeat: a game from an older version (409 with its game_id)
 * offers its forfeit, as startCards does; a game gone or not theirs (404, 403, a 409 without game_id) says it couldn't be loaded.
 * A 401 is still signed out after the request's own session re-up. In Card Guy's loop a 400 is final too; an action's 400 is
 * one bad play, not the game. No answer, a 5xx or anything else is not final: the caller tries again
 * @param  {[object|undefined]} response [a card route's answer without a view]
 * @param  {[element|null]} promptBox [#cardPrompt, where the forfeit is offered]
 * @param  {[boolean]} loop [asked from Card Guy's loop]
 * @return {[boolean]} final [true: the message is shown, stop asking]
 */
function refused(response, promptBox, loop = false) {
	if (![401, 403, 404, 409, ...(loop ? [400] : [])].includes(response?.status)) { return false; }
	if (response.status === 409 && response.game_id) {
		offerForfeit(promptBox, response.game_id);
		return true;
	}
	showStatus("server", "The game couldn't be loaded. Reload the page to try again.");
	return true;
}

/**
 * @description A game saved by an older engine version can't go on: the message says so and the prompt offers to forfeit it
 * (the forfeit route), then Home
 * @param  {[element|null]} promptBox [#cardPrompt]
 * @param  {[string]} gameId
 */
function offerForfeit(promptBox, gameId) {
	showStatus("server", "This Chess Cards game is from an older version and can't go on.");
	if (!promptBox) { return; }
	const title = document.createElement("p");
	const forfeit = document.createElement("button");
	title.textContent = "Older version";
	forfeit.type = "button";
	forfeit.textContent = "Forfeit it & go Home";
	forfeit.addEventListener("click", async function () {
		forfeit.disabled = true;
		const done = await forfeitGame(game.GAME_URL, gameId);
		if (done?.status === 200) {
			window.location.assign("/");
			return;
		}
		forfeit.disabled = false;
		showStatus("action", "The forfeit didn't go through. Try again.", MESSAGE_TIME);
	});
	promptBox.replaceChildren(title, forfeit);
	promptBox.hidden = false;
}

/* ---------------------------------------------------------------- */
// Lost answers
/* ---------------------------------------------------------------- */
/**
 * @description An action's answer was lost, but the server may have saved the play first: the game is read again as it is now
 * (read only), so a Card Guy turn that is owed is still asked for. The player is told it didn't go through only when the game
 * didn't move on; when it did, the play was saved and only its answer was lost
 * @return {[object|undefined]} response [the game as it is now, without a view when that read failed too]
 */
async function readAfterLostAnswer() {
	const was = JSON.stringify(cards.view);
	const response = await getCardsGame(game.GAME_URL, game.GAME_ID);
	if (!response?.view || JSON.stringify(response.view) === was) {
		showStatus("action", "That didn't go through. Try again.", MESSAGE_TIME);
	}
	return response;
}

module.exports = { refused, offerForfeit, readAfterLostAnswer };
