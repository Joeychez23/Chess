/*
 *  index.js  --  chess frontend
 *	Gameplay
 *	Draws the game to a canvas (table, board, pieces, shadows & reflections), handles moves by
 *	click, drag, touch & TV remote, slides the AI's / opponent's moves in & runs the in game menu.
 *	Moves are checked locally with chess.js, then saved by the chess server (validate/index.js)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, canvas, chessInst, validateState, frameRate, OVERRIDE_TV } = require("./state/index.js"); // THE GAME'S SHARED STATE (game.tiles, game.moveObj, ...), THE CANVAS & THE chess.js BOARDS
const { validate, restartGame, forfeitGame, rematchGame } = require("./validate/index.js"); // REQUESTS TO THE CHESS SERVER (/api/chess)
const { playAi } = require("./ai/index.js"); // ASKS THE SERVER FOR THE AI'S MOVE
const { setTiles, countStartPieces } = require("./utils/index.js"); // NEW ARRAY OF 64 BLANK TILE STATES, HOW MANY PIECES EACH SIDE STARTED WITH
const { imageProgress } = require("./images/index.js"); // HOW MANY OF THE GAME'S IMAGES HAVE LOADED (0 - 1)
const { handleWindowResize } = require("./layout/index.js"); // REDRAWS THE GAME WHEN THE WINDOW IS RESIZED
const { handleInitialData, setTakenPieceArr } = require("./draw/index.js"); // DRAWS EACH FRAME (drawScreen), THE TAKEN PIECE TRAYS
const { getRestartPieces, startRestartSlide, drawRestartSlide } = require("./animate/index.js"); // THE PIECES SLIDING HOME AFTER RESTART & REMATCH
const { handleKeyPress, handleCanvasClick, handleMouseMove, handleMouseDown, handleMouseUp, handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel, handleRemoteMenuEnter } = require("./input/index.js"); // MOUSE, TOUCH & TV REMOTE HANDLERS (ADDED IN startGame), THE TV REMOTE'S MENU HIGHLIGHT
const { joinGame, leaveGame } = require("../socket/index.js"); // FRIEND GAMES: THE SERVER PUSHES MOVES, FORFEITS & REMATCHES
const main = document.querySelector("#main"); // THE CANVAS IS ADDED HERE
const optBtn = document.getElementById("optBtn"); // MENU BUTTON (3 LINES, TOP RIGHT), OPENS THE MENU
const menu = document.getElementById("menuContainer"); // IN GAME MENU
const optResumeBtn = document.getElementById("optResume"); // MENU: RESUME
const optRestartBtn = document.getElementById("optRestart"); // MENU: RESTART (AI GAMES) / FORFEIT & REMATCH (FRIEND GAMES)
const optHomepageBtn = document.getElementById("optSettings"); // MENU: HOMEPAGE
const optExitBtn = document.getElementById("optExit"); // MENU: EXIT
const resultDisplay = document.getElementById("resultDisplay"); // MENU TITLE ("Chess" OR THE RESULT)

/* ---------------------------------------------------------------- */
// Game Variables
/* ---------------------------------------------------------------- */
// USED BY THE FUNCTIONS BELOW ONLY (THE STATE OTHER FILES SHARE IS game, gameplay/state/index.js)
let confirmForfeit = false; // FORFEIT NEEDS A SECOND PRESS
let rematchWaiting = false; // TIMER WHILE WAITING 1 MINUTE ON THE OPPONENT'S REMATCH PRESS

const socketHandlers = { move: checkOpponentMove, gameOver: showGameOver, rematch: loadRematch }; // SOCKET EVENT -> HANDLER

/* ---------------------------------------------------------------- */
// Render Canvas
/* ---------------------------------------------------------------- */
/**
 * @description Starts a game: adds the canvas to main & starts the game (startGame) once the images are loaded.
 * The game's functions are below, the state they share is game (gameplay/state/index.js)
 * @param  {[object]} playerData [{ GAME_URL, GAME_ID, PLAYER_ID, TV_BOOL, SIGNED_IN }, TV_BOOL = TV REMOTE CONTROLS INSTEAD OF THE MOUSE]
 */
