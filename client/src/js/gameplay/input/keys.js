// Keyboard input: remote-only mode's select box, the game's keys, promotion and 3D card keys
const { game, OVERRIDE_REMOTE_ONLY } = require("../state/index.js"); // THE GAME'S SHARED STATE, REMOTE-ONLY MODE FOR TESTING
const { isCameraGesture, onCardPick } = require("../renderer/index.js"); // IS A TOUCH A 3D CAMERA GESTURE, THE 3D PROMOTION CARD PICK
const { validateMove, refreshData } = require("../moves/index.js"); // SENDS THE PLAYER'S MOVE, RESETS THE BOARD TO A SERVER GAME
const { openMenu } = require("../menu/index.js"); // REMOTE-ONLY MODE OPENS THE MENU
const { menuItems, itemForKey } = require("../../pages/utils/nav.js"); // THE MENU'S ITEMS, READ FROM THE PAGE
const { CARD_ORDER, nextCard } = require("../three/cardLayout.js"); // THE PROMOTION CARDS' ORDER & HOW THE ARROWS WALK THEM (NO three.js IN IT: THE 3D CHUNK STAYS LAZY)
import { optBtn, handleCanvasClick } from "./index.js";

const REMOTE_SKIPS = ["optPgn", "optTypeMove"]; // A REMOTE-ONLY DEVICE HAS NOWHERE TO SAVE A FILE & NO KEYS TO TYPE A MOVE
const LETTER_CODES = { 87: 38, 65: 37, 83: 40, 68: 39 }; // W, A, S & D ARE THE ARROWS (UP, LEFT, DOWN, RIGHT)
export let remoteNavBox = { x: 7, y: 0, menuHover: false, menuBtn: false } // REMOTE-ONLY MODE SELECT BOX: SQUARE (x, y), ON THE MENU BUTTON (menuHover) & THE SELECTED MENU BUTTON

/* ---------------------------------------------------------------- */
// Handle Remote Nav Button Hover
/* ---------------------------------------------------------------- */
/**
 * @description Changes current button effect when keydown is handled. Remote-only mode: moves the menu highlight from the
 * selected button to btn
 * @param  {[object]} btn [menu button element]
 */
function handleRemoteNavBtnHover(btn) {
	if (remoteNavBox.menuBtn) {
		remoteNavBox.menuBtn.style.transition = "ease-out 375ms";
		remoteNavBox.menuBtn.style.backgroundColor = "#CD853F";
	}
	remoteNavBox.menuBtn = btn;
	remoteNavBox.menuBtn.style.transition = "ease-in 375ms"
	remoteNavBox.menuBtn.style.backgroundColor = "burlywood"
}

/**
 * @description The items remote-only mode can reach: the menu's own list (menuItems), without the ones it has no use for
 * @return {[array]} items [in the order on screen]
 */
function remoteItems() {
	return menuItems().filter((item) => !REMOTE_SKIPS.includes(item.id));
}

/**
 * @description Remote-only mode: up, down, to the top or bottom of the menu, the same moves as a keyboard (itemForKey)
 * @param  {[string]} key [ArrowUp, ArrowDown, Home or End]
 */
function moveRemoteSelection(key) {
	const next = itemForKey(remoteItems(), remoteNavBox.menuBtn, key);
	if (next) { handleRemoteNavBtnHover(next); }
}

/**
 * @description Remote-only mode: presses the selected item with the listener a click would reach. It stays selected until the menu closes, so a second press can
 * answer "Are you sure?" & Cancel can be reached from Rematch. An item that went away (Cancel after it's pressed) moves the selection instead
 */
function pressRemoteSelection() {
	const items = remoteItems();
	if (items.includes(remoteNavBox.menuBtn)) { remoteNavBox.menuBtn.click(); }
	else if (items.length) { handleRemoteNavBtnHover(items[0]); }
}

