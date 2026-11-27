/*
 *  index.js  --  chess frontend
 *	Input
 *	The board's controls: the mouse (hover, click to pick up & put down, drag & drop), touch on phones (tap & drag, mapped
 *	onto the mouse handlers) & remote-only mode (arrow keys or W, A, S & D move a select box, enter clicks, right from the
 *	last column reaches the menu).
 *	startGame (gameplay/index.js) adds their listeners to both boards. The only thing that differs on the 3D board is the
 *	square under the pointer (pointerTile), camera gestures there never reach the pieces. The keyboard, remote-only mode &
 *	the promotion keys are in keys.js
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, canvas, validateState } = require("../state/index.js");
const { playerMove } = require("../user/index.js"); // Turns a dropped tile into a { from, to, promotion } move
const { tileToSquare, squareToTile, toggleAnnotation } = require("../utils/index.js");
const { currentView, VIEWS, squareUnder3D, isCameraGesture, monitorState3D } = require("../renderer/index.js");
const { validateMove, refreshData } = require("../moves/index.js");
const { closeMenu } = require("../menu/index.js");
// Only the order: cardLayout.js has no three.js in it, so the 3D chunk stays lazy
const { CARD_ORDER } = require("../three/cardLayout.js");
import { choosePromotion, remoteNavBox } from "./keys.js";

export const optBtn = document.getElementById("optBtn"); // Menu button (3 lines, top right), opens the menu

let offBoardRefresh = true; // Redraw when the mouse leaves the board (clears the hover effects)
let touchState = null; // The active touch (mobile): { id, startX, startY, dragging, point }
// Off the 3D board: a column no tile or tray is in, and a row inside so handleMouseMove still clears the hover
const OFF_3D_BOARD = { x: -100, y: 0 };
const TOUCH_DRAG_THRESHOLD = 10; // Pixels a finger must move before a tap becomes a drag
let audioUnlocked = false; // A tap unlocked the move sound (iOS)
let annotationStart = null; // The square the right button went down on, null when it's up or went down off the board

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
 * 2D: from the canvas position, 3D: from the square the 3D board reports, or the promotion picker's tile (drawn on the
 * canvas over it)
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

// The screen column & row at the pointer on the 2D canvas
function canvasTile(e) {
	const point = getCanvasPoint(e);
	return {
		x: Math.floor((point.x - game.xBoardOff) / game.tileWidth),
		y: Math.floor((point.y - game.yBoardOff) / game.tileHeight)
	};
}

// 3D: the canvas tile when it's on a piece of the open promotion picker, null otherwise
function pickerTile(e) {
	if (!game.currPromotion || game.cards3D) { return null; } // The room's cards are the picker, there's no flat one to find
	const tile = canvasTile(e);
	const picker = (game.playerColor == 'w' ? game.bTakenPieces : game.wTakenPieces) || [];
	return picker.some((piece) => piece.x === tile.x && piece.y === tile.y) ? tile : null;
}

// Sets game.tileX & game.tileY to the screen column & row under the pointer
function setPointerTile(e) {
	const tile = pointerTile(e);
	game.tileX = tile.x;
	game.tileY = tile.y;
}

// The board square under the mouse, null off the board
function squareUnder(e) {
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
	// The click only closes the menu (if it can). The hover is set so the next click plays without moving the mouse
	if (game.menuToggled) {
		closeMenu();
		handleMouseMove(e);
		return;
	}
	// The click that ends a camera gesture (remote-only mode's enter has no clientX)
	if (e.clientX !== undefined && isCameraGesture()) { return; }
	// The room's cards are the picker: a pointer click is theirs (three/index.js), the board & the flat picker's tiles aren't touched
	if (game.currPromotion && game.cards3D) {
		if (e.clientX === undefined && game.cardFocus !== null) { return choosePromotion(CARD_ORDER[game.cardFocus]); }
		return;
	}
	setPointerTile(e);

	if (e.clientX === undefined && remoteNavBox) { // Remote-only mode's enter has no pointer position
		game.tileX = remoteNavBox.x;
		game.tileY = remoteNavBox.y;
	}

	if (game.currPromotion) { // Look for a click on a piece in the picker
		game.revert = game.response;
		let takenPieces // The picker (drawScreen puts it in this list while promoting)
		if (game.playerColor == 'w') { takenPieces = game.bTakenPieces }
		else if (game.playerColor == 'b') { takenPieces = game.wTakenPieces }
		for (let i = 0; i < takenPieces.length; i++) {
			let takenPiece = takenPieces[i];
			if (((takenPiece.x === game.tileX && takenPiece.y === game.tileY && (takenPiece.color == game.playerColor || !takenPiece.color)))
				&& takenPiece.type && takenPiece.color == game.playerColor) {
				await choosePromotion(takenPiece.type);
			}
		}
	} else if (!game.currSlide) {
		// Let go or clicked off the board: not a move, the piece goes back to its square
		if (e.clientX !== undefined && !tileToSquare(game.tileX, game.tileY, game.viewColor)) {
			for (let i = 0; i < game.tiles.length; i++) {
				game.tiles[i].isClicked = false;
				game.tiles[i].isMousedown = false;
			}
			game.clickedTile = false;
			game.mousedownTile = false;
			game.refresh = true;
			return;
		}
		game.revert = game.response;
		for (let i = 0; i < game.tiles.length; i++) {
			let tile = game.tiles[i];
			if (tile.isHovering && tile.type && tile.color == game.playerColor) { // Drag & drop, or a click on the hovered piece
				if (tile.isClicked && game.tileX == tile.originX && game.tileY == tile.originY) { // Put back down on its own square
					tile.isClicked = false;
					game.clickedTile = false;
					game.mousedownTile = false;
					game.refresh = true;
					return;
				}

				// Dropped on a new square
				if (tile.isClicked && tile.color == game.playerColor && (game.tileX != tile.originX || game.tileY != tile.originY)) {
					try { // Tested here first so a move that can't be played never reaches the server
						game.moveObj = playerMove(game.playerColor, game.viewColor, tile); // { from, to } from where it was dropped
						if (game.moveObj.promotion) { // A pawn on the last rank: open the picker
							game.currPromotion = true;
							game.refresh = true;
							return;
						}
						tile.isClicked = false;
						game.clickedTile = false;
						game.mousedownTile = false;
						game.opposingMove = true;
						game.refresh = true;
						return await validateMove(); // Dropped, so there's no slide: send it now
					} catch (err) {
						console.log(err);
						game.opposingMove = false;
						return refreshData(game.revert);
					}
				}

				tile.isClicked = true; // Pick it up
				game.clickedTile = tile;
				game.refresh = true;
			} else if (!tile.isHovering
				&& (tile.isClicked && tile.color == game.playerColor && (game.tileX != tile.originX || game.tileY != tile.originY))) {
				// A piece is picked up & the click is on another square
				try {
					for (let z = 0; z < game.tiles.length; z++) {
						game.tiles[z].isClicked = false;
						game.clickedTile = false;
					}
					for (let j = 0; j < game.tiles.length; j++) { // Clicked another of the player's pieces: pick that one up instead
						const otherTile = game.tiles[j];
						if ((otherTile.isHovering && otherTile.x == game.tileX && otherTile.y == game.tileY)
							&& otherTile.color == game.playerColor) {
							otherTile.isClicked = true
							game.clickedTile = otherTile;
							game.refresh = true;
							return;
						}
					}
					tile.x = game.tileX; // Clicked a square: slide the picked up piece there (the move is sent when it lands)
					tile.y = game.tileY;
					game.moveObj = playerMove(game.playerColor, game.viewColor, tile);
					validateState.load(game.response.game_board);
					// Checked on the scratch board, so drawScreen keeps drawing the board from before the move while it's checked
					validateState.move(game.moveObj);
					game.currSlide = true;
					game.slideStart = true;
					tile.isSliding = true;
					tile.xSlideTo = game.tileX;
					tile.ySlideTo = game.tileY;
					tile.xDiff = 0;
					tile.yDiff = 0;
					tile.slideStartTime = null; // Its clock starts on its first frame (stepSlide)
					for (let j = 0; j < game.tiles.length; j++) {
						game.tiles[j].isClicked = false;
						game.tiles[j].isMousedown = false
					}
					game.clickedTile = false;
					game.mousedownTile = false;
					game.opposingMove = true;
					game.refresh = true;

					return;
				} catch (err) {
					console.log(err);
					game.clickedTile = false;
					game.opposingMove = false;
					return refreshData(game.revert);
				}
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
	if (isCameraGesture()) { // The camera owns the pointer: a piece pressed as it took over goes back to its square, not left in hand
		if (game.mousedownTile) { letGo(); }
		return;
	}
	setPointerTile(e); // Off the board is below 0 or above 7
	if (!((game.tileX < 0 || game.tileX > 7) && (game.tileY < 0 || game.tileY > 7))) { // On the board (or beside it, where the trays are)
		if (game.currPromotion && game.cards3D) {
			// The room's cards are the picker (they hover themselves): nothing on the board or in the flat picker's lists
		} else if (game.currPromotion) { // Hover the picker
			let takenPieces
			if (game.playerColor == 'w') { takenPieces = game.bTakenPieces }
			else if (game.playerColor == 'b') { takenPieces = game.wTakenPieces }
			for (let i = 0; i < takenPieces.length; i++) {
				let takenPiece = takenPieces[i];
				takenPiece.isHovering = (((takenPiece.x === game.tileX && takenPiece.y === game.tileY
					&& (takenPiece.color == game.playerColor || !takenPiece.color)))) && !game.menuToggled
				if (takenPiece.isHovering || takenPiece.isClicked) {
					game.refresh = true;
					offBoardRefresh = true;
				}
				if (takenPiece.color != game.playerColor && takenPiece.color) { game.refresh = true }
			}
		} else { // Hover the player's piece under the mouse (only on their turn, with the menu closed)
			for (let i = 0; i < game.tiles.length; i++) {
				let tile = game.tiles[i];
				tile.isHovering =
					(!tile.isSliding) &&
					(tile.x === game.tileX && tile.y === game.tileY) &&
					((tile.color == game.playerColor || !tile.color) || tile.isMousedown) &&
					(!game.opposingMove && !game.menuToggled)
				if (tile.isHovering || tile.isClicked) {
					game.refresh = true;
					offBoardRefresh = true;
				}
				if (tile.color != game.playerColor && tile.color) { game.refresh = true }
			}
		}
	}
	if (game.tileX < 0 || game.tileX > 7 || game.tileY < 0 || game.tileY > 7) { // Off the board
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
	if (isCameraGesture()) { return; } // The camera owns the pointer
	if (e.button == 2) {
		annotationStart = game.menuToggled ? null : squareUnder(e);
		return;
	}
	if (game.annotations.length) {
		game.annotations = [];
		game.refresh = true;
	}
	setPointerTile(e);
	for (let i = 0; i < game.tiles.length; i++) {
		let tile = game.tiles[i];
		if ((tile.isHovering && tile.type && tile.color == game.playerColor)) { // Grab the hovered piece
			tile.isMousedown = true;
			game.mousedownTile = tile;
			game.mouseDownTime = null;
			window.addEventListener("mouseup", releaseOffBoard); // A release off the board never reaches handleMouseUp
			game.refresh = true; // Drawn lifted now, not on the first move (3D lifts it on this frame)
			for (let j = 0; j < game.tiles.length; j++) { // A different piece was picked up: put it down
				const otherTile = game.tiles[j];
				if (otherTile.isClicked && (otherTile.x != game.tileX || otherTile.y != game.tileY) && otherTile.color == game.playerColor) {
					otherTile.isClicked = false
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
	window.removeEventListener("mouseup", releaseOffBoard); // Released on the board
	if (isCameraGesture()) { return; } // The camera owns the pointer
	if (e.button == 2) {
		const to = squareUnder(e);
		if (annotationStart && to) {
			game.annotations = toggleAnnotation(game.annotations, annotationStart, to);
			game.refresh = true;
		}
		annotationStart = null;
		return;
	}
	setPointerTile(e);
	// Not only when it's hovered: a flick into a new square released before the next move leaves isHovering stale (false)
	// & the piece would stay in hand
	letGo();
}

// The mouse was let go off the board (the menu, the page, outside the window): the piece goes back to its square, like a
// click off the board
function releaseOffBoard() {
	window.removeEventListener("mouseup", releaseOffBoard);
	if (!game.mousedownTile) { return; }
	letGo();
	for (let i = 0; i < game.tiles.length; i++) { game.tiles[i].isClicked = false; }
	game.clickedTile = false;
}

// Lets go of the held piece, it's back on its square until a click drops it
function letGo() {
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

// A touch with the fields the mouse handlers use
function touchToMouseEvent(touch) {
	return { clientX: touch.clientX, clientY: touch.clientY, preventDefault() { }, stopPropagation() { } };
}

// The finger that started (touchState.id), other fingers are ignored
function findActiveTouch(touchList) {
	for (let i = 0; i < touchList.length; i++) {
		if (touchList[i].identifier == touchState.id) { return touchList[i]; }
	}
	return null;
}

// iOS only plays audio a user gesture started: it plays muted once so later move sounds (the AI's, the opponent's) can play
function unlockAudio() {
	if (audioUnlocked) { return; }
	audioUnlocked = true;
	game.moveAudio.muted = true;
	game.moveAudio.play().then(() => {
		game.moveAudio.pause();
		game.moveAudio.currentTime = 0;
		game.moveAudio.muted = false;
	}).catch(() => { game.moveAudio.muted = false; });
}

// Finger down = hover + mouse down
export function handleTouchStart(e) {
	e.preventDefault(); // Stops scroll & zoom, & the browser's emulated mouse events
	// 3D: a second finger is a camera gesture, let go of the piece without a click
	if (currentView() === VIEWS.THREE_D && (e.touches.length > 1 || isCameraGesture())) {
		handleTouchCancel();
		return;
	}
	if (touchState) { return; } // Ignore extra fingers
	const touch = e.changedTouches[0];
	const point = touchToMouseEvent(touch);
	touchState = { id: touch.identifier, startX: touch.clientX, startY: touch.clientY, dragging: false, point };
	handleMouseMove(point); // Touch has no hover, so it's set before the mouse down
	handleMouseDown(point);
}

// Finger moves = mouse move, once it's moved far enough to be a drag
export function handleTouchMove(e) {
	e.preventDefault();
	if (!touchState) { return; }
	if (isCameraGesture()) { // The camera took this finger
		handleTouchCancel();
		return;
	}
	const touch = findActiveTouch(e.changedTouches);
	if (!touch) { return; }
	touchState.point = touchToMouseEvent(touch);
	const moved = Math.hypot(touch.clientX - touchState.startX, touch.clientY - touchState.startY);
	if (!touchState.dragging && moved < TOUCH_DRAG_THRESHOLD) { return; } // Small finger jitter is still a tap
	touchState.dragging = true;
	handleMouseMove(touchState.point);
}

// Finger up = mouse up + click
export function handleTouchEnd(e) {
	e.preventDefault();
	if (!touchState) { return; }
	const touch = findActiveTouch(e.changedTouches);
	if (!touch) { return; }
	const point = touchToMouseEvent(touch);
	const dragging = touchState.dragging;
	touchState = null;
	unlockAudio();
	handleMouseMove(point);
	if (dragging) { // Drop the dragged piece on the release tile (the render loop only does this on its next frame)
		for (let i = 0; i < game.tiles.length; i++) {
			const tile = game.tiles[i];
			if (tile.isMousedown && tile.color == game.playerColor) {
				tile.x = game.tileX;
				tile.y = game.tileY;
				tile.isClicked = true;
			}
		}
		handleMouseMove(point);
	}
	handleMouseUp(point);
	handleCanvasClick(point);
}

export function clearTouch() { touchState = null; } // The menu opened: this finger's release isn't a click

// The browser (a system gesture) or the 3D camera took the touch: let go without a click
export function handleTouchCancel() {
	if (!touchState) { return; }
	letGo(); // Not handleMouseUp: it sits out camera gestures, which would leave the piece held
	touchState = null;
}

/**
 * @description A Chess Cards game's keys (gameplay/cards/flow.js handKey): the arrows step through the hand, or while a card
 * is being played through the squares that glow, Enter lifts the card or picks the square, Escape puts the card down, then
 * closes an opened pile. Off the player's turn the arrows still step & Enter does nothing, so the page's nav never gets them.
 * Run in the capture phase on the window (gameplay/index.js), like handleCardKey, so the page's nav never sees a key it used.
 * A held Enter is stopped whatever has the focus (a prompt's button, the menu's Restart). Nothing else while the menu is
 * open, the monitor is off the desk, a field has the keys or a modifier is down; a focused button or link keeps Enter, an
 * arrow takes the focus off it first
 * @param  {[KeyboardEvent]} e [a keydown]
 * @return {[boolean]} [the key was used or stopped, & its default & other handlers are stopped]
 */
export function handleHandKey(e) {
	if (!game.cardGame || e.altKey || e.ctrlKey || e.metaKey) { return false; }
	if (e.key === "Enter" && e.repeat) { // A held Enter presses nothing more: not a prompt's button, not Restart's second, forfeiting press
		e.preventDefault();
		e.stopPropagation();
		return true;
	}
	if (game.menuToggled || isCameraGesture()) { return false; }
	if (!/^(Arrow(Up|Down|Left|Right)|Enter|Escape)$/.test(e.key) || (monitorState3D() || "idle") !== "idle") { return false; }
	const target = e.target;
	if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) { return false; }
	const { handKey } = require("../cards/flow.js"); // Here, not at the top: flow.js reaches the menu, which requires this file
	if (!handKey(e.key, e.repeat, Boolean(target && /^(BUTTON|A)$/.test(target.tagName)))) { return false; }
	e.preventDefault();
	e.stopPropagation();
	return true;
}
