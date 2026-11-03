/*
 *  index.js  --  chess frontend
 *	Move Box
 *	Plays a typed move like e4, Nf3, exd5 or e8=Q (#moveBox on the play page, HTML over the canvas). The / key or the menu's
 *	Type a Move opens it (Type a Move also closes it), chess.js reads the move on the scratch board & it slides like a clicked move, validateMove() sends it
 *	when it lands (sound & server check as usual). It's open when the game loads, without the cursor where that would bring up a phone's keyboard or catch the TV remote's keys.
 *	As the player types it lists the legal moves that start with what they typed, picked with a click, a tap or the arrow keys & Enter
 *	Keyboard: closing gives focus back to where it was when the box opened & Left or Right leave the box with the cursor at that end (pages/utils/nav.js).
 *	It opens at the top right behind the menu button, which covers the X. A mouse or a finger can drag it by anything but the input, the X & the list, it stays inside the window until it's closed
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, chessInst, validateState, fillTiles } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE BOARD THAT'S DRAWN, THE SCRATCH BOARD
const { refreshData } = require("../moves/index.js"); // RESETS THE BOARD TO A SERVER GAME
const { closeMenu } = require("../menu/index.js"); // A KEY ON TYPE A MOVE CLOSES THE MENU, THE CURSOR GOES IN THE BOX
const { canLeave } = require("../../pages/utils/nav.js"); // LEFT & RIGHT LET GO WITH THE CURSOR AT THAT END
const { moveBlockReason, suggestMoves, exampleMoves, stepHighlight, countMessage } = require("./suggestions.js"); // WHEN THE PLAYER CAN MOVE & WHAT THE LIST SHOWS
const box = document.getElementById("moveBox"); // THE FORM
const input = document.getElementById("moveBoxInput"); // WHERE THE MOVE IS TYPED
const refusal = document.getElementById("moveBoxRefusal"); // WHY A MOVE WAS REFUSED, NEXT TO THE INPUT
const closeBtn = document.getElementById("moveBoxClose"); // CLOSES IT (PHONES HAVE NO ESCAPE KEY)
const optBtn = document.getElementById("optBtn"); // MENU BUTTON (3 LINES, TOP RIGHT)
const optTypeMoveBtn = document.getElementById("optTypeMove"); // MENU: TYPE A MOVE
const list = document.getElementById("moveBoxSuggestions"); // THE LEGAL MOVES THAT START WITH WHAT WAS TYPED
const countStatus = document.getElementById("moveBoxCount"); // HOW MANY THERE ARE, FOR SCREEN READERS
const WATCH_TIME = 250; // HOW OFTEN AN OPEN BOX CHECKS THE GAME FOR CHANGES, A MOVE CAN ARRIVE WHILE THE PLAYER TYPES (ms)
const VIEW_GAP = 16; // SPACE KEPT BELOW THE LIST, THE BOX'S PADDING & A MARGIN (px)
const BOX_TOP = 7; // THE BOX'S TOP WHEN IT MOVES UP, THE SAME GAP AS ITS USUAL SPOT UNDER THE MENU BUTTON (px)
const MIN_LIST_ROOM = 88; // TWO ROWS, WITH LESS THAN THIS THE BOX MOVES UP (A PHONE'S KEYBOARD IN LANDSCAPE)
let opener = null; // WHAT HAD FOCUS WHEN THE BOX OPENED, FOCUS GOES BACK THERE WHEN IT CLOSES
let suggestions = []; // THE MOVES IN THE LIST
let highlighted = -1; // THE ONE THE ARROW KEYS ARE ON, -1 FOR NONE
let shownFor = null; // WHAT THE LIST WAS LAST BUILT FOR, IT'S ONLY REBUILT WHEN THIS CHANGES
let watchTimer = null; // THE CHECK WHILE THE BOX IS OPEN
let dragPos = null; // WHERE THE PLAYER DRAGGED THE BOX { left, top }, null UNTIL THEY DO & AGAIN WHEN IT CLOSES
let grab = null; // WHERE IN THE BOX THE MOUSE OR FINGER IS HOLDING IT { x, y }, null WHEN IT'S NOT BEING DRAGGED
let dragTouch = null; // THE identifier OF THE FINGER DRAGGING IT, null WHEN IT ISN'T A FINGER

/* ---------------------------------------------------------------- */
// Open & Close
/* ---------------------------------------------------------------- */
/**
 * @description Opens the box & puts the cursor in it. On a phone the cursor is what brings up the keyboard
 * @param  {[boolean]} focusInput [false leaves the cursor where it is]
 */
