/*
 *  index.js  --  chess frontend
 *	Moves
 *	Loads the game from the server (setInitialData), sends the player's moves (validateMove) & finishes the AI's & a friend's
 *	once their slide lands (updateOpponentStateSlide). A friend's move arrives over the socket (the move event, checkOpponentMove).
 *	refreshData resets the board to a game from the server. The requests themselves are in gameplay/validate/index.js
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, chessInst, validateState } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE BOARD THAT'S DRAWN, THE SCRATCH BOARD
const { validate } = require("../validate/index.js"); // REQUESTS TO THE CHESS SERVER (/api/chess)
const { playAi } = require("../ai/index.js"); // ASKS THE SERVER FOR THE AI'S MOVE
const { setTiles, countStartPieces } = require("../utils/index.js"); // NEW ARRAY OF 64 BLANK TILE STATES, HOW MANY PIECES EACH SIDE STARTED WITH
const { handleRemoteMenuEnter } = require("../input/index.js"); // TV REMOTE: SELECTS A MENU BUTTON
const { showGameOver } = require("../index.js"); // STILL IN gameplay/index.js (IT MOVES WITH THE MENU), ONLY FUNCTIONS CAN COME FROM THERE
const menu = document.getElementById("menuContainer"); // IN GAME MENU
const optResumeBtn = document.getElementById("optResume"); // MENU: RESUME
const optRestartBtn = document.getElementById("optRestart"); // MENU: RESTART (AI GAMES) / FORFEIT & REMATCH (FRIEND GAMES)
const resultDisplay = document.getElementById("resultDisplay"); // MENU TITLE ("Chess" OR THE RESULT)

/* ---------------------------------------------------------------- */
// Set Initial Board Data
/* ---------------------------------------------------------------- */
/**
 * @description Sets initial data. Gets the game from the server & sets the player's color & the board.
 * Guests get a new AI game first if they don't have one. If it's the AI's turn its move is asked for here & slid in by renderLoop()
 * @return {[boolean]} false [the game couldn't be loaded]
 */
export async function setInitialData() {
	if (game.PLAYER_ID === game.GAME_ID && game.PLAYER_ID && game.GAME_ID) { // GUEST (A GUEST'S PLAYER ID IS THEIR GAME ID)
		game.response = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, false);
		if (!game.response?.game_board) { game.response = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, 'b'); } // NO GAME YET: NEW GAME VS THE AI
	}
	game.response = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, false); // GET THE GAME
	game.playerColor = game.response?.player_color || null;
	if (game.response.status == 200) { // IF GAME IS ON AI TURN, PLAY TURN
		game.opponentColor = game.response?.opponent_color || false;
		chessInst.load(game.response.game_board); // THE BOARD TO DRAW
		game.startPieceCount = countStartPieces(game.response.start_params?.fen); // A SET POSITION CAN START WITH FEWER PIECES, THE MISSING ONES WEREN'T TAKEN
		if (game.response.state == "CLOSED") { // GAME IS OVER (CHECKMATE, DRAW OR FORFEIT)
			game.ai = game.response.ai;
			showGameOver(game.response);
			return;
		}

		// NOTE : CONDITONALIZE BACK END TO SUPPORT DETIRMINING AI COLOR OR REAL OPPONENT COLOR
		// THEN : CONDITIONALIZE BOARD ACCORDINGLY

		if (chessInst.turn() == game.playerColor) { game.opposingMove = false; } else { game.opposingMove = true; } // LOCK THE BOARD ON THE OPPONENT'S TURN
		if (game.response.ai) {
			game.ai = true;
			if (game.opponentColor == chessInst.turn()) { //PLAY AI MOVE
				game.moveObj = await playAi(game.GAME_URL, game.GAME_ID); // THE SERVER PICKS & SAVES THE AI MOVE (renderLoop ASKS AGAIN, GETS THE SAME MOVE & SLIDES IT IN)
				game.tiles = await setTiles();
				game.aiTurn = true;
				game.refresh = true;
				setTimeout(function () { game.aiTurn = true; game.refresh = true; }, 500);
				return;
			}

		}
	} else {
		return false;
	}
}