/* ---------------------------------------------------------------- */
// Handle Remote Menu Enter
/* ---------------------------------------------------------------- */
/**
 * @description Handles menu button style when clicked with remote select box. Remote-only mode: the menu opened, so btn
 * becomes the selected (highlighted) menu button & the menu button goes back to its normal color
 * @param  {[object]} btn [menu button element]
 */
export function handleRemoteMenuEnter(btn) {
	if (game.REMOTE_ONLY_CONDITIONAL) { optBtn.style.transition = "ease-out 375ms"; optBtn.style.color = "burlywood"; }
	if (game.REMOTE_ONLY_CONDITIONAL || OVERRIDE_REMOTE_ONLY) { remoteNavBox.menuHover = false; handleRemoteNavBtnHover(btn); }
}

/**
 * @description Remote-only mode: the menu closed, the select box goes back to the top right
 */
export function clearRemoteSelection() {
	if (!remoteNavBox.menuBtn) { return; }
	remoteNavBox.menuBtn.style.backgroundColor = "#CD853F";
	remoteNavBox = { x: 7, y: 0, menuHover: false, menuBtn: false };
	game.keyboardTile = null; // NO RING UNTIL THE NEXT KEY
}

/* ---------------------------------------------------------------- */
// Handle Keydown
/* ---------------------------------------------------------------- */
/**
 * @description Handles Keydown events. Remote-only mode: the arrows move the select box (remoteNavBox) around the board, right
 * from the last column moves it onto the menu button & up, down, home & end move between menu buttons. Enter clicks the square
 * (handleCanvasClick), opens the menu or presses the selected menu button
 */
export async function handleKeyPress(e) {
	if (handleCardKey(e)) { return; } // A PROMOTION CARD'S KEY
	e.preventDefault();
	e.stopPropagation();
	if (!e?.repeat && e?.keyCode) { // HOLDING A KEY DOESN'T REPEAT
		const code = LETTER_CODES[e.keyCode] || e.keyCode;
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

		if (code == 27 && !game.menuToggled) { // ESCAPE (THE ZOOMED MONITOR KEEPS ITS OWN): DROP THE 3D RING & ITS HOVER UNTIL THE NEXT KEY
			game.tiles.forEach((tile) => { tile.isHovering = false; });
			game.keyboardTile = null;
			game.refresh = true;
			return;
		}

		if (code == 37) { // LEFT
			if (remoteNavBox.x > 0 && !game.menuToggled) {
				if (remoteNavBox.menuHover) {
					if (game.REMOTE_ONLY_CONDITIONAL) { optBtn.style.transition = "ease-out 375ms"; optBtn.style.color = "burlywood"; }
					remoteNavBox.menuHover = false;
				} else {
					remoteNavBox.x -= 1;
				}
				game.refresh = true;
			}
			else { game.refresh = true; }
			checkBoxOverPiece();
		}

		if (code == 39) { // RIGHT
			if (remoteNavBox.x < 7 && !game.menuToggled) {
				remoteNavBox.x += 1;
				game.refresh = true;
			}
			else if (remoteNavBox.x == 7 && !game.menuToggled) { // PAST THE LAST COLUMN: SELECT THE MENU BUTTON
				remoteNavBox.y = 0;
				remoteNavBox.menuHover = true;
				if (game.REMOTE_ONLY_CONDITIONAL) { optBtn.style.transition = "ease-in 375ms"; optBtn.style.color = "white"; }
			}

			else { game.refresh = true; }
			checkBoxOverPiece();
		}

		if (code == 38) { // UP
			if (remoteNavBox.y > 0 && (!remoteNavBox.menuHover && !game.menuToggled)) { remoteNavBox.y -= 1; game.refresh = true; }
			else if (game.menuToggled) {
				moveRemoteSelection("ArrowUp");
			}
			else { game.refresh = true; }
			checkBoxOverPiece();
		}
		if (code == 40) { // DOWN
			if (remoteNavBox.y < 7 && (!remoteNavBox.menuHover && !game.menuToggled)) { remoteNavBox.y += 1; game.refresh = true; }
			else if (game.menuToggled) {
				moveRemoteSelection("ArrowDown");
			}
			else { game.refresh = true; }
			checkBoxOverPiece();
		}
		if (code == 13) { // ENTER
			if (!remoteNavBox.menuHover && !game.menuToggled) { checkBoxOverPiece(); handleCanvasClick(e); } // CLICK THE SELECTED SQUARE
			else if (remoteNavBox.menuHover && !game.menuToggled) { openMenu(); handleRemoteMenuEnter(remoteItems()[0]); } // OPEN THE MENU ON THE TOP ITEM
			else if (game.menuToggled) { pressRemoteSelection(); }
		}
		if (game.menuToggled && code == 36) { moveRemoteSelection("Home"); } // HOME
		if (game.menuToggled && code == 35) { moveRemoteSelection("End"); } // END
		game.keyboardTile = remoteNavBox.menuHover ? null : { x: remoteNavBox.x, y: remoteNavBox.y }; // THE 3D BOARD RINGS THE SELECTED SQUARE
		game.refresh = true
	}
}

