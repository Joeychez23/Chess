/*
 *  index.js  --  chess frontend
 *	Moves
 *	Loads the game from the server (setInitialData), sends the player's moves (validateMove) & finishes the AI's & a
 *	friend's once their slide lands (updateOpponentStateSlide). A friend's move arrives over the socket (the move event,
 *	checkOpponentMove). Both are in opponent.js.
 *	refreshData resets the board to a game from the server. The requests themselves are in gameplay/validate/index.js
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
// The game's shared state, the board that's drawn & the scratch board
const { game, chessInst, fillTiles } = require("../state/index.js");
const { validate } = require("../validate/index.js"); // Requests to the chess server (/api/chess)
const { playAi } = require("../ai/index.js");
const { setTiles, countStartPieces } = require("../utils/index.js");
const { showGameOver, syncDrawOffer } = require("../menu/offers.js");
const { showStatus, clearStatus, noAnswer, MESSAGE_TIME } = require("../status/index.js"); // The message area on the play page
const { showBot, sayLine } = require("../bots/say.js"); // The AI's bot beside the board
const { setMoves, addMove, showOpening } = require("../movelist/index.js"); // The move list panel & the opening under it
import { setLastOpponentMove, updateOpponentStateSlide } from "./opponent.js";

/* ---------------------------------------------------------------- */
// Set Initial Board Data
/* ---------------------------------------------------------------- */
/**
 * @description Sets initial data. Gets the game from the server & sets the player's color & the board.
 * Guests get a new AI game first if they don't have one. If it's the AI's turn its move is asked for here & slid in by
 * renderLoop()
 * @param  {[object]} loaded [the game when a takeback's answer already has it: a read right after the save could return the
 * old board. Left out = gets it from the server]
 * @return {[boolean]} false [the game couldn't be loaded]
 */
export async function setInitialData(loaded) {
	if (!loaded && game.PLAYER_ID === game.GAME_ID && game.PLAYER_ID && game.GAME_ID) { // A guest (a guest's player id is their game id)
		game.response = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, false);
		if (!game.response?.game_board) { // No game yet: a new game against the AI
			game.response = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, 'b');
		}
	}
	game.response = loaded || await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, false);
	game.playerColor = game.response?.player_color || null;
	if (!loaded) { game.viewColor = game.playerColor; } // A new game starts from the player's side, a takeback stays flipped
	game.flipPending = false;
	setMoves(game.response?.moves, game.response?.start_params?.fen); // A new game (restart & rematch) starts the list over
	showOpening(game.response?.opening);
	if (game.response?.status == 200) {
		game.opponentColor = game.response?.opponent_color || false;
		chessInst.load(game.response.game_board); // The board to draw
		// A set position can start with fewer pieces, the missing ones weren't taken
		game.startPieceCount = countStartPieces(game.response.start_params?.fen);
		setLastOpponentMove();
		syncDrawOffer(game.response);
		game.annotations = []; // A new game (restart & rematch) starts without the old one's marks & arrows
		game.hint = null; // & its hint
		// A new game or a restart, not a reload mid-game or a takeback
		const isNewGame = !loaded && game.response.state != "CLOSED" && !game.response.moves?.length;
		// Not awaited, the game doesn't wait for the levels
		showBot(game.GAME_URL, game.response).then(() => { if (isNewGame) { sayLine("start"); } });
		if (game.response.state == "CLOSED") { // The game is over (checkmate, draw or forfeit)
			game.ai = game.response.ai;
			showGameOver(game.response, true); // Already over when it loaded, the bot doesn't speak
			return;
		}

		// Note: conditionalize the back end to support determining the AI's color or a real opponent's color,
		// then conditionalize the board accordingly

		if (chessInst.turn() == game.playerColor) { // The board is locked on the opponent's turn
			game.opposingMove = false;
		} else {
			game.opposingMove = true;
		}
		if (game.response.ai) {
			game.ai = true;
			if (game.opponentColor == chessInst.turn()) { // Play the AI's move
				try {
					// The server picks & saves the AI's move (renderLoop asks again, gets the same move & slides it in)
					game.moveObj = await playAi(game.GAME_URL, game.GAME_ID);
				} catch (err) { // renderLoop keeps asking, the game still opens
					console.log(err);
					showStatus("ai", "The AI isn't answering. Trying again…");
				}
				game.tiles = await setTiles();
				game.aiTurn = true;
				game.refresh = true;
				return;
			}

		}
	} else {
		console.log(game.response?.message || "The game didn't load");
		showStatus("server", "The game couldn't be loaded. Reload the page to try again.");
		return false;
	}
}

