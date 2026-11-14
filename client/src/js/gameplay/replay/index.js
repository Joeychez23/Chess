/*
 *  index.js  --  chess frontend
 *	Replay Viewer (#78)
 *	Steps through a finished game on the read-only board (/replay/:gameId): the bar under the board (first, back, forward, last & the
 *	move, "12... Nxe4"), Left, Right, Home & End. Every position comes from replay/positions.js, the board draws it with showPosition
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, chessInst } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE BOARD THAT'S DRAWN
const { showPosition, startSlide, onReadOnlySlide, playMoveSound } = require("../moves/index.js"); // DRAWS A POSITION ON THE READ-ONLY BOARD, SLIDES A STEP & ITS SOUND
const { showStatus } = require("../status/index.js"); // THE MESSAGE AREA ON THE PLAY PAGE
const { setCurrentPly, onMoveSelect } = require("../movelist/index.js"); // THE MOVE LIST'S HIGHLIGHT & ITS CLICKS
const { monitorState3D, currentView, VIEWS, skipNextAnimation3D } = require("../renderer/index.js"); // THE 3D ROOM'S MONITOR OWNS THE KEYS WHILE IT'S ZOOMED IN, WHICH BOARD IS ON
const { arrowKey } = require("../../pages/utils/nav.js"); // W, A, S & D ARE THE ARROWS
const { buildPositions, checkReplay, moveLabel, stepPlan } = require("./positions.js"); // EVERY POSITION OF THE GAME, WITH ITS FACING
const { replayKeyAction } = require("./keys.js"); // WHAT A KEY DOES HERE

const bar = document.getElementById("replayBar"); // THE BAR UNDER THE BOARD
const firstBtn = document.getElementById("replayFirst");
const backBtn = document.getElementById("replayBack");
const forwardBtn = document.getElementById("replayForward");
const lastBtn = document.getElementById("replayLast");
const moveText = document.getElementById("replayMove"); // "12... Nxe4", SCREEN READERS HEAR EACH STEP
const moveListPanel = document.getElementById("moveList"); // ITS OWN KEYS MOVE BETWEEN THE ROWS

let positions = []; // replay/positions.js buildPositions()
let index = 0; // THE POSITION ON THE BOARD, 0 = THE START
let pending = null; // THE POSITION A SLIDE IS GOING TO, null WHILE NOTHING SLIDES

/* ---------------------------------------------------------------- */
// Start
/* ---------------------------------------------------------------- */
/**
 * @description Starts the replay once the read-only board has loaded the game (pages/play/index.js). It opens on the last position, like
 * the game's own board. Saved moves that can't be played, or don't lead to the saved board (old or damaged data), leave the board on
 * the server's final position with a message & no bar: a wrong position is never shown
 * @param  {[object]} response [the game, from renderCanvas()]
 */
export function startReplay(response) {
	try {
		positions = buildPositions(response.moves || [], response.start_params?.fen);
		if (!checkReplay(positions, response.game_board)) { throw new Error("The saved moves don't lead to the saved board"); }
	} catch (err) {
		console.log(err);
		positions = [];
		return showStatus("replay", "This game's moves can't be replayed. Showing its final position.");
	}
	document.body.classList.add("replay"); // THE BAR'S STRIP: THE BOARD, TRAYS & MOVE LIST MOVE UP (css/style.css --replay-bar-height)
	bar.hidden = false;
	firstBtn.addEventListener("click", function () { go(0); });
	backBtn.addEventListener("click", function () { go(at() - 1); });
	forwardBtn.addEventListener("click", function () { go(at() + 1); });
	lastBtn.addEventListener("click", function () { go(positions.length - 1); });
	onReadOnlySlide(landStep); // A STEP'S SLIDE LANDED (gameplay/draw)
	onMoveSelect(function (ply) { go(ply); }); // A MOVE IN THE LIST: THE POSITION AFTER IT
	document.addEventListener("keydown", handleReplayKey, true); // CAPTURE: BEFORE THE PAGE'S LEFT & RIGHT MOVE THE FOCUS (pages/utils/nav.js)
	show(positions.length - 1);
}

/* ---------------------------------------------------------------- */
// Keys
/* ---------------------------------------------------------------- */
/**
 * @description Left & Right step, Home & End go to the start & the end. Not while the menu is open, the move list or a text box has the
 * focus, the 3D monitor is zoomed in or a modifier is down (replay/keys.js). A held key repeats as jumps, never queued slides
 * @param  {[object]} e [the keydown]
 */