/* ---------------------------------------------------------------- */
// Promotion Cards
/* ---------------------------------------------------------------- */
/**
 * @description Finishes the player's pawn move with the piece they picked: the flat picker's tile or the 3D room's card
 * @param  {[string]} type [the piece, "q", "r", "b" or "n"]
 */
export async function choosePromotion(type) {
	if (!game.currPromotion) { return; } // ALREADY PICKED: A SECOND CLICK BEFORE THE NEXT FRAME MUST NOT SEND THE MOVE AGAIN
	game.revert = game.response;
	try { // TEST MOVE CLIENT SIDE TO JUSTIFY SERVER CALL
		game.moveObj.promotion = type;
		game.currPromotion = false;
		await validateMove();
	} catch (err) { console.log(err); game.opposingMove = false; return refreshData(game.revert); }
}
onCardPick(choosePromotion); // THE 3D BOARD'S CARDS CALL IT. input ALREADY REQUIRES THE RENDERER, SO THIS ADDS NO CYCLE

/**
 * @description The keys of the 3D room's promotion cards: the arrows move the gold frame, Enter picks the framed card. Run in the capture phase on
 * the window (gameplay/index.js) so the page's nav (arrows move the page focus, Enter on nothing focuses the menu button) never sees a handled key,
 * & stopPropagation() keeps remote-only mode's handleKeyPress from stepping a second time. Nothing while the flat picker is the picker, the menu is
 * open, the monitor is zoomed, a field has the keys, or a modifier is down. The rule for Enter: it picks when a card is framed, unless a button or
 * link has the focus (Tab put it there), so Enter still presses it, which keeps the menu reachable. An arrow takes the focus off a button or link
 * first, so after arrows Enter always picks
 * @param  {[KeyboardEvent]} e [a keydown]
 * @return {[boolean]} [the key was used, & its default & other handlers are stopped]
 */
export function handleCardKey(e) {
	if (!game.currPromotion || !game.cards3D || game.menuToggled || e.altKey || e.ctrlKey || e.metaKey || isCameraGesture()) { return false; }
	const target = e.target;
	if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) { return false; }
	const pressable = Boolean(target && /^(BUTTON|A)$/.test(target.tagName));
	if (e.key === "Enter") {
		if (pressable) { return false; }
		e.preventDefault();
		e.stopPropagation();
		if (game.cardFocus === null) { game.cardFocus = 0; game.refresh = true; } // NO CARD FRAMED YET (A MOUSE DEVICE): THE FIRST ENTER FRAMES THE QUEEN, THE NEXT PICKS IT
		else { choosePromotion(CARD_ORDER[game.cardFocus]); }
		return true;
	}
	if (!/^Arrow(Up|Down|Left|Right)$/.test(e.key)) { return false; }
	e.preventDefault();
	e.stopPropagation();
	if (pressable) { target.blur(); } // THE ARROWS ARE THE CARDS' NOW: ENTER MUST NOT PRESS THE BUTTON
	game.cardFocus = nextCard(game.cardFocus, e.key);
	game.refresh = true;
	return true;
}