/* ---------------------------------------------------------------- */
// Read-Only Board
/* ---------------------------------------------------------------- */
/**
 * @description Loads the game for a board that only shows it (a replay): the player's side at the bottom, the move list,
 * the opening & the bot, then the saved board with its facing & last move. The board stays locked, no move, AI or socket
 * request is made
 * @return {[boolean]} loaded [false: the game couldn't be loaded, the message area says so]
 */
export async function loadReadOnly() {
	game.response = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, false);
	if (game.response?.status != 200) {
		console.log(game.response?.message || "The game didn't load");
		showStatus("server", "The game couldn't be loaded. Reload the page to try again.");
		return false;
	}
	const response = game.response;
	game.playerColor = response.player_color;
	game.viewColor = response.player_color; // The player's side at the bottom, flip board still works
	game.opponentColor = response.opponent_color;
	game.ai = Boolean(response.ai);
	game.opposingMove = true; // Nothing can be picked up
	game.flipPending = false;
	// A set position can start with fewer pieces, the missing ones weren't taken
	game.startPieceCount = countStartPieces(response.start_params?.fen);
	game.gameOver = response.state == "CLOSED";
	game.result = game.gameOver ? { winner: response.winner, reason: response.reason } : null; // The 3D room's monitor shows it
	setMoves(response.moves, response.start_params?.fen);
	showOpening(response.opening);
	showBot(game.GAME_URL, response); // Not awaited, no line is said
	showPosition({
		fen: response.game_board,
		facing: facingLists(response),
		lastMove: response.prev_move?.length == 2 ? response.prev_move : null
	});
	return true;
}

/**
 * @description The facing lists of a game from the server (JSON strings) as arrays
 * @param  {[object]} response [game from the server]
 * @return {[object]} facing [{ w_knight, b_knight, w_piece, b_piece } arrays of { from, to }]
 */
function facingLists(response) {
	return {
		w_knight: JSON.parse(response.w_knight),
		b_knight: JSON.parse(response.b_knight),
		w_piece: JSON.parse(response.w_piece),
		b_piece: JSON.parse(response.b_piece)
	};
}

/**
 * @description Draws any position on the board (a replay's step): its board, which way each piece faces & the last
 * move's highlight. The 2D board reads the facing from game.response, the 3D board follows chessInst & the same lists
 * @param  {[object]} position [{ fen, facing: { w_knight, b_knight, w_piece, b_piece } arrays of { from, to },
 * lastMove: [from, to] or null }]
 */
export function showPosition({ fen, facing, lastMove }) {
	game.response = {
		...game.response,
		game_board: fen,
		w_knight: JSON.stringify(facing.w_knight),
		b_knight: JSON.stringify(facing.b_knight),
		w_piece: JSON.stringify(facing.w_piece),
		b_piece: JSON.stringify(facing.b_piece),
	};
	game.lastOpponentMove = lastMove || null; // The last move's highlight (2D & 3D), either side's on a read-only board
	game.annotations = [];
	game.hint = null;
	refreshData(game.response);
}

/* ---------------------------------------------------------------- */
// Check Opponent Move
/* ---------------------------------------------------------------- */
/* ---------------------------------------------------------------- */
// Slides
/* ---------------------------------------------------------------- */
/**
 * @description Starts the piece on one square sliding to another (the AI's & a friend's moves, the replay's steps both
 * ways). Any other slide stops. The render loop moves it (stepSlide) & landSlide() finishes it
 * @param  {[string]} from [the square the piece is on, "e2"]
 * @param  {[string]} to [where it slides, "e4"]
 */
