/*
 *  index.js  --  chess frontend
 *	Input
 *	The board's controls: the mouse (hover, click to pick up & put down, drag & drop), touch on phones (tap & drag, mapped onto
 *	the mouse handlers) & the TV remote (arrow keys move a select box, enter clicks, right from the last column reaches the menu).
 *	startGame (gameplay/index.js) adds their listeners
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, canvas, validateState, OVERRIDE_TV } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE CANVAS, THE SCRATCH BOARD, TV REMOTE FOR TESTING
const { playerMove } = require("../user/index.js"); // TURNS A DROPPED TILE INTO A { from, to, promotion } MOVE
const { validateMove, refreshData } = require("../moves/index.js"); // SENDS THE PLAYER'S MOVE, RESETS THE BOARD TO A SERVER GAME
const { handleMenuBtn, handleResume, handleSound, handleRestart, handleHomepage, handleExit } = require("../menu/index.js"); // THE MENU BUTTONS (THE TV REMOTE PRESSES THEM)
const optBtn = document.getElementById("optBtn"); // MENU BUTTON (3 LINES, TOP RIGHT), OPENS THE MENU
const optResumeBtn = document.getElementById("optResume"); // MENU: RESUME
const optSoundBtn = document.getElementById("optSound"); // MENU: SOUND ON / OFF
const optRestartBtn = document.getElementById("optRestart"); // MENU: RESTART (AI GAMES) / FORFEIT & REMATCH (FRIEND GAMES)
const optHomepageBtn = document.getElementById("optSettings"); // MENU: HOMEPAGE
const optExitBtn = document.getElementById("optExit"); // MENU: EXIT

let offBoardRefresh = true; // REDRAW WHEN THE MOUSE LEAVES THE BOARD (CLEARS HOVER EFFECTS)
let touchState = null; // ACTIVE TOUCH (MOBILE): { id, startX, startY, dragging, point }
let remoteNavBox = { x: 7, y: 0, menuHover: false, menuBtn: false } // TV REMOTE SELECT BOX: SQUARE (x, y), ON THE MENU BUTTON (menuHover) & THE SELECTED MENU BUTTON
const touchDragThreshold = 10; // PX A FINGER MUST MOVE BEFORE A TAP BECOMES A DRAG
let audioUnlocked = false; // THE MOVE SOUND WAS UNLOCKED BY A TAP (IOS)

/* ---------------------------------------------------------------- */
// Handle Remote Nav Button Hover
/* ---------------------------------------------------------------- */
/**
 * @description Changes current button effect when keydown is handled. TV remote: moves the menu highlight from the
 * selected button to btn, hidden buttons are skipped
 * @param  {[object]} btn [menu button element]
 */
function handleRemoteNavBtnHover(btn) {
	if (btn.parentElement.style.display != "none") { // SKIP HIDDEN BUTTONS (RESUME IS HIDDEN WHEN THE GAME IS OVER)
		remoteNavBox.menuBtn.style.transition = "ease-out 375ms";
		remoteNavBox.menuBtn.style.backgroundColor = "#CD853F";
		remoteNavBox.menuBtn = btn;
		remoteNavBox.menuBtn.style.transition = "ease-in 375ms"
		remoteNavBox.menuBtn.style.backgroundColor = "burlywood"
	}
}

/* ---------------------------------------------------------------- */
// Handle Remote Menu Enter
/* ---------------------------------------------------------------- */
/**
 * @description Handles menu button style when clicked with remote select box. TV remote: the menu opened, so btn
 * becomes the selected (highlighted) menu button & the menu button goes back to its normal color
 * @param  {[object]} btn [menu button element]
 */
export function handleRemoteMenuEnter(btn) {
	if (game.TV_BOOL) { optBtn.style.transition = "ease-out 375ms"; optBtn.style.color = "burlywood"; }
	if (game.TV_BOOL || OVERRIDE_TV) { remoteNavBox.menuHover = false; remoteNavBox.menuBtn = btn; remoteNavBox.menuBtn.style.transition = "ease-in 375ms"; remoteNavBox.menuBtn.style.backgroundColor = "burlywood" }
}

