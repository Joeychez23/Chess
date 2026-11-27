/*
 *  store.js  --  chess frontend
 *	Chess Cards Store
 *	The card game as the card routes (server/controllers/cardsController.js) last told it: the player's view, their legal actions, their side, the result
 *	& whether Card Guy owes an action. The server decides everything, this only keeps its answer. No DOM, the server tests require it (server/test/cards/cards-clientSelect.test.js)
 *
 */

const cards = { view: null, legal: [], you: null, result: null, cardGuyDue: false, hidden: false, catalog: {} }; // THE SAME OBJECT ALL GAME, flow.js & THE TABLE READ IT. hidden: CARD GUY'S FOG OF WAR KEEPS THE MOVES OUT OF legal, catalog: THE CARD FACES (cardsResponse)

/**
 * @description Keeps a card route's answer as the game now is & hands back its events to show. A stale 409 carries the fresh game (stale: true), so it replaces
 * everything the same way & has no events. An answer with no view in it (a 400, the older version 409, a server error, no answer) changes nothing
 * @param  {[object]} r [cardsResponse: { view, legal, you, result, card_guy_due, legal_hidden, catalog, events, ... }]
 * @return {[array]} events [the action's events to show, [] when there are none]
 */
function takeResponse(r) {
	if (!r?.view) { return []; }
	Object.assign(cards, { view: r.view, legal: r.legal || [], you: r.you, result: r.result || null, cardGuyDue: Boolean(r.card_guy_due), hidden: Boolean(r.legal_hidden), catalog: r.catalog || {} });
	return r.events || [];
}

module.exports = { cards, takeResponse };
