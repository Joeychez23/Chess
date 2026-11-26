/*
 *  renderer.state.js  --  chess frontend
 *	Renderer: what the renderer's files share. state holds the values more than one of them reads or writes; calls holds the
 *	functions a file calls in another that it can't load without a cycle (index.js fills it once at load).
 *	It loads nothing from renderer/.
 *
 */

export const state = {
	board3D: null, // The 3D module while it's mounted, null on 2D
	container: null, // What the 3D canvas fills, in #main next to the (hidden) 2D canvas
	shownFen: null, // The position the 3D board shows (or is sliding to)
	skipAnimation: false, // The next position is set at once (skipNextAnimation3D: a replay's jump)
	shownFacings: null, // The position and piece facings the 3D board was last turned to (syncFacing3D)
	shownTaken: null, // What the 3D board's piles were last set from (syncTaken3D), so they're only redone when it changes
	shownMarks: null, // The highlights the 3D board shows (marks3D() as JSON), so they're only redone when they change
	shownScreen: null, // What the 3D room's monitor was last told to show (screen3D() as JSON)
	cardPick: null, // What a picked promotion card calls (onCardPick): gameplay/input's choosePromotion
	shownPromotion: null, // The colour the 3D cards were last dealt for, null when they're on the deck (syncCards3D)
	shownCardFocus: null, // The card the 3D board frames (game.cardFocus)
	tablePick: null, // What a Chess Cards game's picked hand card or square, and its mouse press and release, call (onTablePick)
	tableHeld: null, // The piece a Chess Cards game's drag holds, { square, dragging } (holdTablePiece3D), null for none
	table: null, // The Chess Cards table as setTable3D last said it, put on every 3D board mounted later
	// game.viewColor when flow.js was last told of the 3D table (tableUp). Flip Board turns the room, so a prompt's plaques by a
	// square are laid again
	tableSide: null,
	tableDuel: null, // The card duel the table was last dealt (dealDuel3D), dealt on every 3D board mounted later, null for none
	heldFace: null, // The face the monitor holds (a result's), put back on a 3D board mounted later
	monitorHooks: null, // gameplay/monitor's { handlers, announce, onChange, data } (setMonitorHooks), given to every 3D board
	shownMonitor: null, // What the monitor's channels were last sent (monitorHooks.data() as JSON)
};

export const calls = {}; // { syncTaken3D (renderer.draw.js), currentView (index.js) }, filled by index.js