function openMoveBox(focusInput = true) {
	const focused = document.activeElement;
	if (!box.contains(focused)) { opener = focused == document.body ? null : focused; }
	box.hidden = false;
	optTypeMoveBtn.setAttribute("aria-expanded", "true");
	fitBox(); // THE WINDOW CAN HAVE CHANGED SIZE WHILE IT WAS CLOSED
	if (focusInput) { input.focus(); }
	clearInterval(watchTimer);
	watchTimer = setInterval(updateSuggestions, WATCH_TIME);
	updateSuggestions(); // THE INPUT'S EXAMPLE MOVES ARE FOR THE POSITION NOW, NOT WHEN IT LAST CLOSED
}

/**
 * @description Closes the box, clears what was typed & forgets where it was dragged, so it opens at its usual spot again
 */
function closeMoveBox() {
	if (box.contains(document.activeElement)) { returnFocus(); } // BEFORE IT'S HIDDEN, THAT WOULD DROP FOCUS TO THE PAGE
	opener = null;
	box.hidden = true;
	optTypeMoveBtn.setAttribute("aria-expanded", "false");
	dragPos = null;
	box.style.left = ""; // fitBox() CLEARS THE TOP
	input.value = "";
	refusal.textContent = "";
	clearInterval(watchTimer);
	updateSuggestions();
}

/**
 * @description Focus goes back to where it was when the box opened. An item in a menu that has closed can't take it, the menu button does. Nothing had it: the page
 */
function returnFocus() {
	const target = opener?.closest("#menuContainer") && !game.menuToggled ? optBtn : opener;
	if (target?.isConnected) { target.focus(); } else { input.blur(); }
}

/* ---------------------------------------------------------------- */
// Suggestions
/* ---------------------------------------------------------------- */
/**
 * @description The legal moves for what's typed, read on the scratch board so they match what readTypedMove() accepts.
 * Nothing when the player can't move
 * @param  {[string]} text [what's in the input]
 * @return {[array]} moves
 */
function readSuggestions(text) {
	validateState.load(game.response.game_board);
	return suggestMoves(validateState, text);
}

/**
 * @description Rebuilds the list & the empty input's text when what's typed or the game changed, a list that didn't change keeps its highlight
 */
function updateSuggestions() {
	const text = box.hidden ? "" : input.value;
	const blocked = moveBlockReason(game, chessInst.turn());
	const canMove = !box.hidden && !blocked;
	const key = `${canMove}|${blocked}|${text}|${game.response?.game_board}`;
	if (key == shownFor) { return; }
	shownFor = key;
	suggestions = canMove ? readSuggestions(text) : [];
	input.placeholder = canMove ? exampleMoves(validateState).join(", ") : blocked || ""; // readSuggestions() LOADED THE SCRATCH BOARD
	highlighted = -1;
	input.removeAttribute("aria-activedescendant");
	list.replaceChildren(...suggestions.map(function (move, i) {
		const option = document.createElement("li");
		option.id = `moveBoxOption${i}`;
		option.setAttribute("role", "option");
		option.setAttribute("aria-selected", "false");
		option.dataset.move = move;
		option.textContent = move;
		return option;
	}));
	list.hidden = suggestions.length == 0;
	input.setAttribute("aria-expanded", String(suggestions.length > 0));
	countStatus.textContent = canMove && text.trim() ? countMessage(suggestions.length) : ""; // role="status": SCREEN READERS HEAR IT WHEN IT CHANGES
	fitBox();
}

/**
 * @description Puts the arrow keys' highlight on a suggestion
 * @param  {[number]} index [the suggestion, -1 for none]
 */
function setHighlight(index) {
	list.children[highlighted]?.setAttribute("aria-selected", "false");
	highlighted = index;
	const option = list.children[index];
	if (!option) { input.removeAttribute("aria-activedescendant"); return; }
	option.setAttribute("aria-selected", "true");
	input.setAttribute("aria-activedescendant", option.id);
	option.scrollIntoView({ block: "nearest" });
}