export async function renderCanvas(playerData) {
	game.GAME_URL = playerData.GAME_URL; // SETS CONSTANT GAME VARIABLES
	game.PLAYER_ID = playerData.PLAYER_ID;
	game.TV_BOOL = playerData.TV_BOOL;
	game.SIGNED_IN = playerData.SIGNED_IN; // A SIGNED IN PLAYER (NOT A GUEST): RESTART CHANGES THE URL, EXIT LOGS OUT
	game.GAME_ID = playerData.GAME_ID; // CHANGES WHEN AN AI GAME RESTARTS OR A FRIEND GAME REMATCHES

	optBtn.style.display = "flex"; // SHOW THE MENU BUTTON

	canvas.id = "canvas";

	game.cw = (canvas.width = window.innerWidth); // CANVAS WIDTH (CSS PIXELS)
	game.ch = (canvas.height = window.innerHeight); // CANVAS HEIGHT (CSS PIXELS)
	game.moveAudio = new Audio(`${process.env.CHESS_ASSESTS_URL}/audio/piece-jump.mp4`); // MOVE SOUND

	canvas.style.backgroundRepeat = "repeat-y"; // THE TABLE BEHIND THE BOARD
	canvas.style.backgroundImage = `url("${process.env.CHESS_ASSESTS_URL}/images/board/table.webp")`;
	canvas.style.backgroundSize = "cover";
	canvas.style.backgroundPosition = "center";
	main.append(canvas);


	/* ---------------------------------------------------------------- */
	// Check Image Loaded
	/* ---------------------------------------------------------------- */
	/**
	 * @description If all images are loaded start game. Checks every 100ms (Home already loaded them, so they come from the browser cache)
	 */
	const startGameCheck = setInterval(async function () {
		if (imageProgress() == 1) { // EVERY IMAGE preloadImages() STARTED IS IN (THE PLAY PAGE STARTS THEM BEFORE renderCanvas)
			startGame();
			clearInterval(startGameCheck);
		}
	}, 100);
}

/* ---------------------------------------------------------------- */
// Start Game
/* ---------------------------------------------------------------- */
/**
 * @description Starts the core game interval loop. Loads the game, joins a friend game's socket room, adds the canvas
 * to main, runs renderLoop() every frameRate ms & adds the event listeners (the board's handlers are in gameplay/input/index.js)
 */
async function startGame() {
	game.wTakenPieces = setTakenPieceArr("b");
	game.bTakenPieces = setTakenPieceArr("w");

	game.cw = 0; // SET BY renderBoard()
	game.ch = 0;

	await setInitialData(); // SETS INITIAL DATA
	handleInitialData(); // HANDLES INITIAL DATA
	if (!game.ai && game.response?.status == 200) { // FRIEND GAME
		joinGame(game.GAME_ID, game.PLAYER_ID, socketHandlers); // THE SERVER PUSHES MOVES, FORFEITS & REMATCHES (server/socket.js)
		if (!game.gameOver) { optRestartBtn.innerHTML = "Forfeit"; } // RESTART IS FORFEIT IN FRIEND GAMES
	}

	
	// JUST IN CASE
	canvas.style.backgroundRepeat = "repeat-y"; // THE TABLE BEHIND THE BOARD
	canvas.style.backgroundImage = `url("${process.env.CHESS_ASSESTS_URL}/images/board/table.webp")`;
	canvas.style.backgroundSize = "cover";
	canvas.style.backgroundPosition = "center";
	main.append(canvas);
	//

	game.drawInterval = setInterval(async function () { await renderLoop() }, frameRate); // THE RENDER LOOP, ABOUT 33 FRAMES A SECOND

	// EVENT LISTENERS (THE BOARD'S HANDLERS ARE IN gameplay/input/index.js, handleWindowResize IN gameplay/layout/index.js, THE MENU'S IN EVENT LISTENERS BELOW)
	window.addEventListener("resize", handleWindowResize);
	if (game.TV_BOOL || OVERRIDE_TV) { window.addEventListener("keydown", handleKeyPress) }
	if (!game.TV_BOOL || OVERRIDE_TV) { canvas.addEventListener("click", handleCanvasClick); }
	if (!game.TV_BOOL || OVERRIDE_TV) { canvas.addEventListener("mousemove", handleMouseMove); }
	if (!game.TV_BOOL || OVERRIDE_TV) { canvas.addEventListener("mousedown", handleMouseDown); }
	if (!game.TV_BOOL || OVERRIDE_TV) { canvas.addEventListener("mouseup", handleMouseUp); }
	if (!game.TV_BOOL || OVERRIDE_TV) {
		canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
		canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
		canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
		canvas.addEventListener("touchcancel", handleTouchCancel, { passive: false });
	}
	if (!game.TV_BOOL || OVERRIDE_TV) { optBtn.addEventListener("click", handleMenuBtn); }
	if (!game.TV_BOOL || OVERRIDE_TV) { optResumeBtn.addEventListener("click", handleResume); }
	if (!game.TV_BOOL || OVERRIDE_TV) { optRestartBtn.addEventListener("click", handleRestart) }
	if (!game.TV_BOOL || OVERRIDE_TV) { optHomepageBtn.addEventListener("click", handleHomepage); }
	if (!game.TV_BOOL || OVERRIDE_TV) { optExitBtn.addEventListener("click", handleExit); }
}

