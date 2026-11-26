/*
 *  cards.state.js  --  chess frontend
 *	Chess Cards Shared State
 *	The pick state flow.js, cards.prompts.js and cards.drag.js all read or write (state), and the flow.js functions the two
 *	sub-files call back (calls, filled once by flow.js at load). It loads nothing from cards/, so no cycle runs through it
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
export const state = {
	sel: null, // the play being picked (select.js lift / pickPiece / pick), null for none
	squareFocus: null, // the keyboard's square, its index in the squares that glow
	keyboard: false, // the last pick came from the keys, so a prompt takes the focus (not one that Card Guy's answer raised)
	lastPlayed: null, // the last card-played event's card: the frame of the choice it asks for
	lastTaken: null, // the last card-taken event's card taken from the player: names Pickpocket's take-back (select.js label)
	confirm: null, // a King move that spends a King skull, waiting on the prompt's Play
	dragFrom: null, // the square the mouse pressed a piece on (pressSquare): a release only plays that piece's pick
	// The square of a dragged piece left over its target (releaseSquare), until its play is answered or given up (settle)
	dropped: null,
	// The last pick was the mouse's. It plays by dragging, so its prompt has no discard, place or play button, and a clicked active or
	// passive is only zoomed in on to be read. The keys and a tap play as before
	byMouse: false,
	// The card the mouse dragged to one of the player's places (dropCard), lying there while its targets are picked or its play is on
	// its way. The table keeps it there while it's the lifted card
	onPlace: null,
	// The ability card a click or tap picked last (select.js handRead): never lifted, no readable copy. The keys' pick and the drop's
	// target pick lift as before (select.js liftedCard)
	readCard: null,
	// A move's promotions while the room's promotion cards are out (game.currPromotion); the one picked sends its play (promote)
	promoting: null,
	promptStart: null, // the prompt's button the keys focus (select.js promptFocus), null while it's hidden
	showing: 0, // answers whose steps aren't all shown yet: nothing is picked meanwhile (yourMove)
};

// flow.js's functions the sub-files call back: cancelPick, endZoom, refreshTable, send, yourMove (flow.js fills it at load)
export const calls = {};