/**
 * @description Keeps the list above a phone's keyboard. The keyboard only shrinks the visual viewport on some phones, so the
 * list is sized from that. When there's no room for it under the box's usual spot the box moves to the top of what's showing
 */
function fitBox() {
	box.style.top = "";
	list.style.maxHeight = "";
	if (box.hidden) { return; }
	if (dragPos) { placeDraggedBox(); return; }
	if (list.hidden) { return; }
	const view = window.visualViewport || { offsetTop: 0, height: window.innerHeight };
	const bottom = view.offsetTop + view.height - VIEW_GAP;
	if (bottom - list.getBoundingClientRect().top < MIN_LIST_ROOM || box.getBoundingClientRect().top < view.offsetTop) {
		box.style.top = `${view.offsetTop + BOX_TOP}px`;
	}
	list.style.maxHeight = `${Math.max(bottom - list.getBoundingClientRect().top, 44)}px`; // ONE ROW AT LEAST, IT SCROLLS
}

/**
 * @description Puts a dragged box where the player left it, moved in as far as it takes to stay inside the window. dragPos
 * isn't changed, so a box that moved up for a long list goes back down when the list gets shorter
 */
function placeDraggedBox() {
	const view = window.visualViewport || { offsetLeft: 0, offsetTop: 0, width: window.innerWidth, height: window.innerHeight };
	const extra = box.offsetHeight - view.height;
	if (extra > 0 && !list.hidden) { list.style.maxHeight = `${Math.max(list.offsetHeight - extra, 44)}px`; } // A SHORT WINDOW, THE LIST SCROLLS
	const maxLeft = view.offsetLeft + view.width - box.offsetWidth;
	const maxTop = view.offsetTop + view.height - box.offsetHeight;
	box.style.left = `${Math.max(view.offsetLeft, Math.min(dragPos.left, maxLeft))}px`;
	box.style.top = `${Math.max(view.offsetTop, Math.min(dragPos.top, maxTop))}px`;
}

/* ---------------------------------------------------------------- */
// Drag
/* ---------------------------------------------------------------- */
/**
 * @description Takes hold of the box
 * @param  {[number]} x [the mouse or finger, from the window's left]
 * @param  {[number]} y [from the window's top]
 */
function startDrag(x, y) {
	const rect = box.getBoundingClientRect();
	grab = { x: x - rect.left, y: y - rect.top };
	box.classList.add("dragging");
}

/**
 * @description Moves the box with the mouse or finger, it stops at the window's edges
 * @param  {[number]} x [the mouse or finger, from the window's left]
 * @param  {[number]} y [from the window's top]
 */
function dragTo(x, y) {
	dragPos = { left: x - grab.x, top: y - grab.y };
	fitBox();
	const rect = box.getBoundingClientRect();
	dragPos = { left: rect.left, top: rect.top }; // WHERE IT STOPPED, SO IT DOESN'T LAG BEHIND WHEN THE MOUSE OR FINGER COMES BACK FROM PAST AN EDGE
}

/**
 * @description The left button on the box starts a drag, unless it's on something that has its own click. Stopping the
 * mousedown keeps the cursor in the input
 */
function handleDragStart(e) {
	if (e.button != 0 || grab || e.target.closest("input, button, ul")) { return; }
	e.preventDefault();
	startDrag(e.clientX, e.clientY);
	window.addEventListener("mousemove", handleDragMove, true); // ON THE WINDOW, THE MOUSE CAN OUTRUN THE BOX
	window.addEventListener("mouseup", handleDragEnd, true);
}

/**
 * @description The mouse moved during a drag. The board under the box doesn't see it
 */
function handleDragMove(e) {
	e.stopPropagation();
	if (box.hidden || !(e.buttons & 1)) { handleDragEnd(e); return; } // ESCAPE CLOSED IT, OR THE BUTTON WAS LET GO OUTSIDE THE WINDOW
	dragTo(e.clientX, e.clientY);
}

/**
 * @description The click that comes with letting go of a drag, stopped so it doesn't close the menu (a click away closes it, pages/utils/nav.js)
 */