/* ################################################################ */
/* ################################################################ */
// CORE RENDER LOOP
/* ################################################################ */
/* ################################################################ */

/**
 * @description Runs every frame (drawInterval). On the AI's turn it asks the server for the AI's move & starts its slide,
 * otherwise it draws a frame when something changed (refresh) or a piece is sliding (currSlide)
 */
async function renderLoop() {
	if (game.restartSlide) { return drawRestartSlide(); } // RESTART & REMATCH: THE PIECES SLIDE HOME
	if ((game.refresh || game.currSlide) && !game.boardReset) {
		try {
			if (game.ai && chessInst.turn() != game.playerColor && game.aiTurn) { // IF AI
				game.revert = game.response; // GO BACK TO THIS IF THE AI MOVE FAILS
				clearInterval(game.drawInterval) // NO FRAMES WHILE THE SERVER PICKS THE MOVE
				game.moveObj = await playAi(game.GAME_URL, game.GAME_ID); // THE SERVER PICKS & SAVES THE AI MOVE

				validateState.load(game.response.game_board); // CHECK THE MOVE ON THE SCRATCH BOARD (THROWS IF IT'S NOT LEGAL)
				validateState.move(game.moveObj);
				for (let i = 0; i < game.tiles.length; i++) { // START THE SLIDE OF THE PIECE ON moveObj.from
					if (game.tiles[i].square == game.moveObj.from) {
						game.slideStart = true;
						game.tiles[i].isSliding = true;
						if (game.playerColor == 'w') { // SCREEN COLUMN & ROW OF moveObj.to (a8 IS 0, 0)
							game.tiles[i].xSlideTo = game.moveObj.to.split("")[0].charCodeAt(0) - 96 - 1;
							game.tiles[i].ySlideTo = 8 - game.moveObj.to.split("")[1];
						} else if (game.playerColor == 'b') { // FLIPPED BOARD (h1 IS 0, 0)
							game.tiles[i].xSlideTo = 8 - (game.moveObj.to.split("")[0].charCodeAt(0) - 96);
							game.tiles[i].ySlideTo = game.moveObj.to.split("")[1] - 1;
						}
						game.tiles[i].xDiff = 0; // PIXELS MOVED SO FAR
						game.tiles[i].yDiff = 0;
					} else if (game.tiles[i].isSliding) { // STOP ANY OTHER SLIDE
						game.tiles[i].isSliding = false;
						game.tiles[i].xDiff = 0;
						game.tiles[i].yDiff = 0;
					}
				}
				game.aiTurn = false;
				game.currSlide = true;
				game.drawInterval = setInterval(async function () { await renderLoop() }, frameRate); // FRAMES AGAIN, THE SLIDE PLAYS
				return;
			}
			game.drawScreen(); // DRAW ONE FRAME
			document.documentElement.classList.remove("loadingPage"); // THE FIRST FRAME IS DRAWN: FADE INTO THE GAME (play.html), DOES NOTHING AFTER THAT
			game.refresh = false;
		} catch (err) { console.log(err); }
	}
}

/*____________________________________________________________________________________________________________________________*/

/* ################################################################ */
/* ################################################################ */
// CORE GAME FUNCTIONS
/* ################################################################ */
/* ################################################################ */

/* ---------------------------------------------------------------- */
// Set Initial Board Data
/* ---------------------------------------------------------------- */
/**
 * @description Sets initial data. Gets the game from the server & sets the player's color & the board.
 * Guests get a new AI game first if they don't have one. If it's the AI's turn its move is asked for here & slid in by renderLoop()
 * @return {[boolean]} false [the game couldn't be loaded]
 */