/* ---------------------------------------------------------------- */
// Check Opponent Move
/* ---------------------------------------------------------------- */
/**
 * @description Checks if opponent made a new move [No AI]. The socket calls this when the friend moved: it gets the game,
 * works out their move from prev_move (a pawn that became another piece was a promotion) & starts its slide.
 * The move is finished by updateOpponentStateSlide() when the slide lands
 */
export async function checkOpponentMove() { // PROMOTIONS OF OPPOSING PLAYER THROWS INVALID MOVE
	try {
		game.revert = game.response
		const updatedResponse = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, false); // GET THE GAME
		if (updatedResponse.game_board != game.revert.game_board && game.opposingMove) { // THE BOARD CHANGED ON THE OPPONENT'S TURN
			if (chessInst.isGameOver()) { // THIS BOARD WAS ALREADY OVER
				game.menuToggled = true;
				menu.style.display = "flex"
				optResumeBtn.parentElement.style.display = 'none';
				if (game.playerColor == 'w') { resultDisplay.innerText = "White Wins!" }
				else if (game.playerColor == 'b') { resultDisplay.innerText = "Black Wins!" }
				handleRemoteMenuEnter(optRestartBtn);
			}

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
			for (let i = 0; i < game.tiles.length; i++) { // START THE SLIDE (SAME AS THE AI'S IN renderLoop)
				if (game.tiles[i].square == game.moveObj.from) {
					game.slideStart = true;
					game.tiles[i].isSliding = true
					if (game.playerColor == 'w') {
						game.tiles[i].xSlideTo = game.moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
						game.tiles[i].ySlideTo = 8 - game.moveObj.to.split("")[1];
					} else if (game.playerColor == 'b') {
						game.tiles[i].xSlideTo = 8 - (game.moveObj.to.split("")[0].charCodeAt(0) - 96);
						game.tiles[i].ySlideTo = game.moveObj.to.split("")[1] - 1;
					}
					game.tiles[i].xDiff = 0;
					game.tiles[i].yDiff = 0;
				}
			}
			game.currSlide = true;
			game.refresh = true;
		}
	} catch (err) { console.log(err); }
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
		if (game.moveObj.promotion) { game.currPromotion = true; game.refresh = true; return; } // OPEN THE PROMOTION 
		
		await validateMove(); // SEND THE MOVE
		game.tiles[index].isSliding = null;
	} catch (err) { console.log(err); game.currSlide = false; return refreshData(game.response); }
}

/* ---------------------------------------------------------------- */
// Validates User Move
/* ---------------------------------------------------------------- */
/**
 * @description Validates user move post slide or drag/drop then starts ai slide. Plays the move sound, moves the piece on
 * the local board, knight list & piece list, sends the move (PUT) & loads the server's board. AI games give the AI its turn
 * half a second later, friend games wait for the socket. A move the server turns down goes back to revert
 */
