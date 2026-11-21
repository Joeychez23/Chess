/*
 *  index.js  --  chess frontend
 *	Input
 *	The board's controls: the mouse (hover, click to pick up & put down, drag & drop), touch on phones (tap & drag, mapped onto
 *	the mouse handlers) & remote-only mode (arrow keys or W, A, S & D move a select box, enter clicks, right from the last column reaches the menu).
 *	startGame (gameplay/index.js) adds their listeners to both boards. The only thing that differs on the 3D board is the square under
 *	the pointer (pointerTile), camera gestures there never reach the pieces. The keyboard, remote-only mode & the promotion keys are in keys.js
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, canvas, validateState } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE CANVAS, THE SCRATCH BOARD
const { playerMove } = require("../user/index.js"); // TURNS A DROPPED TILE INTO A { from, to, promotion } MOVE
const { tileToSquare, squareToTile, toggleAnnotation } = require("../utils/index.js"); // THE SQUARE AT A SCREEN POSITION & BACK, ADDS OR REMOVES A MARK OR ARROW
const { currentView, VIEWS, squareUnder3D, isCameraGesture, monitorState3D } = require("../renderer/index.js"); // WHICH BOARD IS ON, THE 3D BOARD'S SQUARE LOOKUP, THE MONITOR'S STATE
const { validateMove, refreshData } = require("../moves/index.js"); // SENDS THE PLAYER'S MOVE, RESETS THE BOARD TO A SERVER GAME
const { closeMenu } = require("../menu/index.js"); // A CLICK ON THE BOARD CLOSES THE MENU
const { CARD_ORDER } = require("../three/cardLayout.js"); // THE PROMOTION CARDS' ORDER & HOW THE ARROWS WALK THEM (NO three.js IN IT: THE 3D CHUNK STAYS LAZY)
import { choosePromotion, remoteNavBox } from "./keys.js";

export const optBtn = document.getElementById("optBtn"); // MENU BUTTON (3 LINES, TOP RIGHT), OPENS THE MENU

let offBoardRefresh = true; // REDRAW WHEN THE MOUSE LEAVES THE BOARD (CLEARS HOVER EFFECTS)
let touchState = null; // ACTIVE TOUCH (MOBILE): { id, startX, startY, dragging, point }
const OFF_3D_BOARD = { x: -100, y: 0 }; // OFF THE 3D BOARD: A COLUMN NO TILE OR TRAY IS IN, ROW INSIDE SO handleMouseMove STILL CLEARS THE HOVER
const touchDragThreshold = 10; // PX A FINGER MUST MOVE BEFORE A TAP BECOMES A DRAG
let audioUnlocked = false; // THE MOVE SOUND WAS UNLOCKED BY A TAP (IOS)
let annotationStart = null; // SQUARE THE RIGHT BUTTON WENT DOWN ON, null WHEN IT'S UP OR WENT DOWN OFF THE BOARD

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

/**
 * @description The screen column & row under the pointer, the same on both boards (off the board is below 0 or above 7).
 * 2D: from the canvas position, 3D: from the square the 3D board reports, or the promotion picker's tile (drawn on the canvas over it)
 * @param  {[object]} e [mouse event, or a touch made to look like one]
 * @return {[object]} { x, y } [screen column & row]
 */
function pointerTile(e) {
	if (currentView() === VIEWS.THREE_D) {
		const picker = pickerTile(e);
		if (picker) { return picker; }
		const square = squareUnder3D(e);
		return square ? squareToTile(square, game.viewColor) : OFF_3D_BOARD;
	}
	return canvasTile(e);
}

function canvasTile(e) { // THE SCREEN COLUMN & ROW AT THE POINTER ON THE 2D CANVAS
	const point = getCanvasPoint(e);
	return { x: Math.floor((point.x - game.xBoardOff) / game.tileWidth), y: Math.floor((point.y - game.yBoardOff) / game.tileHeight) };
}

function pickerTile(e) { // 3D: THE CANVAS TILE WHEN IT'S ON A PIECE OF THE OPEN PROMOTION PICKER, null OTHERWISE
	if (!game.currPromotion || game.cards3D) { return null; } // THE ROOM'S CARDS ARE THE PICKER, NO FLAT ONE TO FIND
	const tile = canvasTile(e);
	const picker = (game.playerColor == 'w' ? game.bTakenPieces : game.wTakenPieces) || [];
	return picker.some((p) => p.x === tile.x && p.y === tile.y) ? tile : null;
}

function setPointerTile(e) { // game.tileX & game.tileY = THE SCREEN COLUMN & ROW UNDER THE POINTER
	const tile = pointerTile(e);
	game.tileX = tile.x;
	game.tileY = tile.y;
}

function squareUnder(e) { // THE BOARD SQUARE UNDER THE MOUSE, null OFF THE BOARD
	const tile = pointerTile(e);
	return tileToSquare(tile.x, tile.y, game.viewColor);
}