/* ---------------------------------------------------------------- */
// Handle Keydown
/* ---------------------------------------------------------------- */
/**
 * @description Handles Keydown events. TV remote: the arrows move the select box (remoteNavBox) around the board, right
 * from the last column moves it onto the menu button & up / down move between menu buttons. Enter clicks the square
 * (handleCanvasClick), opens the menu or presses the selected menu button
 */
export async function handleKeyPress(e) {
	e.preventDefault();
	e.stopPropagation();
	if (!e?.repeat && e?.keyCode) { // HOLDING A KEY DOESN'T REPEAT
		/**
		 * @description Hovers the player's piece under the select box (the remote's version of handleMouseMove)
		 */
		function checkBoxOverPiece() {
			for (let i = 0; i < game.tiles.length; i++) {
				let tile = game.tiles[i];
				tile.isHovering = false;
				tile.isHovering = (!tile.isSliding) && (remoteNavBox.x == tile.originX && remoteNavBox.y == tile.originY) && ((tile.color == game.playerColor || !tile.color)) && (!game.opposingMove && !game.menuToggled)
			}
		}

		if (e.keyCode == 37) { // LEFT
			if (remoteNavBox.x > 0 && !game.menuToggled) {
				if (remoteNavBox.menuHover) {
					if (game.TV_BOOL) { optBtn.style.transition = "ease-out 375ms"; optBtn.style.color = "burlywood"; }
					remoteNavBox.menuHover = false;
				} else {
					remoteNavBox.x -= 1;
				}
				game.refresh = true;
			}
			else { game.refresh = true; }
			checkBoxOverPiece();
		}

		if (e.keyCode == 39) { // RIGHT
			if (remoteNavBox.x < 7 && !game.menuToggled) {
				remoteNavBox.x += 1;
				game.refresh = true;
			}
			else if (remoteNavBox.x == 7 && !game.menuToggled) { // PAST THE LAST COLUMN: SELECT THE MENU BUTTON
				remoteNavBox.y = 0;
				remoteNavBox.menuHover = true;
				if (game.TV_BOOL) { optBtn.style.transition = "ease-in 375ms"; optBtn.style.color = "white"; }
			}

			else { game.refresh = true; }
			checkBoxOverPiece();
		}

		if (e.keyCode == 38) { // UP
			if (remoteNavBox.y > 0 && (!remoteNavBox.menuHover && !game.menuToggled)) { remoteNavBox.y -= 1; game.refresh = true; }
			else if (game.menuToggled) {
				if (remoteNavBox.menuBtn == optExitBtn) { handleRemoteNavBtnHover(optHomepageBtn) } // 5 -> 4
				else if (remoteNavBox.menuBtn == optHomepageBtn) { handleRemoteNavBtnHover(optRestartBtn) } // 4 -> 3
				else if (remoteNavBox.menuBtn == optRestartBtn) { handleRemoteNavBtnHover(optSoundBtn) } // 3 -> 2
				else if (remoteNavBox.menuBtn == optSoundBtn) { handleRemoteNavBtnHover(optResumeBtn) } // 2 -> 1
			}
			else { game.refresh = true; }
			checkBoxOverPiece();
		}
		if (e.keyCode == 40) { // DOWN
			if (remoteNavBox.y < 7 && (!remoteNavBox.menuHover && !game.menuToggled)) { remoteNavBox.y += 1; game.refresh = true; }
			else if (game.menuToggled) {
				if (remoteNavBox.menuBtn == optResumeBtn) { handleRemoteNavBtnHover(optSoundBtn) } // 1 -> 2
				else if (remoteNavBox.menuBtn == optSoundBtn) { handleRemoteNavBtnHover(optRestartBtn) } // 2 -> 3
				else if (remoteNavBox.menuBtn == optRestartBtn) { handleRemoteNavBtnHover(optHomepageBtn) } // 3 -> 4
				else if (remoteNavBox.menuBtn == optHomepageBtn) { handleRemoteNavBtnHover(optExitBtn) } // 4 -> 5
			}
			else { game.refresh = true; }
			checkBoxOverPiece();
		}
		if (e.keyCode == 13) { // ENTER
			if (!remoteNavBox.menuHover && !game.menuToggled) { checkBoxOverPiece(); handleCanvasClick(e); } // CLICK THE SELECTED SQUARE
			else if (remoteNavBox.menuHover && !game.menuToggled) { handleMenuBtn(e); handleRemoteMenuEnter(optResumeBtn); } // OPEN THE MENU ON RESUME
			else if (game.menuToggled && remoteNavBox.menuBtn == optSoundBtn) { handleSound(e); } // THE MENU STAYS OPEN & SOUND STAYS SELECTED
			else if (game.menuToggled && remoteNavBox.menuBtn) { // PRESS THE SELECTED MENU BUTTON, THEN THE SELECT BOX GOES BACK TO THE TOP RIGHT
				remoteNavBox.menuBtn.style.backgroundColor = "#CD853F"
				if (remoteNavBox.menuBtn == optResumeBtn) { handleResume(e); }
				else if (remoteNavBox.menuBtn == optRestartBtn) { handleRestart(e); }
				else if (remoteNavBox.menuBtn == optHomepageBtn) { handleHomepage(e) }
				else if (remoteNavBox.menuBtn == optExitBtn) { handleExit(e) }
				remoteNavBox = { x: 7, y: 0, menuHover: false, menuBtn: false }
			}
		}
		game.refresh = true
	}
}