async function setInitialData() {
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
async function checkOpponentMove() { // PROMOTIONS OF OPPOSING PLAYER THROWS INVALID MOVE
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
export async function updateUserStateSlide(index) { // EXPORTED FOR gameplay/draw/index.js (A SLIDE LANDED)
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
export async function validateMove() { // EXPORTED FOR gameplay/input/index.js
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
export async function updateOpponentStateSlide(index) { // EXPORTED FOR gameplay/draw/index.js (A SLIDE LANDED)
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
export function refreshData(response) { // EXPORTED FOR gameplay/input/index.js
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


/* ################################################################ */
/* ################################################################ */
// EVENT LISTENERS
/* ################################################################ */
/* ################################################################ */
// THE MENU'S HANDLERS. THE addEventListener LINES ARE AT THE END OF startGame(), THE BOARD'S HANDLERS (MOUSE, TOUCH & TV REMOTE) ARE IN
// gameplay/input/index.js & THE RESIZE HANDLER IS handleWindowResize (gameplay/layout/index.js)


/* ---------------------------------------------------------------- */
// Options (Menu) Button
/* ---------------------------------------------------------------- */
/**
 * @description Toggles menu based on menu state. The menu button (3 lines) opens or closes the menu
 */
export function handleMenuBtn(e) { // EXPORTED FOR gameplay/input/index.js
	e.preventDefault();
	e.stopPropagation();
	game.menuToggled = !game.menuToggled;
	game.refresh = false; // THE BOARD STAYS AS IT IS UNDER THE MENU
	if (game.menuToggled) { menu.style.display = "flex" }
	else { menu.style.display = "none" }
}

/* ---------------------------------------------------------------- */
// Resume Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Opens or closes menu based on menu state. Resume is only seen while the menu is open, so it closes it
 */
export function handleResume(e) { // EXPORTED FOR gameplay/input/index.js
	e.preventDefault();
	e.stopPropagation();
	if (game.boardReset) { return; } // THE MENU STAYS OPEN WHILE A NEW BOARD LOADS (THE OLD BOARD UNDER IT IS LOCKED)
	game.menuToggled = !game.menuToggled;
	game.refresh = false;
	if (game.menuToggled) { menu.style.display = "flex" }
	else { menu.style.display = "none" }
}

/* ---------------------------------------------------------------- */
// Restart Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description AI games: a game that's still going is forfeited, then a new game starts. The old board stays on screen
 * under the menu & Restart says Loading & fills up while it loads, then the pieces slide home (startRestartSlide).
 * Friend games: the same button is Forfeit, then Rematch once the game is over
 */
export async function handleRestart(e) { // EXPORTED FOR gameplay/input/index.js
	e.preventDefault();
	e.stopPropagation();
	if (game.boardReset) { return; } // ALREADY LOADING A NEW BOARD (A SECOND PRESS, THE TV REMOTE'S ENTER)
	if (!game.ai) { return await handleFriendBtn(); } // FORFEIT / REMATCH
	const fromPieces = getRestartPieces(true); // WHERE THE PIECES ARE NOW, THEY SLIDE HOME FROM HERE
	game.boardReset = true; // STOP DRAWING, THE OLD BOARD STAYS ON SCREEN UNDER THE MENU WHILE THE NEW ONE LOADS
	game.refresh = false;
	optBtn.style.display = "none"
	setRestartLoading(0.15); // "Loading" & THE FILL
	const restartResponse = await restartGame(game.GAME_URL, game.GAME_ID); // FORFEITS IF STILL GOING, THEN A NEW GAME WITH THE SAME START SETTINGS (LEVEL & COLOR)
	if (restartResponse?.status != 200 || !restartResponse?.game_board) { // RESET FAILED, KEEP THE CURRENT GAME (THE MENU STAYS OPEN)
		game.boardReset = false;
		setRestartLoading(false);
		optBtn.style.display = "flex";
		game.refresh = true;
		return;
	}
	setRestartLoading(0.5);
	game.GAME_ID = restartResponse.game_id; // NEW GAME ID (GUESTS KEEP THEIRS)
	if (game.SIGNED_IN) { history.replaceState(null, "", `/play/${game.GAME_ID}`); } // THE URL FOLLOWS THE NEW GAME, BACK DOESN'T RETURN TO THE OLD ONE (GUESTS STAY ON /play)
	await loadNewBoard(fromPieces);
	return
}

/**
 * @description Loads GAME_ID's board in place (restart & rematch), the canvas, listeners & render loop stay the same.
 * The old board stays on screen while it loads, then the menu closes & the pieces slide home (startRestartSlide)
 * @param  {[array]} fromPieces [where the old game's pieces were, getRestartPieces(true)]
 */
async function loadNewBoard(fromPieces) {
	game.gameOver = false;
	game.drawScreen = function () { return }; // DRAW NOTHING UNTIL THE NEW BOARD IS IN (THE OLD ONE STAYS ON THE CANVAS)
	await setInitialData(); // GETS THE NEW BOARD & PLAYER COLOR FROM THE DATABASE
	handleInitialData(); // NEW drawScreen FOR THE (MAYBE NEW) PLAYER COLOR
	setRestartLoading(1); // FULL
	await new Promise(function (resolve) { setTimeout(resolve, 200); }); // THE FILL REACHES THE END
	menu.style.display = "none"
	optResumeBtn.parentElement.style.display = 'flex'; // RESUME COMES BACK (IT'S HIDDEN WHEN A GAME IS OVER)
	resultDisplay.innerText = "Chess"
	await refreshData(game.response); // ALSO SETS menuToggled TO FALSE
	game.opposingMove = true; // LOCKED WHILE THE PIECES SLIDE HOME (drawRestartSlide UNLOCKS IT)
	startRestartSlide(fromPieces);
}

/* ---------------------------------------------------------------- */
// Restart Loading (Restart & Rematch)
/* ---------------------------------------------------------------- */
/**
 * @description Restart (Rematch in friend games) says Loading & fills up from the left while the new board loads
 * (.loading IN nav.css), like the Home button. false puts the button back
 * @param  {[number]} load [how full, 0 - 1, it only fills up. false = done or failed]
 */
export function setRestartLoading(load) { // EXPORTED FOR gameplay/animate/index.js (THE SLIDE HOME PUTS THE BUTTON BACK)
	if (load === false) { // DONE OR FAILED
		optRestartBtn.classList.remove("loading");
		optRestartBtn.style.removeProperty("--load");
		optRestartBtn.innerHTML = game.ai ? "Restart" : "Forfeit";
		return;
	}
	if (!optRestartBtn.classList.contains("loading")) { // FIRST CALL
		optRestartBtn.innerHTML = "Loading";
		optRestartBtn.classList.add("loading");
		setTimeout(function () { if (game.boardReset) { setRestartLoading(load); } }, 50); // FROM EMPTY (THE FILL IS DRAWN FIRST)
		return;
	}
	if (load > (Number(optRestartBtn.style.getPropertyValue("--load")) || 0)) { optRestartBtn.style.setProperty("--load", load); }
}


/* ---------------------------------------------------------------- */
// Forfeit / Rematch Button (Menu, friend games)
/* ---------------------------------------------------------------- */
/**
 * @description Game going: Forfeit -> "Are you sure?" -> forfeits. Game over: Rematch, starts when both players press it within 1 minute
 */
async function handleFriendBtn() {
	if (!game.gameOver) {
		if (!confirmForfeit) { // FIRST PRESS ASKS, THE QUESTION GOES AWAY AFTER 5 SECONDS
			confirmForfeit = true;
			optRestartBtn.innerHTML = "Are you sure?";
			setTimeout(function () { if (confirmForfeit && !game.gameOver) { confirmForfeit = false; optRestartBtn.innerHTML = "Forfeit"; } }, 5000);
			return;
		}
		confirmForfeit = false;
		const forfeitResponse = await forfeitGame(game.GAME_URL, game.GAME_ID);
		if (forfeitResponse?.state == "CLOSED") { return showGameOver(forfeitResponse); }
		optRestartBtn.innerHTML = "Forfeit"; // FORFEIT FAILED, KEEP PLAYING
		return;
	}
	if (rematchWaiting) { return; } // ALREADY ASKED, STILL WAITING
	const rematchResponse = await rematchGame(game.GAME_URL, game.GAME_ID);
	if (rematchResponse?.status == 409) { return optRestartBtn.innerHTML = "Can't rematch"; } // ONE OF YOU IS IN ANOTHER FRIEND GAME
	if (rematchResponse?.new_game_id) { return await loadRematch(rematchResponse.new_game_id); } // OPPONENT WAS ALREADY WAITING
	if (rematchResponse?.waiting) { // WAIT 1 MINUTE FOR THE OPPONENT
		optRestartBtn.innerHTML = "Waiting...";
		rematchWaiting = setTimeout(function () { rematchWaiting = false; optRestartBtn.innerHTML = "Rematch"; }, rematchResponse.expires_in);
	}
}

/* ---------------------------------------------------------------- */
// Game Over
/* ---------------------------------------------------------------- */
/**
 * @description Locks the board & opens the menu with the server's result. AI games offer Restart, friend games offer Rematch
 * @param  {[object]} result [{ winner: "w" | "b" | "draw", reason }]
 */
function showGameOver(result) {
	if (game.gameOver) { return; } // ALREADY SHOWN
	game.gameOver = true;
	game.opposingMove = true; // NO MORE MOVES
	game.menuToggled = true;
	menu.style.display = "flex"
	optResumeBtn.parentElement.style.display = 'none';
	if (result?.reason == "forfeit") { resultDisplay.innerText = result.winner == 'w' ? "Black Forfeits" : "White Forfeits" } // THE TITLE ONLY FITS ONE LINE
	else if (result?.winner == 'w') { resultDisplay.innerText = "White Wins!" }
	else if (result?.winner == 'b') { resultDisplay.innerText = "Black Wins!" }
	else { resultDisplay.innerText = "Draw" }
	if (!game.ai) { optRestartBtn.innerHTML = "Rematch"; } // FRIEND GAME
	handleRemoteMenuEnter(optRestartBtn); // TV REMOTE: SELECT RESTART / REMATCH
}

/* ---------------------------------------------------------------- */
// Load Rematch
/* ---------------------------------------------------------------- */
/**
 * @description Both players asked for a rematch: loads the new game in place (the server picked the sides). The old board
 * stays on screen & Rematch says Loading while it loads, then the pieces slide home (to the other side if the sides swapped)
 * @param  {[string]} newGameId [rematch game id, from the request or the socket]
 */
async function loadRematch(newGameId) {
	if (!newGameId || `${newGameId}` == `${game.GAME_ID}`) { return; } // ALREADY LOADED (THE REQUEST & THE SOCKET BOTH SEND IT)
	const fromPieces = getRestartPieces(true); // WHERE THE PIECES ARE NOW, THEY SLIDE HOME FROM HERE
	game.GAME_ID = newGameId;
	history.replaceState(null, "", `/play/${game.GAME_ID}`); // THE URL FOLLOWS THE REMATCH
	clearTimeout(rematchWaiting); // STOP THE 1 MINUTE WAIT
	rematchWaiting = false;
	game.boardReset = true; // STOP DRAWING, THE OLD BOARD STAYS ON SCREEN WHILE THE NEW ONE LOADS
	game.refresh = false;
	optBtn.style.display = "none"
	setRestartLoading(0.5); // "Loading" & THE FILL (THE MENU IS OPEN AFTER A GAME ENDS), "Forfeit" WHEN THE SLIDE IS DONE
	joinGame(game.GAME_ID, game.PLAYER_ID, socketHandlers); // NEW GAME'S ROOM
	await loadNewBoard(fromPieces);
}

/* ---------------------------------------------------------------- */
// Homepage Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Goes to Home (/). Stops the render loop & leaves the friend game's socket room first,
 * the page load clears everything else (listeners, canvas). Home says Loading & fills up like the buttons into a game,
 * then the game stays on screen until Home is drawn & fades into it (home.html, showPage in pages/utils)
 */
export function handleHomepage(e) { // EXPORTED FOR gameplay/input/index.js
	e.preventDefault();
	e.stopPropagation();

	window.clearInterval(game.drawInterval); // STOP THE RENDER LOOP
	leaveGame();
	optHomepageBtn.innerText = "Loading";
	optHomepageBtn.classList.add("loading"); // THE FILL (.loading IN nav.css), ONE PRESS
	setTimeout(function () { optHomepageBtn.style.setProperty("--load", 1); }, 50); // FROM EMPTY (THE FILL IS DRAWN FIRST)
	setTimeout(function () { window.location.href = "/"; }, 250); // HOME ONCE IT'S FULL (server/routes/pageRoutes.js)
}

/* ---------------------------------------------------------------- */
// Exit Button (Menu)
/* ---------------------------------------------------------------- */
/**
 * @description Exits game: a signed in player logs out, a guest logs in (the server's auth routes, server/routes/api/authRoutes.js)
 */
export function handleExit(e) { // EXPORTED FOR gameplay/input/index.js
	e.preventDefault();
	e.stopPropagation();
	window.location.href = game.SIGNED_IN ? "/api/auth/logout" : "/api/auth/login";
}