export function startSlide(from, to) {
	fillTiles();
	for (let i = 0; i < game.tiles.length; i++) {
		const tile = game.tiles[i];
		if (tile.square == from) {
			game.slideStart = true;
			tile.isSliding = true;
			if (game.viewColor == 'w') { // The screen column & row of to (a8 is 0, 0)
				tile.xSlideTo = to.split("")[0].charCodeAt(0) - 96 - 1;
				tile.ySlideTo = 8 - to.split("")[1];
			} else if (game.viewColor == 'b') { // The flipped board (h1 is 0, 0)
				tile.xSlideTo = 8 - (to.split("")[0].charCodeAt(0) - 96);
				tile.ySlideTo = to.split("")[1] - 1;
			}
			tile.xDiff = 0; // Pixels moved so far
			tile.yDiff = 0;
			tile.slideStartTime = null; // Its clock starts on its first frame (stepSlide)
		} else if (tile.isSliding) { // Stop any other slide
			tile.isSliding = false;
			tile.xDiff = 0;
			tile.yDiff = 0;
		}
	}
	game.currSlide = true;
	game.refresh = true;
}

let readOnlyLanded = null; // The replay's landing (onReadOnlySlide)

/**
 * @description What finishes a slide on a read-only board (the replay's step), instead of sending or saving a move
 * @param  {[function]} handler [handler(index), index = the tile that slid]
 */
export function onReadOnlySlide(handler) {
	readOnlyLanded = handler;
}

/**
 * @description A slide landed (gameplay/draw): a read-only board's goes to its handler, the player's move is sent, the
 * opponent's is finished
 * @param  {[number]} index [tile that slid]
 */
export async function landSlide(index) {
	if (game.readOnly) { return readOnlyLanded?.(index); }
	if (game.tiles[index].color == game.playerColor) { return updateUserStateSlide(index); }
	if (game.tiles[index].color == game.opponentColor) { return updateOpponentStateSlide(index); }
}

/* ---------------------------------------------------------------- */
// On User Slide Complete
/* ---------------------------------------------------------------- */
/**
 * @description Updates data for user slide completion, starts ai slide if ai is active. A pawn reaching the last rank opens
 * the promotion picker instead (the move is sent once a piece is picked in handleCanvasClick), any other move is sent now
 * @param  {[number]} index [tile that slid]
 */
export async function updateUserStateSlide(index) {
	try {
		game.tiles[index].xSlideTo = 0;
		game.tiles[index].ySlideTo = 0;
		if (game.moveObj.promotion && !game.moveObj.typed) { // Open the promotion picker (a typed move already chose its piece)
			game.currPromotion = true;
			game.refresh = true;
			return;
		}

		await validateMove();
		game.tiles[index].isSliding = null;
	} catch (err) {
		console.log(err);
		game.currSlide = false;
		return refreshData(game.response);
	}
}

/* ---------------------------------------------------------------- */
// Move Sound
/* ---------------------------------------------------------------- */
/**
 * @description Plays the move sound, unless the player turned sound off in the menu
 */
export function playMoveSound() {
	if (!game.soundOn) { return; }
	game.moveAudio.load();
	game.moveAudio.play().catch((err) => { console.log(err) });
}

/* ---------------------------------------------------------------- */
// Validates User Move
/* ---------------------------------------------------------------- */
/**
 * @description Validates user move post slide or drag/drop then starts ai slide. Plays the move sound, moves the piece on
 * the local board, knight list & piece list, sends the move (PUT) & loads the server's board. AI games give the AI its
 * turn half a second later, friend games wait for the socket. A move the server turns down goes back to revert & the
 * player is told (moveFailed)
 */
