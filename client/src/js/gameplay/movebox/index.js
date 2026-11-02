/*
 *  index.js  --  chess frontend
 *	Move Box
 *	Plays a typed move like e4, Nf3, exd5 or e8=Q (#moveBox on the play page, HTML over the canvas). The / key or the menu's
 *	Type a Move opens it, chess.js reads the move on the scratch board & it slides like a clicked move, validateMove() sends it
 *	when it lands (sound & server check as usual). It stays closed until it's asked for, a phone's keyboard resizes the window
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, chessInst, validateState, fillTiles } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE BOARD THAT'S DRAWN, THE SCRATCH BOARD
const { refreshData } = require("../moves/index.js"); // RESETS THE BOARD TO A SERVER GAME
const { closeMenu } = require("../menu/index.js"); // THE MENU'S TYPE A MOVE CLOSES THE MENU
const box = document.getElementById("moveBox"); // THE FORM
const input = document.getElementById("moveBoxInput"); // WHERE THE MOVE IS TYPED
const refusal = document.getElementById("moveBoxRefusal"); // WHY A MOVE WAS REFUSED, NEXT TO THE INPUT
const closeBtn = document.getElementById("moveBoxClose"); // CLOSES IT (PHONES HAVE NO ESCAPE KEY)
const optBtn = document.getElementById("optBtn"); // MENU BUTTON (3 LINES, TOP RIGHT)
const optTypeMoveBtn = document.getElementById("optTypeMove"); // MENU: TYPE A MOVE

/* ---------------------------------------------------------------- */
// Open & Close
/* ---------------------------------------------------------------- */
/**
 * @description Opens the box & puts the cursor in it. On a phone this is what brings up the keyboard, so it only happens when asked for
 */
function openMoveBox() {
	box.hidden = false;
	input.focus();
}

/**
 * @description Closes the box & clears what was typed
 */
function closeMoveBox() {
	box.hidden = true;
	input.value = "";
	refusal.textContent = "";
}

/* ---------------------------------------------------------------- */
// Play The Move
/* ---------------------------------------------------------------- */
/**
 * @description Why the typed move can't be played, read on the scratch board
 * @param  {[string]} text [the typed move, non-strict chess.js also takes e2e4]
 * @return {[object]} { move, reason } [move = chess.js's move when it can be played, reason = what the player reads when it can't]
 */
function readTypedMove(text) {
	if (game.gameOver) { return { reason: "The game is over" }; }
	if (game.opposingMove || game.boardReset || chessInst.turn() != game.playerColor) { return { reason: "Not your turn" }; } // opposingMove IS ALSO ON DURING THE PLAYER'S OWN SLIDE
	let move;
	try {
		validateState.load(game.response.game_board);
		move = validateState.move(text); // THROWS IF IT'S NOT LEGAL
	} catch { return { reason: "Illegal move" }; }
	if (move.promotion && !/[qrbn][+#]?$/i.test(text)) { return { reason: `Add the piece, like ${move.to}=Q` }; } // chess.js PICKS A KNIGHT FOR e7e8
	return { move };
}

/**
 * @description Starts the slide of the piece on moveObj.from, updateUserStateSlide() sends the move when it lands
 */
function startTypedSlide() {
	const { from, to } = game.moveObj;
	fillTiles();
	for (let i = 0; i < game.tiles.length; i++) {
		if (game.tiles[i].square != from) { continue; }
		game.tiles[i].isSliding = true;
		if (game.viewColor == 'w') { // SCREEN COLUMN & ROW OF to (a8 IS 0, 0)
			game.tiles[i].xSlideTo = to.charCodeAt(0) - 97;
			game.tiles[i].ySlideTo = 8 - to[1];
		} else { // FLIPPED BOARD (h1 IS 0, 0)
			game.tiles[i].xSlideTo = 7 - (to.charCodeAt(0) - 97);
			game.tiles[i].ySlideTo = to[1] - 1;
		}
		game.tiles[i].xDiff = 0;
		game.tiles[i].yDiff = 0;
		game.tiles[i].slideStartTime = null; // ITS CLOCK STARTS ON ITS FIRST FRAME (stepSlide)
	}
	game.slideStart = true;
	game.opposingMove = true; // LOCK THE BOARD
	game.currSlide = true;
	game.refresh = true;
}

/**
 * @description Enter (or a phone keyboard's Go): plays the typed move or says why it can't. A piece that was picked up or
 * an open promotion picker goes back first, the typed move replaces them
 */
function handleSubmit(e) {
	e.preventDefault();
	const text = input.value.trim();
	if (!text) { return; }
	const { move, reason } = readTypedMove(text);
	if (!move) { refusal.textContent = reason; return; }
	if (game.clickedTile || game.mousedownTile || game.currPromotion) { refreshData(game.response); }
	game.moveObj = { from: move.from, to: move.to, promotion: move.promotion, typed: true }; // typed: THE PIECE IS ALREADY CHOSEN, NO PICKER WHEN IT LANDS
	closeMoveBox();
	startTypedSlide();
}

/* ---------------------------------------------------------------- */
// Listeners
/* ---------------------------------------------------------------- */
/**
 * @description The / key opens the box. Not added to handleKeyPress(), that's only on in TV mode
 */
function handleOpenKey(e) {
	if (e.key != "/" || e.repeat || e.ctrlKey || e.metaKey || e.altKey || game.menuToggled) { return; }
	e.preventDefault(); // THE / ISN'T TYPED INTO THE BOX (& FIREFOX'S QUICK FIND STAYS CLOSED)
	e.stopPropagation();
	openMoveBox();
}

/**
 * @description Keys typed in the box stay in the box, so they don't reach the / key's listener or move the TV select box. Escape closes it
 */
function handleBoxKey(e) {
	e.stopPropagation();
	if (e.key == "Escape") { closeMoveBox(); }
}

/**
 * @description The menu's Type a Move, the menu stays open when it can't close (game over or a new board loading)
 */
function handleTypeMoveBtn(e) {
	e.preventDefault();
	e.stopPropagation();
	closeMenu();
	if (!game.menuToggled) { openMoveBox(); }
}

/**
 * @description Adds the box's listeners, startGame (gameplay/index.js) calls this once the game has loaded
 */
export function addMoveBoxListeners() {
	document.addEventListener("keydown", handleOpenKey);
	box.addEventListener("keydown", handleBoxKey);
	box.addEventListener("submit", handleSubmit);
	input.addEventListener("input", function () { refusal.textContent = ""; });
	closeBtn.addEventListener("click", closeMoveBox);
	optBtn.addEventListener("click", closeMoveBox); // THE MENU OPENS OVER IT
	optTypeMoveBtn.addEventListener("click", handleTypeMoveBtn);
}