function stopDragClick(e) {
	e.stopPropagation();
}

/**
 * @description Ends the drag, the box stays where it is until it's closed
 */
function handleDragEnd(e) {
	e.stopPropagation();
	grab = null;
	box.classList.remove("dragging");
	window.removeEventListener("mousemove", handleDragMove, true);
	window.removeEventListener("mouseup", handleDragEnd, true);
	window.addEventListener("click", stopDragClick, { capture: true, once: true });
	setTimeout(function () { window.removeEventListener("click", stopDragClick, true); }, 0); // LET GO OUTSIDE THE WINDOW THERE'S NO CLICK, THE NEXT REAL ONE STILL COUNTS
}

/**
 * @description One finger on the box starts a drag, with the same exceptions as the mouse. Stopping the touchstart
 * keeps the cursor & the keyboard in the input, a tap doesn't move the box
 */
function handleTouchDragStart(e) {
	if (grab || e.touches.length > 1 || e.target.closest("input, button, ul")) { return; }
	e.preventDefault();
	const touch = e.changedTouches[0];
	dragTouch = touch.identifier;
	startDrag(touch.clientX, touch.clientY);
	window.addEventListener("touchmove", handleTouchDragMove, { capture: true, passive: false }); // ON THE WINDOW, THE FINGER CAN OUTRUN THE BOX
	window.addEventListener("touchend", handleTouchDragEnd, true);
	window.addEventListener("touchcancel", handleTouchDragEnd, true);
}

/**
 * @description The dragging finger among the ones that changed
 * @param  {[object]} e [the touch event]
 * @return {[object]} touch [undefined when another finger changed]
 */
function findDragTouch(e) {
	return Array.from(e.changedTouches).find(function (touch) { return touch.identifier == dragTouch; });
}

/**
 * @description The finger moved during a drag. Stopping it keeps the page from scrolling
 */
function handleTouchDragMove(e) {
	const touch = findDragTouch(e);
	if (!touch) { return; }
	e.preventDefault();
	if (box.hidden) { endTouchDrag(); return; } // A MOVE PLAYED OR THE MENU CLOSED IT
	dragTo(touch.clientX, touch.clientY);
}

/**
 * @description The dragging finger came off, the box stays where it is like a mouse drag
 */
function handleTouchDragEnd(e) {
	if (findDragTouch(e)) { endTouchDrag(); }
}

/**
 * @description Ends a finger's drag
 */
function endTouchDrag() {
	grab = null;
	dragTouch = null;
	box.classList.remove("dragging");
	window.removeEventListener("touchmove", handleTouchDragMove, true);
	window.removeEventListener("touchend", handleTouchDragEnd, true);
	window.removeEventListener("touchcancel", handleTouchDragEnd, true);
}

/**
 * @description A click or tap on a suggestion plays it
 */
function handleListClick(e) {
	const option = e.target.closest("[role=option]");
	if (option) { playSuggestion(option.dataset.move); }
}

/**
 * @description Plays a chosen suggestion like it was typed, so a list that just went out of date is refused like a typed move
 * @param  {[string]} move [the suggestion]
 */