export async function validateMove() {
	try {
		playMoveSound();
		game.revert = { ...game.response }; // Go back to this if the server says no (a copy: the lists below change response)
		game.opposingMove = true; // Lock the board
		const moveObj = game.moveObj;
		const playedMove = chessInst.move(moveObj); // The local board first so it draws right away (throws if it's not legal)
		game.annotations = []; // Any move clears the marks & arrows
		game.hint = null; // & the hint
		if (game.playerColor == 'w') { // Keep the local knight & piece lists in step until the server's come back
			for (let n = 0; n < JSON.parse(game.response.w_knight).length; n++) {
				if (moveObj.from == JSON.parse(game.response.w_knight)[n].to) {
					let w_knight = JSON.parse(game.response.w_knight)
					w_knight[n].from = moveObj.from;
					w_knight[n].to = moveObj.to;
					game.response.w_knight = JSON.stringify(w_knight);
					break;
				}
			}
			for (let n = 0; n < JSON.parse(game.response.w_piece).length; n++) { // Same for the kings, queens, bishops & rooks
				if (moveObj.from == JSON.parse(game.response.w_piece)[n].to) {
					let w_piece = JSON.parse(game.response.w_piece)
					// Moved up or down (sideways keeps its from)
					if (moveObj.from.split("")[1] != moveObj.to.split("")[1]) { w_piece[n].from = moveObj.from; }
					w_piece[n].to = moveObj.to;
					game.response.w_piece = JSON.stringify(w_piece);
					break;
				}
			}
			// !NOTE: the old rook square stays until the server's list comes back. The move lands halfway through drawing a
			// frame & the rest of that frame still draws the old board, so the rook would disappear for a frame if its square
			// was gone
			// Castling: the rook moves sideways too, its new square is added
			if (chessInst.get(moveObj.to).type == 'k' && moveObj.from == 'e1' && (moveObj.to == 'g1' || moveObj.to == 'c1')) {
				for (let n = 0; n < JSON.parse(game.response.w_piece).length; n++) {
					let w_piece = JSON.parse(game.response.w_piece)
					if (moveObj.to == 'g1' && w_piece[n].to == 'h1') { // King side
						w_piece[w_piece.length] = { from: w_piece[n].from, to: 'f1' };
						game.response.w_piece = JSON.stringify(w_piece);
						break;
					}
					else if (moveObj.to == 'c1' && w_piece[n].to == 'a1') { // Queen side
						w_piece[w_piece.length] = { from: w_piece[n].from, to: 'd1' };
						game.response.w_piece = JSON.stringify(w_piece);
						break;
					}
				}
			}
			// Promoted to a queen, bishop or rook: added so it draws before the server's list comes back
			if (moveObj.promotion && moveObj.promotion != 'n') {
				let w_piece = JSON.parse(game.response.w_piece)
				w_piece[w_piece.length] = { from: moveObj.from, to: moveObj.to };
				game.response.w_piece = JSON.stringify(w_piece);
			}
		} else if (game.playerColor == 'b') {
			for (let n = 0; n < JSON.parse(game.response.b_knight).length; n++) {
				if (moveObj.from == JSON.parse(game.response.b_knight)[n].to) {
					let b_knight = JSON.parse(game.response.b_knight)
					b_knight[n].from = moveObj.from;
					b_knight[n].to = moveObj.to;
					game.response.b_knight = JSON.stringify(b_knight);
					break;
				}
			}
			for (let n = 0; n < JSON.parse(game.response.b_piece).length; n++) { // Same for the kings, queens, bishops & rooks
				if (moveObj.from == JSON.parse(game.response.b_piece)[n].to) {
					let b_piece = JSON.parse(game.response.b_piece)
					// Moved up or down (sideways keeps its from)
					if (moveObj.from.split("")[1] != moveObj.to.split("")[1]) { b_piece[n].from = moveObj.from; }
					b_piece[n].to = moveObj.to;
					game.response.b_piece = JSON.stringify(b_piece);
					break;
				}
			}
			// Castling: the rook moves sideways too, its new square is added
			if (chessInst.get(moveObj.to).type == 'k' && moveObj.from == 'e8' && (moveObj.to == 'g8' || moveObj.to == 'c8')) {
				for (let n = 0; n < JSON.parse(game.response.b_piece).length; n++) {
					let b_piece = JSON.parse(game.response.b_piece)
					if (moveObj.to == 'g8' && b_piece[n].to == 'h8') { // King side
						b_piece[b_piece.length] = { from: b_piece[n].from, to: 'f8' };
						game.response.b_piece = JSON.stringify(b_piece);
						break;
					}
					else if (moveObj.to == 'c8' && b_piece[n].to == 'a8') { // Queen side
						b_piece[b_piece.length] = { from: b_piece[n].from, to: 'd8' };
						game.response.b_piece = JSON.stringify(b_piece);
						break;
					}
				}
			}
			// Promoted to a queen, bishop or rook: added so it draws before the server's list comes back
			if (moveObj.promotion && moveObj.promotion != 'n') {
				let b_piece = JSON.parse(game.response.b_piece)
				b_piece[b_piece.length] = { from: moveObj.from, to: moveObj.to };
				game.response.b_piece = JSON.stringify(b_piece);
			}
		}


		let moveResponse;
		game.moveSaving = true; // game.response still has the old board, flip board waits (handleFlip)
		try { // The server checks & saves the move (PUT)
			moveResponse = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, [moveObj.from, moveObj.to], moveObj.promotion, false);
		} finally { // The next frame does a flip that waited (flipWhenDone)
			game.moveSaving = false;
			game.refresh = true;
		}
		if (moveResponse?.status != 200) { return moveFailed(moveResponse); } // Turned down or no answer: back to the old board

		chessInst.load(moveResponse.game_board); // The server's board
		game.response = moveResponse;
		syncDrawOffer(moveResponse); // This move ended any offer
		addMove(playedMove.san); // Only now: the server could have turned it down
		showOpening(game.response.opening);
		clearStatus("move");
		clearStatus("server");

		game.currSlide = false;
		if (game.response.state == "CLOSED") { // Checkmate or draw
			showGameOver(game.response);
			return;
		}

		if (game.ai) {
			game.tiles = await setTiles();
			game.refresh = true;
			game.aiTimer = setTimeout(function () { // The AI moves half a second later (renderLoop)
				game.aiTurn = true;
				game.refresh = true;
			}, 500);
			return;
		}
		else { return refreshData(game.response); } // A friend game: the socket says when they move
	} catch (err) {
		console.log(err);
		game.opposingMove = false;
		game.mousedownTile = false;
		game.clickedTile = false;
		return refreshData(game.revert);
	}
}