/* ---------------------------------------------------------------- */
// Get Canvas Point
/* ---------------------------------------------------------------- */
/**
 * @description Converts viewport coordinates to canvas coordinates (mobile browser toolbars can offset the canvas)
 * @param  {[object]} e [mouse event, or a touch made to look like one]
 * @return {[object]} { x, y } [position on the canvas]
 */
function getCanvasPoint(e) {
	const rect = canvas.getBoundingClientRect();
	return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

/* ---------------------------------------------------------------- */
// On Click
/* ---------------------------------------------------------------- */
/**
 * @description If piece is clicked, based on new positions or if piece is set back in original position, etc...
 * While promoting, a click on a piece in the picker finishes the move. Otherwise a click on the player's piece picks it up
 * (or puts it back down on its own square), a click on another square slides the picked up piece there & a dragged piece
 * is dropped where it's let go. Mouse up, touch end & the TV remote's enter all end up here
 */
export async function handleCanvasClick(e) {
	e.preventDefault();
	e.stopPropagation();
	const point = getCanvasPoint(e);
	game.tileX = Math.floor((point.x - game.xBoardOff) / game.tileWidth); // SCREEN COLUMN CLICKED
	game.tileY = Math.floor((point.y - game.yBoardOff) / game.tileHeight); // SCREEN ROW CLICKED

	if (e.clientX === undefined && remoteNavBox) { // KEYBOARD (TV REMOTE) ENTER HAS NO POINTER POSITION
		game.tileX = remoteNavBox.x; game.tileY = remoteNavBox.y;
	}

	if (game.currPromotion) { // IF PROMOTION IS TRUE LOOK FOR USER TO CLICK ON TAKEN PIECES TO UPDATE BOARD
		game.revert = game.response;
		let takenPieces // THE PICKER (drawScreen PUTS IT IN THIS LIST WHILE PROMOTING)
		if (game.playerColor == 'w') { takenPieces = game.bTakenPieces }
		else if (game.playerColor == 'b') { takenPieces = game.wTakenPieces }
		for (let i = 0; i < takenPieces.length; i++) {
			let takenPiece = takenPieces[i];
			if (((takenPiece.x === game.tileX && takenPiece.y === game.tileY && (takenPiece.color == game.playerColor || !takenPiece.color))) && takenPiece.type && takenPiece.color == game.playerColor) { // CLICKED THIS PIECE IN THE PICKER
				const promotion = takenPiece.type;
				try { // TEST MOVE CLIENT SIDE TO JUSTIFY SERVER CALL
					game.moveObj.promotion = promotion;
					game.currPromotion = false;
					await validateMove();
				} catch (err) { console.log(err); game.opposingMove = false; return refreshData(game.revert); }
			}
		}
	} else if (!game.currSlide) {
		game.revert = game.response;
		for (let i = 0; i < game.tiles.length; i++) {
			let tile = game.tiles[i];
			if (tile.isHovering && tile.type && tile.color == game.playerColor) { // DRAG AND DROP && IF HOVER IS TRUE
				if (tile.isClicked && game.tileX == tile.originX && game.tileY == tile.originY) { // IF TILE IS CLICKED AND SET BACK IN ORIGINAL POSITION
					tile.isClicked = false;
					game.clickedTile = false;
					game.mousedownTile = false;
					game.refresh = true;
					return;
				}

				if (tile.isClicked && tile.color == game.playerColor && (game.tileX != tile.originX || game.tileY != tile.originY)) { // IF PIECE IS CLICKED AND SET IN A NEW POSITION
					try { // TEST MOVE CLIENT SIDE TO JUSTIFY SERVER CALL
						game.moveObj = playerMove(game.playerColor, tile); // { from, to } FROM WHERE IT WAS DROPPED
						if (game.moveObj.promotion) { game.currPromotion = true; game.refresh = true; return; } // PAWN ON THE LAST RANK: OPEN THE PICKER
						tile.isClicked = false;
						game.clickedTile = false;
						game.mousedownTile = false;
						game.opposingMove = true;
						game.refresh = true;
						return await validateMove(); // DROPPED, SO NO SLIDE: SEND IT NOW
					} catch (err) {
						console.log(err);
						game.opposingMove = false;
						return refreshData(game.revert);
					}
				}

				tile.isClicked = true; // PICK IT UP
				game.clickedTile = tile;
				game.refresh = true;
			} else if (!tile.isHovering && (tile.isClicked && tile.color == game.playerColor && (game.tileX != tile.originX || game.tileY != tile.originY))) { // CLICK PIECE WHILE MAINTAINING POSITION
				try {
					for (let z = 0; z < game.tiles.length; z++) { game.tiles[z].isClicked = false; game.clickedTile = false; }
					for (let j = 0; j < game.tiles.length; j++) { // CLICKED ANOTHER OF THE PLAYER'S PIECES: PICK THAT ONE UP INSTEAD
						if ((game.tiles[j].isHovering && game.tiles[j].x == game.tileX && game.tiles[j].y == game.tileY) && game.tiles[j].color == game.playerColor) {
							game.tiles[j].isClicked = true
							game.clickedTile = game.tiles[j];
							game.refresh = true;
							return;
						}
					}
					tile.x = game.tileX; // CLICKED A SQUARE: SLIDE THE PICKED UP PIECE THERE (THE MOVE IS SENT WHEN IT LANDS)
					tile.y = game.tileY;
					game.moveObj = playerMove(game.playerColor, tile);
					validateState.load(game.response.game_board);
					validateState.move(game.moveObj); // CHECK MOVE WITHOUT UPDATING THE BOARD SO THE DRAWSCREEN FUNCTION CAN OPERATE WITH THE PREVIOUS MOVE WHILE CHECKING IF THE MOVE IS ALLOWED
					game.currSlide = true;
					game.slideStart = true;
					tile.isSliding = true;
					tile.xSlideTo = game.tileX;
					tile.ySlideTo = game.tileY;
					tile.xDiff = 0;
					tile.yDiff = 0;
					tile.slideStartTime = null; // ITS CLOCK STARTS ON ITS FIRST FRAME (stepSlide)
					for (let j = 0; j < game.tiles.length; j++) { game.tiles[j].isClicked = false; game.tiles[j].isMousedown = false }
					game.clickedTile = false;
					game.mousedownTile = false;
					game.opposingMove = true;
					game.refresh = true;

					return;
				} catch (err) { console.log(err); game.clickedTile = false; game.opposingMove = false; return refreshData(game.revert); }
			}
		}
	}
};

/* ---------------------------------------------------------------- */
// On Mouse Move (hover)
/* ---------------------------------------------------------------- */
/**
 * @description Conditializes hover of piece based on color. Tracks the square under the mouse (tileX, tileY, a held piece
 * follows it) & sets isHovering on the player's piece under it, or on the promotion picker while promoting.
 * Asks for a new frame when the hover changes
 */
export function handleMouseMove(e) {
	e.preventDefault();
	e.stopPropagation();
	// IF PIECE IS CLICK TO BE MOVED MOUSE POSITION
	const point = getCanvasPoint(e);
	game.tileX = Math.floor((point.x - game.xBoardOff) / game.tileWidth); // SCREEN COLUMN (OFF THE BOARD IS BELOW 0 OR ABOVE 7)
	game.tileY = Math.floor((point.y - game.yBoardOff) / game.tileHeight); // SCREEN ROW
	if (!((game.tileX < 0 || game.tileX > 7) && (game.tileY < 0 || game.tileY > 7))) { // MOUSE INSIDE THE BOARD (OR BESIDE IT, WHERE THE TRAYS ARE)
		if (game.currPromotion) { // HOVER THE PICKER
			let takenPieces
			if (game.playerColor == 'w') { takenPieces = game.bTakenPieces }
			else if (game.playerColor == 'b') { takenPieces = game.wTakenPieces }
			for (let i = 0; i < takenPieces.length; i++) {
				let takenPiece = takenPieces[i];
				takenPiece.isHovering = (((takenPiece.x === game.tileX && takenPiece.y === game.tileY && (takenPiece.color == game.playerColor || !takenPiece.color)))) && !game.menuToggled
				if (takenPiece.isHovering || takenPiece.isClicked) { game.refresh = true; offBoardRefresh = true; }
				if (takenPiece.color != game.playerColor && takenPiece.color) { game.refresh = true }
			}
		} else { // HOVER THE PLAYER'S PIECE UNDER THE MOUSE (ONLY ON THEIR TURN, WITH THE MENU CLOSED)
			for (let i = 0; i < game.tiles.length; i++) {
				let tile = game.tiles[i];
				tile.isHovering =
					(!tile.isSliding) &&
					(tile.x === game.tileX && tile.y === game.tileY) &&
					((tile.color == game.playerColor || !tile.color) || tile.isMousedown) &&
					(!game.opposingMove && !game.menuToggled)
				if (tile.isHovering || tile.isClicked) { game.refresh = true; offBoardRefresh = true; }
				if (tile.color != game.playerColor && tile.color) { game.refresh = true }
			}
		}
	}
	if (game.tileX < 0 || game.tileX > 7 || game.tileY < 0 || game.tileY > 7) { // MOUSE OUTSIDE THE BOARD
		if (offBoardRefresh) { game.refresh = true }
	}
}

/* ---------------------------------------------------------------- */
// Mouse Down
/* ---------------------------------------------------------------- */
/**
 * @description Sets positions / tracks user mousedown drag. Starts a drag on the player's hovered piece (the render loop
 * makes it a drag after 3 frames). If another piece was picked up by a click, that one is put down instead
 */
export async function handleMouseDown(e) {
	e.preventDefault();
	e.stopPropagation();
	const point = getCanvasPoint(e);
	game.tileX = Math.floor((point.x - game.xBoardOff) / game.tileWidth);
	game.tileY = Math.floor((point.y - game.yBoardOff) / game.tileHeight); // IF HOVER IS TRUE
	for (let i = 0; i < game.tiles.length; i++) {
		let tile = game.tiles[i];
		if ((tile.isHovering && tile.type && tile.color == game.playerColor)) { // GRAB THE HOVERED PIECE
			tile.isMousedown = true;
			game.mousedownTile = tile;
			game.mouseDownTime = null;
			for (let j = 0; j < game.tiles.length; j++) { // A DIFFERENT PIECE WAS PICKED UP: PUT IT DOWN
				if (game.tiles[j].isClicked && (game.tiles[j].x != game.tileX || game.tiles[j].y != game.tileY) && game.tiles[j].color == game.playerColor) {
					game.tiles[j].isClicked = false
					game.clickedTile = false;
					game.refresh = true;
					return
				}
			}
		}
	}
};

/* ---------------------------------------------------------------- */
// Mouse Up
/* ---------------------------------------------------------------- */
/**
 * @description Sets positions based on mouse up event position. Lets go of the held piece. The click event comes right
 * after & handleCanvasClick() drops it on the square (a drag) or keeps it picked up (a quick click)
 */
export async function handleMouseUp(e) {
	e.preventDefault();
	e.stopPropagation();
	const point = getCanvasPoint(e);
	game.tileX = Math.floor((point.x - game.xBoardOff) / game.tileWidth);
	game.tileY = Math.floor((point.y - game.yBoardOff) / game.tileHeight); // IF HOVER IS TRUE
	for (let i = 0; i < game.tiles.length; i++) {
		let tile = game.tiles[i];
		if (tile.isMousedown && tile.isHovering && tile.type && tile.color == game.playerColor) { // LET GO OF THE HELD PIECE
			tile.isMousedown = false;
			game.mousedownTile = false;
			game.tileX = tile.originX
			game.tileY = tile.originY
			game.refresh = true;
		}
	}
}

/* ---------------------------------------------------------------- */
// Touch (Mobile)
/* ---------------------------------------------------------------- */
/**
 * @description Maps touch input onto the mouse handlers so pieces can be tapped or dragged on mobile browsers
 */

function touchToMouseEvent(touch) { // A TOUCH WITH THE FIELDS THE MOUSE HANDLERS USE
	return { clientX: touch.clientX, clientY: touch.clientY, preventDefault() { }, stopPropagation() { } };
}

function findActiveTouch(touchList) { // THE FINGER THAT STARTED (touchState.id), OTHER FINGERS ARE IGNORED
	for (let i = 0; i < touchList.length; i++) { if (touchList[i].identifier == touchState.id) { return touchList[i]; } }
	return null;
}

function unlockAudio() { // IOS ONLY PLAYS AUDIO STARTED BY A USER GESTURE, PLAY MUTED ONCE SO LATER MOVE SOUNDS (AI / OPPONENT) CAN PLAY
	if (audioUnlocked) { return; }
	audioUnlocked = true;
	game.moveAudio.muted = true;
	game.moveAudio.play().then(() => { game.moveAudio.pause(); game.moveAudio.currentTime = 0; game.moveAudio.muted = false; }).catch(() => { game.moveAudio.muted = false; });
}

export function handleTouchStart(e) { // FINGER DOWN = HOVER + MOUSE DOWN
	e.preventDefault(); // STOPS SCROLL / ZOOM & THE BROWSER'S EMULATED MOUSE EVENTS
	if (touchState) { return; } // IGNORE EXTRA FINGERS
	const touch = e.changedTouches[0];
	const point = touchToMouseEvent(touch);
	touchState = { id: touch.identifier, startX: touch.clientX, startY: touch.clientY, dragging: false, point };
	handleMouseMove(point); // TOUCH HAS NO HOVER, SO SET IT BEFORE MOUSEDOWN
	handleMouseDown(point);
}

export function handleTouchMove(e) { // FINGER MOVES = MOUSE MOVE, ONCE IT'S MOVED FAR ENOUGH TO BE A DRAG
	e.preventDefault();
	if (!touchState) { return; }
	const touch = findActiveTouch(e.changedTouches);
	if (!touch) { return; }
	touchState.point = touchToMouseEvent(touch);
	if (!touchState.dragging && Math.hypot(touch.clientX - touchState.startX, touch.clientY - touchState.startY) < touchDragThreshold) { return; } // SMALL FINGER JITTER IS STILL A TAP
	touchState.dragging = true;
	handleMouseMove(touchState.point);
}

export function handleTouchEnd(e) { // FINGER UP = MOUSE UP + CLICK
	e.preventDefault();
	if (!touchState) { return; }
	const touch = findActiveTouch(e.changedTouches);
	if (!touch) { return; }
	const point = touchToMouseEvent(touch);
	const dragging = touchState.dragging;
	touchState = null;
	unlockAudio();
	handleMouseMove(point);
	if (dragging) { // DROP THE DRAGGED PIECE ON THE RELEASE TILE (THE RENDER LOOP ONLY DOES THIS ON ITS NEXT FRAME)
		for (let i = 0; i < game.tiles.length; i++) {
			if (game.tiles[i].isMousedown && game.tiles[i].color == game.playerColor) { game.tiles[i].x = game.tileX; game.tiles[i].y = game.tileY; game.tiles[i].isClicked = true; }
		}
		handleMouseMove(point);
	}
	handleMouseUp(point);
	handleCanvasClick(point);
}

export function handleTouchCancel() { // THE BROWSER TOOK THE TOUCH (A SYSTEM GESTURE): LET GO WITHOUT A CLICK
	if (!touchState) { return; }
	handleMouseUp(touchState.point);
	touchState = null;
}