function playSuggestion(move) {
	input.value = move;
	playTypedMove(move);
	if (!box.hidden) { input.focus(); updateSuggestions(); fitBox(); } // REFUSED
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
	const blocked = moveBlockReason(game, chessInst.turn());
	if (blocked) { return { reason: blocked }; }
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
 * @description Enter (or a phone keyboard's Go): plays what was typed. A piece that was picked up or
 * an open promotion picker goes back first, the typed move replaces them
 */
function handleSubmit(e) {
	e.preventDefault();
	const text = input.value.trim();
	if (!text) { return; }
	playTypedMove(text);
	fitBox(); // A REFUSAL TAKES UP ROOM
}

/**
 * @description Plays a move or says why it can't be played
 * @param  {[string]} text [the move]
 */
function playTypedMove(text) {
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
 * @description Keys typed in the box stay in the box, so they don't reach the / key's listener or move the TV select box. Escape closes it,
 * the arrow keys move along the list & Enter plays the highlighted move (with nothing highlighted the form plays what was typed)
 */
function handleBoxKey(e) {
	if (!game.TV_BOOL && (e.key == "Tab" || leavesBox(e))) { return; } // THE PAGE'S KEYS (pages/utils/nav.js)
	e.stopPropagation();
	if (e.key == "Escape") { closeMoveBox(); return; }
	if (e.target != input || suggestions.length == 0) { return; }
	if (e.key == "ArrowDown" || e.key == "ArrowUp") {
		e.preventDefault(); // THE CURSOR STAYS WHERE IT IS IN THE INPUT
		setHighlight(stepHighlight(highlighted, suggestions.length, e.key == "ArrowDown" ? 1 : -1));
	} else if (e.key == "Enter" && highlighted >= 0) {
		e.preventDefault(); // NOT THE FORM'S SUBMIT
		playSuggestion(suggestions[highlighted]);
	} else if ((e.key == "Home" || e.key == "End") && highlighted >= 0) { // WITH NOTHING HIGHLIGHTED THEY MOVE THE CURSOR IN THE INPUT
		e.preventDefault();
		setHighlight(e.key == "Home" ? 0 : suggestions.length - 1);
	}
}

/**
 * @description Do Left or Right leave the box? From the X, the box counts as the input with its cursor at that end, so the page's keys move on from it
 * @return {[boolean]} leaves
 */
function leavesBox(e) {
	if (e.key != "ArrowLeft" && e.key != "ArrowRight") { return false; }
	if (e.target == input) { return canLeave(input, e.key); }
	const end = e.key == "ArrowLeft" ? 0 : input.value.length;
	input.focus();
	input.setSelectionRange(end, end);
	return true;
}

/**
 * @description The menu's Type a Move opens the box or closes an open one. The menu stays open, so the box opens without
 * the cursor (a move can't be played under the menu), a click on the input closes the menu & puts the cursor there. A key on the button closes the menu itself & puts the cursor there
 */
function handleTypeMoveBtn(e) {
	e.preventDefault();
	e.stopPropagation();
	if (!box.hidden) { return closeMoveBox(); }
	if (e.detail === 0) { closeMenu(); } // A KEY PRESSED IT (A MOUSE OR FINGER'S CLICK COUNTS FROM 1)
	openMoveBox(e.detail === 0 && !game.menuToggled); // A NEW BOARD LOADING KEEPS THE MENU OPEN
}

/**
 * @description The X closes the box, stopped so the menu stays as it is (a click away closes it, pages/utils/nav.js)
 */
function handleCloseBtn(e) {
	e.stopPropagation();
	closeMoveBox();
}

/**
 * @description The menu button was pressed, the menu has already opened or closed (pages/utils/nav.js). Opening it leaves the box as it was,
 * where it was, without the keyboard so a move can't be played under the menu
 */
function handleMenuToggle() {
	if (game.menuToggled) { input.blur(); }
}

/**
 * @description Adds the box's listeners, it starts closed (the / key or the menu opens it). startGame (gameplay/index.js) calls this once the game has loaded
 */
export function addMoveBoxListeners() {
	document.addEventListener("keydown", handleOpenKey);
	box.addEventListener("keydown", handleBoxKey);
	box.addEventListener("submit", handleSubmit);
	box.addEventListener("mousedown", handleDragStart);
	box.addEventListener("touchstart", handleTouchDragStart, { passive: false });
	input.addEventListener("input", function () { refusal.textContent = ""; updateSuggestions(); });
	list.addEventListener("mousedown", function (e) { e.preventDefault(); }); // THE CURSOR STAYS IN THE INPUT
	list.addEventListener("click", handleListClick);
	window.visualViewport?.addEventListener("resize", fitBox); // A PHONE'S KEYBOARD OPENED OR CLOSED
	window.visualViewport?.addEventListener("scroll", fitBox);
	window.addEventListener("resize", fitBox);
	closeBtn.addEventListener("click", handleCloseBtn);
	optBtn.addEventListener("click", handleMenuToggle);
	optTypeMoveBtn.addEventListener("click", handleTypeMoveBtn);
	optTypeMoveBtn.setAttribute("aria-controls", "moveBox");
	optTypeMoveBtn.setAttribute("aria-expanded", "false");
}