/**
 * @description The server turned a move down or didn't answer: says so & goes back to the board from before the move,
 * ready for the next try
 * @param  {[object]} response [from validate/index.js]
 * @return {[object]} the old game
 */
function moveFailed(response) {
	console.log(response?.message || "Move failed: no answer from the server");
	if (noAnswer(response)) { // Stays until a request works
		showStatus("server", "The server isn't answering. The board was reset, try your move again.");
	}
	else { showStatus("move", "That move wasn't accepted. The board was reset.", MESSAGE_TIME); }
	game.response = game.revert; // The failed answer has no board
	game.opposingMove = false;
	game.mousedownTile = false;
	game.clickedTile = false;
	return refreshData(game.revert);
}

/* ---------------------------------------------------------------- */
// Refresh Game Data
/* ---------------------------------------------------------------- */
/**
 * @description Refreshes data based on passed in response. Loads its board, clears every tile (selection, drag, slide),
 * closes the promotion picker & draws the next frame. The menu stays as it is, moves still land while it's open
 * @param  {[object]} response [game from the server]
 * @return {[object]} response
 */
export function refreshData(response) {
	try {
		chessInst.load(response.game_board);
		game.tiles = setTiles(); // A new tile array, the old one is dropped
		game.clickedTile = false;
		game.mousedownTile = false;
		game.currPromotion = false;
		game.currSlide = false;
		game.slideStart = false;
		game.refresh = true;
		game.availableMovesData = { piece: null, square: null }

		return response;
	} catch (err) {
		console.log(err);
		game.tiles = setTiles();
		game.refresh = true;
		return response;
	}
}

/* ---------------------------------------------------------------- */
// Revert Unfinished Move
/* ---------------------------------------------------------------- */
/**
 * @description The menu is opening: a move that isn't finished goes back to the last server board. That's a picked up or
 * dragged piece, an open promotion picker or the player's pawn sliding to the last rank (no piece is chosen yet). In a
 * Chess Cards game the card being played goes down.
 * Any other slide of the player's lands & is sent, the click committed it. A move already sent & the opponent's slides stay.
 * !NOTE: opposingMove is also true during the player's own slide, so the sliding piece's color says whose slide it is
 */
export function revertUnfinishedMove() {
	if (game.readOnly) { return; } // Nothing of the player's is unfinished, a replay's slide lands as it is
	// A Chess Cards game: the card being played goes down (& its promotion cards go back).
	// Required here, not at the top: flow.js reaches the menu, which requires this file
	if (game.cardGame) { return require("../cards/flow.js").putDown(); }
	// The turn check: a dropped promotion keeps clickedTile after it's sent
	const heldPiece = !game.opposingMove && (game.clickedTile || game.mousedownTile);
	const promotionSlide = game.currSlide && game.moveObj.promotion && !game.moveObj.typed
		&& game.tiles.some(function (tile) { return tile.isSliding && tile.color == game.playerColor; });
	if (!heldPiece && !game.currPromotion && !promotionSlide) { return; }
	game.opposingMove = false; // Still the player's turn
	refreshData(game.response);
}