function handleReplayKey(e) {
	const focused = document.activeElement;
	const action = replayKeyAction(arrowKey(e), {
		menuOpen: game.menuToggled,
		inMoveList: moveListPanel.contains(focused),
		inTextBox: Boolean(focused && (["INPUT", "TEXTAREA", "SELECT"].includes(focused.tagName) || focused.isContentEditable)),
		monitorBusy: (monitorState3D() ?? "idle") !== "idle" || focused?.id === "monitorStop",
		modifier: e.altKey || e.ctrlKey || e.metaKey || e.shiftKey,
	});
	if (!action) { return; }
	e.preventDefault();
	e.stopPropagation();
	const targets = { first: 0, back: at() - 1, forward: at() + 1, last: positions.length - 1 };
	go(targets[action], { repeat: e.repeat });
}

/* ---------------------------------------------------------------- */
// Step
/* ---------------------------------------------------------------- */
/**
 * @description Where the replay is: the position a slide is going to, else the one on the board. A step during a slide counts from there
 * @return {[number]}
 */
function at() {
	return pending ?? index;
}

/**
 * @description Goes to a position (clamped to the game). One step slides (replay/positions.js stepPlan), anything further is set at once.
 * A held key, or a step while a slide is still going, is set at once too: the slide stops where it is & slides never queue up
 * @param  {[number]} target [the position, 0 = the start]
 * @param  {[object]} options [{ repeat: a held key }]
 */
function go(target, { repeat = false } = {}) {
	if (!positions.length) { return; }
	const sliding = pending !== null || game.tiles.some(function (tile) { return tile.isSliding; });
	const from = at();
	const plan = stepPlan(positions, from, target, { animate: !repeat && !sliding });
	if (!plan) { return; }
	if (plan.kind === "forward") { // THE MOVE SLIDES LIKE THE OPPONENT'S IN A GAME (knights hop), IT'S PLAYED WHEN IT LANDS
		pending = from + 1;
		game.moveObj = { from: plan.move.from, to: plan.move.to, promotion: plan.move.promotion };
		return startSlide(plan.move.from, plan.move.to);
	}
	if (plan.kind === "back") { // THE MOVE SLIDES IN REVERSE, to -> from, FACING THE WAY IT DID BEFORE (KNIGHTS HOP BACKWARDS). THE POSITION BEFORE IT
		// IS SET WHEN IT LANDS: THE TAKEN PIECE COMES BACK (EN PASSANT BESIDE IT) & CASTLING'S ROOK GOES HOME
		const { move } = plan;
		if (move.promotion && currentView() !== VIEWS.THREE_D) { // A PROMOTED PIECE TURNS BACK INTO ITS PAWN FIRST (3D DOES THAT ITSELF, animateUndo)
			chessInst.remove(move.to);
			chessInst.put({ type: "p", color: move.color }, move.to); // put() TAKES A PAWN ON THE LAST RANK, load() WOULD REFUSE THE FEN
		}
		pending = from - 1;
		game.moveObj = { from: move.to, to: move.from, face: plan.face || undefined };
		return startSlide(move.to, move.from);
	}
	pending = null;
	skipNextAnimation3D(); // A JUMP IS SET AT ONCE ON 3D TOO
	show(plan.target);
}

/**
 * @description A step's slide landed: its sound (the menu's Sound setting), then the position it was going to. It lands halfway through
 * drawing a frame (gameplay/draw), so the position is set a tick later, once that frame is done: set now, the rest of the frame would
 * draw the old board & no new frame would come (like updateOpponentStateSlide's tick). A jump meanwhile wins (pending is cleared)
 */
function landStep() {
	if (pending === null) { return; }
	const to = pending;
	playMoveSound();
	setTimeout(function () {
		if (pending !== to) { return; }
		pending = null;
		show(to);
	});
}

/**
 * @description Puts a position on the board at once & updates the bar
 * @param  {[number]} i [the position]
 */
function show(i) {
	const { fen, facing, move } = positions[i];
	showPosition({ fen, facing, lastMove: move ? [move.from, move.to] : null });
	index = i;
	moveText.textContent = moveLabel(positions, i);
	setCurrentPly(i || null); // THE START HAS NO MOVE
	const focused = document.activeElement;
	firstBtn.disabled = backBtn.disabled = i === 0;
	forwardBtn.disabled = lastBtn.disabled = i === positions.length - 1;
	if (focused?.disabled && bar.contains(focused)) { (i === 0 ? forwardBtn : backBtn).focus(); } // A BUTTON THAT JUST TURNED OFF WOULD DROP THE FOCUS TO THE PAGE
}