/* ---------------------------------------------------------------- */
// On Click
/* ---------------------------------------------------------------- */
/**
 * @description If piece is clicked, based on new positions or if piece is set back in original position, etc...
 * While promoting, a click on a piece in the picker finishes the move. Otherwise a click on the player's piece picks it up
 * (or puts it back down on its own square), a click on another square slides the picked up piece there & a dragged piece
 * is dropped where it's let go. Mouse up, touch end & remote-only mode's enter all end up here
 */
export async function handleCanvasClick(e) {
	e.preventDefault();
	e.stopPropagation();
	if (game.menuToggled) { // THE CLICK ONLY CLOSES THE MENU (IF IT CAN), THE HOVER IS SET SO THE NEXT CLICK PLAYS WITHOUT MOVING THE MOUSE
		closeMenu();
		handleMouseMove(e);
		return;
	}
	if (e.clientX !== undefined && isCameraGesture()) { return; } // THE CLICK ENDING A CAMERA GESTURE (REMOTE-ONLY MODE'S ENTER HAS NO clientX)
	if (game.currPromotion && game.cards3D) { // THE ROOM'S CARDS ARE THE PICKER: A POINTER CLICK IS THEIRS (three/index.js), THE BOARD & THE FLAT PICKER'S TILES ARE NOT TOUCHED
		if (e.clientX === undefined && game.cardFocus !== null) { return choosePromotion(CARD_ORDER[game.cardFocus]); }
		return;
	}
	setPointerTile(e); // SCREEN COLUMN & ROW CLICKED

	if (e.clientX === undefined && remoteNavBox) { // KEYBOARD (REMOTE-ONLY MODE) ENTER HAS NO POINTER POSITION
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
				await choosePromotion(takenPiece.type);
			}
		}
	} else if (!game.currSlide) {
		if (e.clientX !== undefined && !tileToSquare(game.tileX, game.tileY, game.viewColor)) { // LET GO OR CLICKED OFF THE BOARD: NOT A MOVE, THE PIECE GOES BACK TO ITS SQUARE
			for (let i = 0; i < game.tiles.length; i++) { game.tiles[i].isClicked = false; game.tiles[i].isMousedown = false; }
			game.clickedTile = false;
			game.mousedownTile = false;
			game.refresh = true;
			return;
		}
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
						game.moveObj = playerMove(game.playerColor, game.viewColor, tile); // { from, to } FROM WHERE IT WAS DROPPED
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
					game.moveObj = playerMove(game.playerColor, game.viewColor, tile);
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
	if (isCameraGesture()) { if (game.mousedownTile) { letGo(); } return; } // THE CAMERA OWNS THE POINTER: A PIECE PRESSED AS IT TOOK OVER GOES BACK TO ITS SQUARE, NOT LEFT IN HAND
	setPointerTile(e); // IF PIECE IS CLICK TO BE MOVED MOUSE POSITION (OFF THE BOARD IS BELOW 0 OR ABOVE 7)
	if (!((game.tileX < 0 || game.tileX > 7) && (game.tileY < 0 || game.tileY > 7))) { // MOUSE INSIDE THE BOARD (OR BESIDE IT, WHERE THE TRAYS ARE)
		if (game.currPromotion && game.cards3D) {
			// THE ROOM'S CARDS ARE THE PICKER (THEY HOVER THEMSELVES): NOTHING ON THE BOARD OR IN THE FLAT PICKER'S LISTS
		} else if (game.currPromotion) { // HOVER THE PICKER
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
 * makes it a drag after 3 frames). If another piece was picked up by a click, that one is put down instead.
 * The right button starts a mark or arrow & never touches a piece, the left button clears them
 */
export async function handleMouseDown(e) {
	e.preventDefault();
	e.stopPropagation();
	if (isCameraGesture()) { return; } // THE CAMERA OWNS THE POINTER
	if (e.button == 2) { annotationStart = game.menuToggled ? null : squareUnder(e); return; }
	if (game.annotations.length) { game.annotations = []; game.refresh = true; }
	setPointerTile(e); // IF HOVER IS TRUE
	for (let i = 0; i < game.tiles.length; i++) {
		let tile = game.tiles[i];
		if ((tile.isHovering && tile.type && tile.color == game.playerColor)) { // GRAB THE HOVERED PIECE
			tile.isMousedown = true;
			game.mousedownTile = tile;
			game.mouseDownTime = null;
			window.addEventListener("mouseup", releaseOffBoard); // A RELEASE OFF THE BOARD NEVER REACHES handleMouseUp
			game.refresh = true; // DRAWN LIFTED NOW, NOT ON THE FIRST MOVE (3D LIFTS IT ON THIS FRAME)
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
 * after & handleCanvasClick() drops it on the square (a drag) or keeps it picked up (a quick click).
 * The right button finishes a mark (same square) or arrow (another square), letting go off the board cancels it
 */
export async function handleMouseUp(e) {
	e.preventDefault();
	e.stopPropagation();
	window.removeEventListener("mouseup", releaseOffBoard); // RELEASED ON THE BOARD
	if (isCameraGesture()) { return; } // THE CAMERA OWNS THE POINTER
	if (e.button == 2) {
		const to = squareUnder(e);
		if (annotationStart && to) { game.annotations = toggleAnnotation(game.annotations, annotationStart, to); game.refresh = true; }
		annotationStart = null;
		return;
	}
	setPointerTile(e); // IF HOVER IS TRUE
	letGo(); // NOT ONLY WHEN IT'S HOVERED: A FLICK INTO A NEW SQUARE RELEASED BEFORE THE NEXT MOVE LEAVES isHovering STALE (FALSE) & THE PIECE WOULD STAY IN HAND
}

// THE MOUSE WAS LET GO OFF THE BOARD (THE MENU, THE PAGE, OUTSIDE THE WINDOW): THE PIECE GOES BACK TO ITS SQUARE, LIKE A CLICK OFF THE BOARD
function releaseOffBoard() {
	window.removeEventListener("mouseup", releaseOffBoard);
	if (!game.mousedownTile) { return; }
	letGo();
	for (let i = 0; i < game.tiles.length; i++) { game.tiles[i].isClicked = false; }
	game.clickedTile = false;
}

function letGo() { // LETS GO OF THE HELD PIECE, BACK TO ITS SQUARE UNTIL A CLICK DROPS IT
	for (let i = 0; i < game.tiles.length; i++) {
		let tile = game.tiles[i];
		if (tile.isMousedown && tile.type && tile.color == game.playerColor) {
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
	if (currentView() === VIEWS.THREE_D && (e.touches.length > 1 || isCameraGesture())) { handleTouchCancel(); return; } // 3D: A SECOND FINGER IS A CAMERA GESTURE, LET GO OF THE PIECE WITHOUT A CLICK
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
	if (isCameraGesture()) { handleTouchCancel(); return; } // THE CAMERA TOOK THIS FINGER
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

export function clearTouch() { touchState = null; } // THE MENU OPENED: THIS FINGER'S RELEASE ISN'T A CLICK

export function handleTouchCancel() { // THE BROWSER (A SYSTEM GESTURE) OR THE 3D CAMERA TOOK THE TOUCH: LET GO WITHOUT A CLICK
	if (!touchState) { return; }
	letGo(); // NOT handleMouseUp: IT SITS OUT CAMERA GESTURES, WHICH WOULD LEAVE THE PIECE HELD
	touchState = null;
}

/**
 * @description A Chess Cards game's keys (gameplay/cards/flow.js handKey): the arrows step through the hand, or while a card is being played through the squares that glow,
 * Enter lifts the card or picks the square, Escape puts the card down. Off the player's turn the arrows still step & Enter does nothing, so the page's nav never gets them (N1).
 * Run in the capture phase on the window (gameplay/index.js), like handleCardKey, so the page's nav never sees a key it used. A held Enter is stopped whatever has the focus
 * (a prompt's button, the menu's Restart: N3). Nothing else while the menu is open, a Board Effects pile is open, the monitor is off the desk, a field has the keys or a modifier
 * is down; a focused button or link keeps Enter, an arrow takes the focus off it first
 * @param  {[KeyboardEvent]} e [a keydown]
 * @return {[boolean]} [the key was used or stopped, & its default & other handlers are stopped]
 */
export function handleHandKey(e) {
	if (!game.cardGame || e.altKey || e.ctrlKey || e.metaKey) { return false; }
	if (e.key === "Enter" && e.repeat) { e.preventDefault(); e.stopPropagation(); return true; } // A HELD ENTER PRESSES NOTHING MORE: NOT A PROMPT'S BUTTON, NOT RESTART'S SECOND, FORFEITING PRESS (N3)
	if (game.menuToggled || isCameraGesture() || document.querySelector(".cardPile")) { return false; } // AN OPENED BOARD EFFECTS PILE HAS THE KEYS (three/cardTable.js)
	if (!/^(Arrow(Up|Down|Left|Right)|Enter|Escape)$/.test(e.key) || (monitorState3D() || "idle") !== "idle") { return false; }
	const target = e.target;
	if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) { return false; }
	const { handKey } = require("../cards/flow.js"); // HERE, NOT ABOVE: flow.js REACHES THE MENU, WHICH REQUIRES THIS FILE
	if (!handKey(e.key, e.repeat, Boolean(target && /^(BUTTON|A)$/.test(target.tagName)))) { return false; }
	e.preventDefault();
	e.stopPropagation();
	return true;
}
