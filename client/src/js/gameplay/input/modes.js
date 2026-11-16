/*
 *  modes.js  --  chess frontend
 *	Input Modes
 *	Which of the game's listeners startGame (gameplay/index.js) puts on: a live game with the mouse & touch, remote-only mode (a TV's arrow keys
 *	& Enter) or the read-only board (a replay, #100) that never picks up a piece or sends a move. No page state, the server tests run it
 *
 */

/**
 * @description The listener groups for an input mode. Sound, Flip Board, View, Reset View, Home, Settings & Exit are always on
 * @param  {[object]} mode [{ readOnly, remoteOnly, override }: override = OVERRIDE_REMOTE_ONLY, remote-only mode & the mouse together (testing)]
 * @return {[object]} groups [{ pointer: the board's click, mouse, right-click & touch, remoteKeys: remote-only mode's keys (handleKeyPress),
 * menu: the menu button, a click away & Escape, prompts: a takeback's & a draw offer's Accept & Decline, gameActions: Hint, Eval Bar,
 * Takeback, Offer Draw, Restart & Cancel Rematch, moveBox: the typed move box, moveList: the move list's toggle & keys, pgn: Download PGN }]
 */
function listenersFor({ readOnly, remoteOnly, override }) {
	const mouse = !remoteOnly || Boolean(override);
	if (readOnly) { // NOTHING ON THE BOARD TAKES INPUT, A REMOTE-ONLY DEVICE STILL GETS THE MENU (BUT STILL HAS NOWHERE TO SAVE A PGN)
		return { pointer: false, remoteKeys: false, menu: true, prompts: false, gameActions: false, moveBox: false, moveList: true, pgn: mouse };
	}
	return { pointer: mouse, remoteKeys: Boolean(remoteOnly || override), menu: mouse, prompts: mouse, gameActions: true, moveBox: true, moveList: mouse, pgn: mouse };
}


module.exports = { listenersFor };
