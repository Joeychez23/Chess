// The opponent's move: fetching it, retrying, and landing its slide
const { game, chessInst, validateState } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE BOARD THAT'S DRAWN, THE SCRATCH BOARD
const { validate } = require("../validate/index.js"); // REQUESTS TO THE CHESS SERVER (/api/chess)
const { lastMoveBy } = require("../utils/index.js"); // NEW ARRAY OF 64 BLANK TILE STATES, HOW MANY PIECES EACH SIDE STARTED WITH, A SIDE'S LAST MOVE
const { showGameOver, syncDrawOffer, loadTakeback } = require("../menu/index.js"); // THE GAME OVER SCREEN (CHECKMATE, DRAW OR FORFEIT), THE DRAW OFFER'S BUTTONS
const { showStatus, clearStatus, noAnswer, MESSAGE_TIME } = require("../status/index.js"); // THE MESSAGE AREA ON THE PLAY PAGE
const { addMove, showOpening } = require("../movelist/index.js"); // THE MOVE LIST PANEL & THE OPENING UNDER IT
import { startSlide, playMoveSound, refreshData } from "./index.js";

const OPPONENT_RETRY_TIME = 5000; // ASKS FOR A FRIEND'S MOVE AGAIN AFTER THIS WHEN THE SERVER DIDN'T ANSWER (ms)
let opponentRetry = null; // THE TIMER FOR THAT

/**
 * @description Finds the opponent's last move for its highlight when a game loads (a new game has none, so Restart & Rematch clear it).
 * prev_move can't say: it's the player's when they moved last. moves only has SAN, so they're played on the scratch board
 */
export function setLastOpponentMove() {
	try {
		const startFen = game.response.start_params?.fen;
		if (startFen) { validateState.load(startFen); } else { validateState.reset(); }
		game.lastOpponentMove = lastMoveBy(validateState, game.response.moves || [], game.response.opponent_color);
	} catch (err) { console.log(err); game.lastOpponentMove = null; } // ONLY THE HIGHLIGHT IS MISSING, THE GAME STILL OPENS
}

/**
 * @description Checks if opponent made a new move [No AI]. The socket calls this when the friend moved: it gets the game,
 * works out their move from prev_move (a pawn that became another piece was a promotion) & starts its slide.
 * The move is finished by updateOpponentStateSlide() when the slide lands
 */
export async function checkOpponentMove() { // PROMOTIONS OF OPPOSING PLAYER THROWS INVALID MOVE
	try {
		game.revert = game.response
		const updatedResponse = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, false); // GET THE GAME
		if (updatedResponse?.status != 200) { return opponentMoveFailed(updatedResponse); }
		clearStatus("server");
		if (updatedResponse.takebacks_left < game.revert.takebacks_left) { return await loadTakeback(updatedResponse); } // A RECONNECT MISSED AN ACCEPTED TAKEBACK. ONLY GOES DOWN ON ONE, AN OLD READ HAS A HIGHER COUNT
		syncDrawOffer(updatedResponse); // THEIR MOVE ENDS ANY OFFER, A RECONNECT CATCHES UP ON ONE
		if (updatedResponse.game_board != game.revert.game_board && game.opposingMove) { // THE BOARD CHANGED ON THE OPPONENT'S TURN
			validateState.load(updatedResponse.game_board);
			const serverPiece = validateState.get(updatedResponse.prev_move[1]) // PIECE RETURNED FROM THE SERVER GAME BOARD

			validateState.load(game.revert.game_board);
			const clientPiece = validateState.get(updatedResponse.prev_move[0]); // PIECE RETURNED FROM LOCAL/CLIENT GAME BOARD

			if ((serverPiece.color == clientPiece.color) && (serverPiece.type != 'p' && clientPiece.type == 'p')) { // PROMOTION
				game.moveObj = { from: updatedResponse.prev_move[0], to: updatedResponse.prev_move[1], promotion: serverPiece.type }
			} else {
				game.moveObj = { from: updatedResponse.prev_move[0], to: updatedResponse.prev_move[1] }
			}

			validateState.move(game.moveObj); // CHECK IT ON THE SCRATCH BOARD (THROWS IF IT'S NOT LEGAL)
			startSlide(game.moveObj.from, game.moveObj.to);
		}
	} catch (err) { console.log(err); }
}

/**
 * @description A friend's move couldn't be fetched, the board stays locked on their turn. No answer: says so & asks again
 * until there's one (checkOpponentMove clears the message). Any other answer won't change by asking again
 * @param  {[object]} response [from validate/index.js]
 */
function opponentMoveFailed(response) {
	console.log(response?.message || "Opponent move failed: no answer from the server");
	if (!noAnswer(response)) { return showStatus("server", "Your opponent's move couldn't be loaded. Reload the page to try again."); }
	showStatus("server", "The server isn't answering. Trying again…");
	clearTimeout(opponentRetry);
	opponentRetry = setTimeout(checkOpponentMove, OPPONENT_RETRY_TIME);
}