export async function validateMove() {
	try {
		game.moveAudio.load();
		game.moveAudio.play().catch((err) => { console.log(err) });
		game.revert = { ...game.response }; // GO BACK TO THIS IF THE SERVER SAYS NO (A COPY, THE LISTS BELOW CHANGE response)
		game.opposingMove = true; // LOCK THE BOARD
		chessInst.move(game.moveObj); // LOCAL BOARD FIRST SO IT DRAWS RIGHT AWAY (THROWS IF IT'S NOT LEGAL)
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


		game.response = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, [game.moveObj.from, game.moveObj.to], game.moveObj.promotion, false); // SEND THE MOVE (PUT), THE SERVER CHECKS & SAVES IT

		chessInst.load(game.response.game_board); // THE SERVER'S BOARD

		if (game.response.status == 200) {
			game.currSlide = false;
			if (game.response.state == "CLOSED") { showGameOver(game.response); return; } // CHECKMATE OR DRAW

			if (game.ai) {
				game.tiles = await setTiles();
				game.refresh = true;
				setTimeout(function () { game.aiTurn = true; game.refresh = true; }, 500); // THE AI MOVES HALF A SECOND LATER (renderLoop)
				return;
			}
			else { return refreshData(game.response); } // FRIEND GAME: THE SOCKET SAYS WHEN THEY MOVE

		} else { game.opposingMove = false; return refreshData(game.revert); } // TURNED DOWN: BACK TO THE OLD BOARD
	} catch (err) { console.log(err); game.opposingMove = false; game.mousedownTile = false; game.clickedTile = false; return refreshData(game.revert); }
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
		game.moveAudio.load();
		game.moveAudio.play().catch((err) => { console.log(err) });
		game.tiles[index].xSlideTo = 0;
		game.tiles[index].ySlideTo = 0;
		chessInst.move(game.moveObj); // LOCAL BOARD

		if (game.opponentColor == 'w') { // KEEP THE LOCAL KNIGHT & PIECE LISTS IN STEP
			for (let n = 0; n < JSON.parse(game.response.w_knight).length; n++) {
				if (game.moveObj.from == JSON.parse(game.response.w_knight)[n].to) {
					let w_knight = JSON.parse(game.response.w_knight)
					w_knight[n].from = game.moveObj.from;
					w_knight[n].to = game.moveObj.to;
					game.response.w_knight = JSON.stringify(w_knight);
				}
			}
			for (let n = 0; n < JSON.parse(game.response.w_piece).length; n++) { // SAME FOR THE KINGS, QUEENS, BISHOPS & ROOKS
				if (game.moveObj.from == JSON.parse(game.response.w_piece)[n].to) {
					let w_piece = JSON.parse(game.response.w_piece)
					if (game.moveObj.from.split("")[1] != game.moveObj.to.split("")[1]) { w_piece[n].from = game.moveObj.from; } // MOVED UP OR DOWN (SIDEWAYS KEEPS ITS from)
					w_piece[n].to = game.moveObj.to;
					game.response.w_piece = JSON.stringify(w_piece);
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
		} else if (game.opponentColor == 'b') {
			for (let n = 0; n < JSON.parse(game.response.b_knight).length; n++) {
				if (game.moveObj.from == JSON.parse(game.response.b_knight)[n].to) {
					let b_knight = JSON.parse(game.response.b_knight)
					b_knight[n].from = game.moveObj.from;
					b_knight[n].to = game.moveObj.to;
					game.response.b_knight = JSON.stringify(b_knight);
				}
			}
			for (let n = 0; n < JSON.parse(game.response.b_piece).length; n++) { // SAME FOR THE KINGS, QUEENS, BISHOPS & ROOKS
				if (game.moveObj.from == JSON.parse(game.response.b_piece)[n].to) {
					let b_piece = JSON.parse(game.response.b_piece)
					if (game.moveObj.from.split("")[1] != game.moveObj.to.split("")[1]) { b_piece[n].from = game.moveObj.from; } // MOVED UP OR DOWN (SIDEWAYS KEEPS ITS from)
					b_piece[n].to = game.moveObj.to;
					game.response.b_piece = JSON.stringify(b_piece);
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

		game.revert = game.response;
		if (game.ai) { game.response = await new Promise((resolve) => setTimeout(() => resolve(game.moveObj.response))); } // ALREADY SAVED BY THE SERVER (NO PUT), WAITS LIKE THE OLD PUT SO THE FRAME FINISHES DRAWING BEFORE refreshData() RESETS THE TILES
		else { game.response = await validate(game.GAME_URL, game.GAME_ID, game.PLAYER_ID, false, false, false); }
		chessInst.load(game.response.game_board); // UPDATE BOARD
		if (game.response.status == 200) { // IF VALIDATED UPDATE BOARD STATE
			game.currSlide = false;

			game.tiles[index].isSliding = null;
			game.tiles[index].xDiff = 0;
			game.tiles[index].yDiff = 0;
			game.tiles[index].x = game.tiles[index].xSlideTo;
			game.tiles[index].y = game.tiles[index].ySlideTo;

			game.opposingMove = false;
			refreshData(game.response);
			if (game.response.state == "CLOSED") { showGameOver(game.response); } // CHECKMATE OR DRAW
		} else { game.opposingMove = true; return refreshData(game.revert); } // IF VALIDATION FAILS REVERT BACK TO PREVIOUS BOARD
	} catch (err) { game.currSlide = false; console.log(err); return refreshData(game.response); }
}

/* ---------------------------------------------------------------- */
// Refresh Game Data
/* ---------------------------------------------------------------- */
/**
 * @description Refreshes data based on passed in response. Loads its board, clears every tile (selection, drag, slide),
 * closes the promotion picker & the menu & draws the next frame
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
		game.menuToggled = false;
		
		return response;
	} catch (err) { console.log(err); game.tiles = setTiles(); game.refresh = true; return response; }
}
