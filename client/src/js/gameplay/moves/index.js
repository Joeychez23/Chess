/*
 *  index.js  --  chess frontend
 *	Moves
 *	Loads the game from the server (setInitialData), sends the player's moves (validateMove) & finishes the AI's & a friend's
 *	once their slide lands (updateOpponentStateSlide). A friend's move arrives over the socket (the move event, checkOpponentMove). Both are in opponent.js.
 *	refreshData resets the board to a game from the server. The requests themselves are in gameplay/validate/index.js
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, chessInst, fillTiles } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE BOARD THAT'S DRAWN, THE SCRATCH BOARD
const { validate } = require("../validate/index.js"); // REQUESTS TO THE CHESS SERVER (/api/chess)
const { playAi } = require("../ai/index.js"); // ASKS THE SERVER FOR THE AI'S MOVE
const { setTiles, countStartPieces } = require("../utils/index.js"); // NEW ARRAY OF 64 BLANK TILE STATES, HOW MANY PIECES EACH SIDE STARTED WITH, A SIDE'S LAST MOVE
const { showGameOver, syncDrawOffer } = require("../menu/index.js"); // THE GAME OVER SCREEN (CHECKMATE, DRAW OR FORFEIT), THE DRAW OFFER'S BUTTONS
const { showStatus, clearStatus, noAnswer, MESSAGE_TIME } = require("../status/index.js"); // THE MESSAGE AREA ON THE PLAY PAGE
const { showBot, sayLine } = require("../bots/say.js"); // THE AI'S BOT BESIDE THE BOARD (#76)
const { faceFor } = require("../bots/index.js"); // THE FACE THE 3D ROOM'S MONITOR MAKES AT A MOVE
const { setFace } = require("../renderer/index.js"); // & SHOWS IT (3D ONLY)
const { setMoves, addMove, showOpening } = require("../movelist/index.js"); // THE MOVE LIST PANEL & THE OPENING UNDER IT
import { setLastOpponentMove, updateOpponentStateSlide } from "./opponent.js";

/* ---------------------------------------------------------------- */
// Set Initial Board Data
/* ---------------------------------------------------------------- */
/**
 * @description Sets initial data. Gets the game from the server & sets the player's color & the board.
 * Guests get a new AI game first if they don't have one. If it's the AI's turn its move is asked for here & slid in by renderLoop()
 * @param  {[object]} loaded [the game when a takeback's answer already has it: a read right after the save could return the old board. Left out = gets it from the server]
 * @return {[boolean]} false [the game couldn't be loaded]
 */