/* ---------------------------------------------------------------- */
// On Opponent Slide Complete
/* ---------------------------------------------------------------- */
/**
 * @description Updates board data on slide completion for opposing player (AI or friend). Plays the move sound, moves the
 * piece on the local board, knight list & piece list, then loads the saved game (the AI's came with its move, a friend game is fetched)
 * & gives the turn back to the player
 * !NOTE: KEEP THE AWAIT ON THE AI LINE, WITHOUT IT refreshData() RESETS THE TILES WHILE THE FRAME IS STILL DRAWING
 * & A TAKEN PIECE CAN BE LEFT ON THE BOARD
 * @param  {[number]} index [tile that slid]
 */
export async function updateOpponentStateSlide(index) {
	try {
		playMoveSound();
		game.tiles[index].xSlideTo = 0;
		game.tiles[index].ySlideTo = 0;
		const playedMove = chessInst.move(game.moveObj); // LOCAL BOARD
		game.annotations = []; // ANY MOVE CLEARS THE MARKS & ARROWS

		const color = game.opponentColor;
		if (color) { // KEEP THE LOCAL KNIGHT & PIECE LISTS IN STEP
			const { from, to, promotion } = game.moveObj;
			const rank = color == 'w' ? '1' : '8';
			const knights = JSON.parse(game.response[`${color}_knight`]);
			const pieces = JSON.parse(game.response[`${color}_piece`]);
			for (const knight of knights) {
				if (knight.to == from) {
					knight.from = from;
					knight.to = to;
				}
			}
			for (const piece of pieces) { // SAME FOR THE KINGS, QUEENS, BISHOPS & ROOKS
				if (piece.to == from) {
					if (from[1] != to[1]) { piece.from = from; } // MOVED UP OR DOWN (SIDEWAYS KEEPS ITS from)
					piece.to = to;
				}
			}
			// !NOTE: THE OLD ROOK SQUARE STAYS UNTIL THE SERVER'S LIST COMES BACK. THE MOVE LANDS HALFWAY THROUGH DRAWING A FRAME
			// & THE REST OF THAT FRAME STILL DRAWS THE OLD BOARD, SO THE ROOK WOULD DISAPPEAR FOR A FRAME IF ITS SQUARE WAS GONE
			if (chessInst.get(to).type == 'k' && from == `e${rank}` && (to == `g${rank}` || to == `c${rank}`)) { // CASTLING: THE ROOK MOVES SIDEWAYS TOO, ITS NEW SQUARE IS ADDED
				const [rookFrom, rookTo] = to == `g${rank}` ? [`h${rank}`, `f${rank}`] : [`a${rank}`, `d${rank}`]; // KING SIDE : QUEEN SIDE
				const rook = pieces.find((piece) => piece.to == rookFrom);
				if (rook) { pieces.push({ from: rook.from, to: rookTo }); }
			}
			if (promotion && promotion != 'n') { pieces.push({ from, to }); } // PROMOTED TO A QUEEN, BISHOP OR ROOK: ADDED SO IT DRAWS BEFORE THE SERVER'S LIST COMES BACK
			game.response[`${color}_knight`] = JSON.stringify(knights);
			game.response[`${color}_piece`] = JSON.stringify(pieces);
		}

		game.revert = game.response;
		let savedGame;
		if (game.ai) { savedGame = await new Promise((resolve) => setTimeout(() => resolve(game.moveObj.response))); } // ALREADY SAVED BY THE SERVER (NO PUT), WAITS A TICK LIKE A PUT WOULD SO THE FRAME FINISHES DRAWING BEFORE refreshData() RESETS THE TILES
		else { savedGame = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, false); }
		if (savedGame?.status != 200) { // BACK TO THE PREVIOUS BOARD, STILL THEIR TURN
			game.opposingMove = true;
			opponentMoveFailed(savedGame);
			return refreshData(game.revert);
		}
		chessInst.load(savedGame.game_board); // UPDATE BOARD
		game.response = savedGame;
		syncDrawOffer(savedGame);
		game.lastOpponentMove = [game.moveObj.from, game.moveObj.to];
		addMove(playedMove.san);
		showOpening(game.response.opening);
		clearStatus("server");
		game.currSlide = false;

		game.tiles[index].isSliding = null;
		game.tiles[index].xDiff = 0;
		game.tiles[index].yDiff = 0;
		game.tiles[index].x = game.tiles[index].xSlideTo;
		game.tiles[index].y = game.tiles[index].ySlideTo;

		game.opposingMove = false;
		refreshData(game.response);
		if (game.response.state == "CLOSED") { showGameOver(game.response); } // CHECKMATE OR DRAW
	} catch (err) {
		game.currSlide = false;
		console.log(err);
		showStatus("move", "Something went wrong. The board was reset.", MESSAGE_TIME);
		return refreshData(game.response);
	}
}