export async function setInitialData(loaded) {
	if (!loaded && game.PLAYER_ID === game.GAME_ID && game.PLAYER_ID && game.GAME_ID) { // GUEST (A GUEST'S PLAYER ID IS THEIR GAME ID)
		game.response = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, false);
		if (!game.response?.game_board) { game.response = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, 'b'); } // NO GAME YET: NEW GAME VS THE AI
	}
	game.response = loaded || await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, false); // GET THE GAME
	game.playerColor = game.response?.player_color || null;
	if (!loaded) { game.viewColor = game.playerColor; } // A NEW GAME STARTS FROM THE PLAYER'S SIDE, A TAKEBACK STAYS FLIPPED
	game.flipPending = false;
	setMoves(game.response?.moves, game.response?.start_params?.fen); // A NEW GAME (RESTART & REMATCH) STARTS THE LIST OVER
	showOpening(game.response?.opening);
	if (game.response?.status == 200) { // IF GAME IS ON AI TURN, PLAY TURN
		game.opponentColor = game.response?.opponent_color || false;
		chessInst.load(game.response.game_board); // THE BOARD TO DRAW
		game.startPieceCount = countStartPieces(game.response.start_params?.fen); // A SET POSITION CAN START WITH FEWER PIECES, THE MISSING ONES WEREN'T TAKEN
		setLastOpponentMove();
		syncDrawOffer(game.response);
		game.annotations = []; // A NEW GAME (RESTART & REMATCH) STARTS WITHOUT THE OLD ONE'S MARKS & ARROWS
		game.hint = null; // & ITS HINT
		const isNewGame = !loaded && game.response.state != "CLOSED" && !game.response.moves?.length; // A NEW GAME OR RESTART, NOT A RELOAD MID-GAME OR A TAKEBACK
		showBot(game.GAME_URL, game.response).then(() => { if (isNewGame) { sayLine("start"); } }); // NOT AWAITED, THE GAME DOESN'T WAIT FOR THE LEVELS
		if (isNewGame) { setFace("neutral"); } // THE MONITOR'S FACE STARTS OVER WITH THE GAME
		if (game.response.state == "CLOSED") { // GAME IS OVER (CHECKMATE, DRAW OR FORFEIT)
			game.ai = game.response.ai;
			showGameOver(game.response, true); // ALREADY OVER WHEN IT LOADED, THE BOT DOESN'T SPEAK
			return;
		}

		// NOTE : CONDITONALIZE BACK END TO SUPPORT DETIRMINING AI COLOR OR REAL OPPONENT COLOR
		// THEN : CONDITIONALIZE BOARD ACCORDINGLY

		if (chessInst.turn() == game.playerColor) { game.opposingMove = false; } else { game.opposingMove = true; } // LOCK THE BOARD ON THE OPPONENT'S TURN
		if (game.response.ai) {
			game.ai = true;
			if (game.opponentColor == chessInst.turn()) { //PLAY AI MOVE
				try {
					game.moveObj = await playAi(game.GAME_URL, game.GAME_ID); // THE SERVER PICKS & SAVES THE AI MOVE (renderLoop ASKS AGAIN, GETS THE SAME MOVE & SLIDES IT IN)
				} catch (err) { // renderLoop KEEPS ASKING, THE GAME STILL OPENS
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
 * @description Loads the game for a board that only shows it (a replay, #100): the player's side at the bottom, the move list, the
 * opening & the bot, then the saved board with its facing & last move. The board stays locked, no move, AI or socket request is made
 * @return {[boolean]} loaded [false: the game couldn't be loaded, the message area says so]
 */
export async function loadReadOnly() {
	game.response = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, false); // GET THE GAME
	if (game.response?.status != 200) {
		console.log(game.response?.message || "The game didn't load");
		showStatus("server", "The game couldn't be loaded. Reload the page to try again.");
		return false;
	}
	const response = game.response;
	game.playerColor = response.player_color;
	game.viewColor = response.player_color; // THE PLAYER'S SIDE AT THE BOTTOM, FLIP BOARD STILL WORKS
	game.opponentColor = response.opponent_color;
	game.ai = Boolean(response.ai);
	game.opposingMove = true; // NOTHING CAN BE PICKED UP
	game.flipPending = false;
	game.startPieceCount = countStartPieces(response.start_params?.fen); // A SET POSITION CAN START WITH FEWER PIECES, THE MISSING ONES WEREN'T TAKEN
	game.gameOver = response.state == "CLOSED";
	game.result = game.gameOver ? { winner: response.winner, reason: response.reason } : null; // THE 3D ROOM'S MONITOR SHOWS IT
	setMoves(response.moves, response.start_params?.fen);
	showOpening(response.opening);
	showBot(game.GAME_URL, response); // NOT AWAITED, NO LINE IS SAID
	showPosition({ fen: response.game_board, facing: facingLists(response), lastMove: response.prev_move?.length == 2 ? response.prev_move : null });
	return true;
}

/**
 * @description The facing lists of a game from the server (JSON strings) as arrays
 * @param  {[object]} response [game from the server]
 * @return {[object]} facing [{ w_knight, b_knight, w_piece, b_piece } arrays of { from, to }]
 */
function facingLists(response) {
	return { w_knight: JSON.parse(response.w_knight), b_knight: JSON.parse(response.b_knight), w_piece: JSON.parse(response.w_piece), b_piece: JSON.parse(response.b_piece) };
}

/**
 * @description Draws any position on the board (a replay's step, #100): its board, which way each piece faces & the last move's highlight.
 * The 2D board reads the facing from game.response, the 3D board follows chessInst & the same lists
 * @param  {[object]} position [{ fen, facing: { w_knight, b_knight, w_piece, b_piece } arrays of { from, to }, lastMove: [from, to] or null }]
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
	game.lastOpponentMove = lastMove || null; // THE LAST MOVE'S HIGHLIGHT (2D & 3D), EITHER SIDE'S ON A READ-ONLY BOARD
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
 * @description Starts the piece on one square sliding to another (the AI's & a friend's moves, the replay's steps both ways). Any other
 * slide stops. The render loop moves it (stepSlide) & landSlide() finishes it
 * @param  {[string]} from [the square the piece is on, "e2"]
 * @param  {[string]} to [where it slides, "e4"]
 */
export function startSlide(from, to) {
	fillTiles();
	for (let i = 0; i < game.tiles.length; i++) {
		if (game.tiles[i].square == from) {
			game.slideStart = true;
			game.tiles[i].isSliding = true;
			if (game.viewColor == 'w') { // SCREEN COLUMN & ROW OF to (a8 IS 0, 0)
				game.tiles[i].xSlideTo = to.split("")[0].charCodeAt(0) - 96 - 1;
				game.tiles[i].ySlideTo = 8 - to.split("")[1];
			} else if (game.viewColor == 'b') { // FLIPPED BOARD (h1 IS 0, 0)
				game.tiles[i].xSlideTo = 8 - (to.split("")[0].charCodeAt(0) - 96);
				game.tiles[i].ySlideTo = to.split("")[1] - 1;
			}
			game.tiles[i].xDiff = 0; // PIXELS MOVED SO FAR
			game.tiles[i].yDiff = 0;
			game.tiles[i].slideStartTime = null; // ITS CLOCK STARTS ON ITS FIRST FRAME (stepSlide)
		} else if (game.tiles[i].isSliding) { // STOP ANY OTHER SLIDE
			game.tiles[i].isSliding = false;
			game.tiles[i].xDiff = 0;
			game.tiles[i].yDiff = 0;
		}
	}
	game.currSlide = true;
	game.refresh = true;
}

let readOnlyLanded = null; // THE REPLAY'S LANDING (onReadOnlySlide)

/**
 * @description What finishes a slide on a read-only board (the replay's step), instead of sending or saving a move
 * @param  {[function]} handler [handler(index), index = the tile that slid]
 */
export function onReadOnlySlide(handler) {
	readOnlyLanded = handler;
}

/**
 * @description A slide landed (gameplay/draw): a read-only board's goes to its handler, the player's move is sent, the opponent's is finished
 * @param  {[number]} index [tile that slid]
 */
export async function landSlide(index) {
	if (game.readOnly) { return readOnlyLanded?.(index); }
	if (game.tiles[index].color == game.playerColor) { return updateUserStateSlide(index); } // SENDS THE PLAYER'S MOVE
	if (game.tiles[index].color == game.opponentColor) { return updateOpponentStateSlide(index); } // FINISHES THE OPPONENT'S MOVE
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
		if (game.moveObj.promotion && !game.moveObj.typed) { game.currPromotion = true; game.refresh = true; return; } // OPEN THE PROMOTION (A TYPED MOVE ALREADY CHOSE ITS PIECE)

		await validateMove(); // SEND THE MOVE
		game.tiles[index].isSliding = null;
	} catch (err) { console.log(err); game.currSlide = false; return refreshData(game.response); }
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
 * the local board, knight list & piece list, sends the move (PUT) & loads the server's board. AI games give the AI its turn
 * half a second later, friend games wait for the socket. A move the server turns down goes back to revert & the player is told (moveFailed)
 */
export async function validateMove() {
	try {
		playMoveSound();
		game.revert = { ...game.response }; // GO BACK TO THIS IF THE SERVER SAYS NO (A COPY, THE LISTS BELOW CHANGE response)
		game.opposingMove = true; // LOCK THE BOARD
		const playedMove = chessInst.move(game.moveObj); // LOCAL BOARD FIRST SO IT DRAWS RIGHT AWAY (THROWS IF IT'S NOT LEGAL)
		game.annotations = []; // ANY MOVE CLEARS THE MARKS & ARROWS
		game.hint = null; // & THE HINT
		if (game.playerColor == 'w') { // KEEP THE LOCAL KNIGHT & PIECE LISTS IN STEP UNTIL THE SERVER'S COMES BACK
			for (let n = 0; n < JSON.parse(game.response.w_knight).length; n++) {
				if (game.moveObj.from == JSON.parse(game.response.w_knight)[n].to) {
					let w_knight = JSON.parse(game.response.w_knight)
					w_knight[n].from = game.moveObj.from;
					w_knight[n].to = game.moveObj.to;
					game.response.w_knight = JSON.stringify(w_knight);
					break;
				}
			}
			for (let n = 0; n < JSON.parse(game.response.w_piece).length; n++) { // SAME FOR THE KINGS, QUEENS, BISHOPS & ROOKS
				if (game.moveObj.from == JSON.parse(game.response.w_piece)[n].to) {
					let w_piece = JSON.parse(game.response.w_piece)
					if (game.moveObj.from.split("")[1] != game.moveObj.to.split("")[1]) { w_piece[n].from = game.moveObj.from; } // MOVED UP OR DOWN (SIDEWAYS KEEPS ITS from)
					w_piece[n].to = game.moveObj.to;
					game.response.w_piece = JSON.stringify(w_piece);
					break;
				}
			}
			// !NOTE: THE OLD ROOK SQUARE STAYS UNTIL THE SERVER'S LIST COMES BACK. THE MOVE LANDS HALFWAY THROUGH DRAWING A FRAME
			// & THE REST OF THAT FRAME STILL DRAWS THE OLD BOARD, SO THE ROOK WOULD DISAPPEAR FOR A FRAME IF ITS SQUARE WAS GONE
			if (chessInst.get(game.moveObj.to).type == 'k' && game.moveObj.from == 'e1' && (game.moveObj.to == 'g1' || game.moveObj.to == 'c1')) { // CASTLING: THE ROOK MOVES SIDEWAYS TOO, ITS NEW SQUARE IS ADDED
				for (let n = 0; n < JSON.parse(game.response.w_piece).length; n++) {
					let w_piece = JSON.parse(game.response.w_piece)
					if (game.moveObj.to == 'g1' && w_piece[n].to == 'h1') { w_piece[w_piece.length] = { from: w_piece[n].from, to: 'f1' }; game.response.w_piece = JSON.stringify(w_piece); break; } // KING SIDE
					else if (game.moveObj.to == 'c1' && w_piece[n].to == 'a1') { w_piece[w_piece.length] = { from: w_piece[n].from, to: 'd1' }; game.response.w_piece = JSON.stringify(w_piece); break; } // QUEEN SIDE
				}
			}
			if (game.moveObj.promotion && game.moveObj.promotion != 'n') { // PROMOTED TO A QUEEN, BISHOP OR ROOK: ADDED SO IT DRAWS BEFORE THE SERVER'S LIST COMES BACK
				let w_piece = JSON.parse(game.response.w_piece)
				w_piece[w_piece.length] = { from: game.moveObj.from, to: game.moveObj.to };
				game.response.w_piece = JSON.stringify(w_piece);
			}
		} else if (game.playerColor == 'b') {
			for (let n = 0; n < JSON.parse(game.response.b_knight).length; n++) {
				if (game.moveObj.from == JSON.parse(game.response.b_knight)[n].to) {
					let b_knight = JSON.parse(game.response.b_knight)
					b_knight[n].from = game.moveObj.from;
					b_knight[n].to = game.moveObj.to;
					game.response.b_knight = JSON.stringify(b_knight);
					break;
				}
			}
			for (let n = 0; n < JSON.parse(game.response.b_piece).length; n++) { // SAME FOR THE KINGS, QUEENS, BISHOPS & ROOKS
				if (game.moveObj.from == JSON.parse(game.response.b_piece)[n].to) {
					let b_piece = JSON.parse(game.response.b_piece)
					if (game.moveObj.from.split("")[1] != game.moveObj.to.split("")[1]) { b_piece[n].from = game.moveObj.from; } // MOVED UP OR DOWN (SIDEWAYS KEEPS ITS from)
					b_piece[n].to = game.moveObj.to;
					game.response.b_piece = JSON.stringify(b_piece);
					break;
				}
			}
			if (chessInst.get(game.moveObj.to).type == 'k' && game.moveObj.from == 'e8' && (game.moveObj.to == 'g8' || game.moveObj.to == 'c8')) { // CASTLING: THE ROOK MOVES SIDEWAYS TOO, ITS NEW SQUARE IS ADDED
				for (let n = 0; n < JSON.parse(game.response.b_piece).length; n++) {
					let b_piece = JSON.parse(game.response.b_piece)
					if (game.moveObj.to == 'g8' && b_piece[n].to == 'h8') { b_piece[b_piece.length] = { from: b_piece[n].from, to: 'f8' }; game.response.b_piece = JSON.stringify(b_piece); break; } // KING SIDE
					else if (game.moveObj.to == 'c8' && b_piece[n].to == 'a8') { b_piece[b_piece.length] = { from: b_piece[n].from, to: 'd8' }; game.response.b_piece = JSON.stringify(b_piece); break; } // QUEEN SIDE
				}
			}
			if (game.moveObj.promotion && game.moveObj.promotion != 'n') { // PROMOTED TO A QUEEN, BISHOP OR ROOK: ADDED SO IT DRAWS BEFORE THE SERVER'S LIST COMES BACK
				let b_piece = JSON.parse(game.response.b_piece)
				b_piece[b_piece.length] = { from: game.moveObj.from, to: game.moveObj.to };
				game.response.b_piece = JSON.stringify(b_piece);
			}
		}


		let moveResponse;
		game.moveSaving = true; // game.response STILL HAS THE OLD BOARD, FLIP BOARD WAITS (handleFlip)
		try { moveResponse = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, [game.moveObj.from, game.moveObj.to], game.moveObj.promotion, false); } // SEND THE MOVE (PUT), THE SERVER CHECKS & SAVES IT
		finally { game.moveSaving = false; game.refresh = true; } // THE NEXT FRAME DOES A FLIP THAT WAITED (flipWhenDone)
		if (moveResponse?.status != 200) { return moveFailed(moveResponse); } // TURNED DOWN OR NO ANSWER: BACK TO THE OLD BOARD

		chessInst.load(moveResponse.game_board); // THE SERVER'S BOARD
		game.response = moveResponse;
		syncDrawOffer(moveResponse); // THIS MOVE ENDED ANY OFFER
		addMove(playedMove.san); // ONLY NOW, THE SERVER COULD TURN IT DOWN
		if (game.response.ai) { setFace(faceFor(playedMove, chessInst, game.playerColor == "w" ? "b" : "w")); } // THE MONITOR'S FACE TAKES THE PLAYER'S MOVE BADLY (3D ONLY)
		showOpening(game.response.opening);
		clearStatus("move");
		clearStatus("server");

		game.currSlide = false;
		if (game.response.state == "CLOSED") { showGameOver(game.response); return; } // CHECKMATE OR DRAW

		if (game.ai) {
			game.tiles = await setTiles();
			game.refresh = true;
			game.aiTimer = setTimeout(function () { game.aiTurn = true; game.refresh = true; }, 500); // THE AI MOVES HALF A SECOND LATER (renderLoop)
			return;
		}
		else { return refreshData(game.response); } // FRIEND GAME: THE SOCKET SAYS WHEN THEY MOVE
	} catch (err) { console.log(err); game.opposingMove = false; game.mousedownTile = false; game.clickedTile = false; return refreshData(game.revert); }
}

/**
 * @description The server turned a move down or didn't answer: says so & goes back to the board from before the move, ready for the next try
 * @param  {[object]} response [from validate/index.js]
 * @return {[object]} the old game
 */
function moveFailed(response) {
	console.log(response?.message || "Move failed: no answer from the server");
	if (noAnswer(response)) { showStatus("server", "The server isn't answering. The board was reset, try your move again."); } // STAYS UNTIL A REQUEST WORKS
	else { showStatus("move", "That move wasn't accepted. The board was reset.", MESSAGE_TIME); }
	game.response = game.revert; // THE FAILED ANSWER HAS NO BOARD
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
		game.tiles = setTiles(); // NEW TILE ARRAY, THE OLD ONE IS DROPPED
		game.clickedTile = false;
		game.mousedownTile = false;
		game.currPromotion = false;
		game.currSlide = false;
		game.slideStart = false;
		game.refresh = true;
		game.availableMovesData = { piece: null, square: null }

		return response;
	} catch (err) { console.log(err); game.tiles = setTiles(); game.refresh = true; return response; }
}

/* ---------------------------------------------------------------- */
// Revert Unfinished Move
/* ---------------------------------------------------------------- */
/**
 * @description The menu is opening: a move that isn't finished goes back to the last server board. That's a picked up or
 * dragged piece, an open promotion picker or the player's pawn sliding to the last rank (no piece is chosen yet).
 * Any other slide of the player's lands & is sent, the click committed it. A move already sent & the opponent's slides stay.
 * !NOTE: opposingMove IS ALSO TRUE DURING THE PLAYER'S OWN SLIDE, SO THE SLIDING PIECE'S COLOR SAYS WHOSE SLIDE IT IS
 */
export function revertUnfinishedMove() {
	if (game.readOnly) { return; } // NOTHING OF THE PLAYER'S IS UNFINISHED, A REPLAY'S SLIDE LANDS AS IT IS
	const heldPiece = !game.opposingMove && (game.clickedTile || game.mousedownTile); // THE TURN CHECK: A DROPPED PROMOTION KEEPS clickedTile AFTER IT'S SENT
	const promotionSlide = game.currSlide && game.moveObj.promotion && !game.moveObj.typed && game.tiles.some(function (tile) { return tile.isSliding && tile.color == game.playerColor; });
	if (!heldPiece && !game.currPromotion && !promotionSlide) { return; }
	game.opposingMove = false; // STILL THE PLAYER'S TURN
	refreshData(game.response);
}
