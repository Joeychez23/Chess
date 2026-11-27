/*
 *  index.js  --  chess frontend
 *	Home Page (/, signed in)
 *	Seven boxes: Play the AI (at a level & color), Play a friend (by username, with your color), Chess Cards (vs Card Guy at a
 *	level & color, 3D only), Invites (sent & received), the player's open games, their finished games & Friends.
 *	A player has one AI game (a card game counts) & one friend game open at a time: each box shows its game's board & Continue
 *	current game, & starting another forfeits it (after a second press). Friend invites wait (PENDING) until the friend accepts
 *	them in Invites, a challenge link waits until someone opens it & joins, the socket redraws Play a friend & Invites when one
 *	changes. Every game opens on its own page, /play/:gameId. Logout is in the menu (3 lines, top right)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
import "../../../css/nav.css"; // Menu (3 lines, top right), colors & fonts
import "../../../css/home.css";
require("../utils/reportErrors.js").startErrorReports(); // Before the other modules run, so their errors are reported too
const { InternalAuth } = require("../../auth/index.js");
const { validate, newAiGame, getUserGameData, searchPlayers, acceptInvite, getFriends } = require("../../gameplay/validate/index.js");
const { newCardsGame } = require("../../gameplay/cards/api.js");
const { hasWebGL } = require("../../gameplay/three/load.js"); // Chess Cards is 3D only
const { reasonLine } = require("../utils/resultReasons.js"); // A finished game's reason as the result screen says it
const { preloadImages } = require("../../gameplay/images/index.js");
const { watchGames } = require("../../socket/index.js");
const { timeLeftText } = require("../utils/timeLeft.js"); // A time limit's time left on your games
const {
	startBoxNav, startDropdowns, startLogoutButtons, showCurrentGame, hideCurrentGame, loadLevels, botLevels, botName, colorText,
	startLoading, goToPage, stopLoading, startGameLinks, showPageWhenDrawn,
} = require("../utils/index.js");
const {
	handleMultiSubmit, handleCreateChallenge, handleCopyChallenge, handleCancelInvite, loadInvites, resetInviteBtn,
} = require("./invites.js");
const { handleAddFriend, loadFriends } = require("./friends.js");

export const CHESS_URL = "/api/chess"; // Chess routes live on the Express server (server/routes/api/chessRoutes.js)
export const USER_URL = "/api/user"; // server/routes/api/userRoutes.js
const SEARCH_DELAY = 250; // ms after the last key before a player search, so a name typed quickly is one or two searches

const signedInAs = document.getElementById("signedInAs"); // "Signed in // email"
const welcome = document.getElementById("welcome"); // "Welcome back, username"
const playerRating = document.getElementById("playerRating"); // "Rating // 1520?", friend games change it
const soloBox = document.getElementById("soloBox"); // Play the AI
const optNewSoloBtn = document.getElementById("optNewSolo"); // Play the AI: Play AI, or New game while an AI game is open
const aiLevelSelect = document.getElementById("aiLevel"); // Above Play AI, filled from the server's levels
const aiColorSelect = document.getElementById("aiColor"); // Alternate, random, white or black, Restart keeps it
const aiFenInput = document.getElementById("aiFen"); // Start position (FEN), blank is the standard position, Restart keeps it
const soloNote = document.getElementById("soloNote"); // New game: "This forfeits your current game"
const cardsBox = document.getElementById("cardsBox"); // Chess Cards, its open game shows here (the same one at a time as an AI game)
const optNewCardsBtn = document.getElementById("optNewCards"); // Chess Cards: Start, or New game while a card game is open
const cardsLevelSelect = document.getElementById("cardsLevel"); // Card Guy's level, the same levels as the AI's
const cardsColorSelect = document.getElementById("cardsColor"); // Alternate, random, white or black, Restart keeps it
const cardsNote = document.getElementById("cardsNote"); // The forfeit warning, or why it can't start (no 3D)
const friendBox = document.getElementById("friendBox"); // Play a friend
const muliplayerForm = document.getElementById("muliplayerForm"); // Play a friend: username & Invite
export const multiEmailInput = document.getElementById("enterMultiEmail");
const playerResults = document.getElementById("playerResults"); // Usernames starting with what was typed, pressing one fills the field
const playerSearchNote = document.getElementById("playerSearchNote"); // Nobody found, or why the search failed
export const multiEmailBtn = document.getElementById("enterMultiSubmit");
export const friendColorSelect = document.getElementById("friendColor"); // The inviter's color, the invite shows it & rematches keep it
export const friendTakebacksSelect = document.getElementById("friendTakebacks"); // The game's takeback setting, rematches keep it
export const friendDaysSelect = document.getElementById("friendDays"); // The game's time per move, rematches keep it
export const friendFenInput = document.getElementById("friendFen"); // Start position (FEN) for the invite, blank is the standard position
export const createChallengeBtn = document.getElementById("createChallenge"); // A link anyone signed in can open to play you, same settings
export const multiNote = document.getElementById("multiNote"); // Why an invite didn't go through, Invite's forfeit warning
export const noInvites = document.getElementById("noInvites"); // Invites: "No invites right now"
export const inviteList = document.getElementById("inviteList"); // "Bob invited you", Accept & Decline
export const sentInvite = document.getElementById("sentInvite"); // "Invite sent to Bob // Waiting" & Cancel invite
export const sentInviteText = document.getElementById("sentInviteText");
export const cancelInviteBtn = document.getElementById("cancelInvite");
export const challengeLinkField = document.getElementById("challengeLinkField"); // A sent challenge link: the link & Copy link
export const challengeLinkInput = document.getElementById("challengeLink");
const copyChallengeBtn = document.getElementById("copyChallenge");
export const inviteNote = document.getElementById("inviteNote"); // Accept's forfeit warning, why an accept didn't go through
const loadingDiv = document.getElementById("loadingDiv"); // "Loading...", then "No open games" if there are none
const gameList = document.getElementById("gameList");
const noFinished = document.getElementById("noFinished"); // "Loading...", then "No finished games" if there are none
const finishedList = document.getElementById("finishedList");
export const noFriends = document.getElementById("noFriends"); // Friends: "No friends yet"
export const friendRequests = document.getElementById("friendRequests"); // "Bob wants to be friends", Accept & Decline
export const sentRequests = document.getElementById("sentRequests"); // "Request sent to Bob // Waiting" & Cancel
export const friendList = document.getElementById("friendList"); // Each friend, online or not, with Challenge & Remove
const addFriendForm = document.getElementById("addFriendForm");
export const addFriendInput = document.getElementById("addFriendName");
export const addFriendBtn = document.getElementById("addFriendBtn");
export const friendNote = document.getElementById("friendNote"); // Why a friend action didn't go through, Remove's warning

const auth = new InternalAuth;
const sessionCheck = auth.getUser(); // Starts checking the session now instead of after the page loads

export let PLAYER_ID;
let CURRENT_GAME_ID = null; // The player's open AI game (one at a time)
let confirmNewGame = false; // New game needs a second press while an AI game is open, it forfeits that one
let confirmNewCards = false; // The same for Chess Cards' Start (a card game is the player's one open AI game too)
export let FRIEND_GAME_ID = null; // The player's open friend game (one at a time)
export let FRIEND_NAME = "Friend"; // Its opponent, for the forfeit warnings
export let confirmAccept = null; // The invite whose Accept was pressed once while a friend game is open (same warning)
let searchTimer = null; // The player search waiting for SEARCH_DELAY
let searchTurn = 0; // A newer key press makes an older search's answer stale
let homeDrawing = Promise.resolve(); // One redraw at a time (refreshHome)
let SETTINGS = null; // The player's default start settings (the Settings page), the dropdowns start on them

startBoxNav();
startDropdowns(); // Enter opens a dropdown, a script can't open a native <select> in Safari
startLogoutButtons(auth); // Logout in the menu is a POST
preloadImages(); // The game's images, as soon as the page opens, so the game opens from the browser cache
startGameLinks(); // Continue current game & Your games say Loading too
optNewSoloBtn.addEventListener("click", handleNewSoloGame);
optNewCardsBtn.addEventListener("click", handleNewCardsGame);
// A card game is 3D only
if (cardsBlocked()) { optNewCardsBtn.disabled = true; cardsNote.innerText = "Chess Cards needs 3D, which this device can't show."; }
muliplayerForm.addEventListener("submit", handleMultiSubmit); // The Invite button & Enter in the username field
multiEmailInput.addEventListener("input", handlePlayerSearch);
createChallengeBtn.addEventListener("click", handleCreateChallenge);
copyChallengeBtn.addEventListener("click", handleCopyChallenge);
cancelInviteBtn.addEventListener("click", handleCancelInvite);
addFriendForm.addEventListener("submit", handleAddFriend);

startHome();

/* ---------------------------------------------------------------- */
// Start Home
/* ---------------------------------------------------------------- */
/**
 * @description Gets the player, then fills the AI levels, the boxes & the open games. The socket keeps Play a friend & Invites
 * up to date. From a game (its Home button) the game stays on screen until all of it is drawn, then fades into it (showPageWhenDrawn)
 */
async function startHome() {
	const sessionUser = await sessionCheck;
	if (!sessionUser) { return auth.login(); } // The server only sends Home to signed in players, this catches a session that ended since
	PLAYER_ID = sessionUser.userId.split("auth0|")[1];
	const name = sessionUser.username || sessionUser.screenname; // The server sends a player without a username to /settings first
	if (name) { welcome.innerText = `Welcome back, ${name}`; }
	if (sessionUser.email) { signedInAs.innerText = `Signed in // ${sessionUser.email}`; }
	// One GET /levels for both, Card Guy's by Elo only
	const levelsLoaded = Promise.all([loadLevels(CHESS_URL, aiLevelSelect), loadLevels(CHESS_URL, cardsLevelSelect, false)]);
	const homeDrawn = refreshHome(true);
	const settingsUsed = useSettings(levelsLoaded, homeDrawn);
	watchGames(refreshHome); // Invites & friend games change without a reload
	showPageWhenDrawn([levelsLoaded, homeDrawn, settingsUsed]);
}

/**
 * @description Starts the level & color dropdowns on the player's Default start settings, once the levels & the game lists
 * (which carry them) are in
 * @param  {[object]} levelsLoaded [loadLevels() promise]
 * @param  {[object]} homeDrawn [the first refreshHome() promise, it sets SETTINGS]
 */
async function useSettings(levelsLoaded, homeDrawn) {
	await Promise.allSettled([levelsLoaded, homeDrawn]);
	if (!SETTINGS) { return; } // No row yet: the dropdowns keep their defaults
	aiLevelSelect.value = `${SETTINGS.ai_level}`;
	aiColorSelect.value = SETTINGS.ai_color;
	cardsLevelSelect.value = `${SETTINGS.ai_level}`; // Card Guy starts on the AI's defaults, it has none of its own
	cardsColorSelect.value = SETTINGS.ai_color;
	friendColorSelect.value = SETTINGS.friend_color;
}

/**
 * @description Redraws Home from the server, one redraw at a time (the socket can send a few in a row)
 * @param  {[boolean]} firstLoad [true also loads the AI game, it only changes from this page]
 */
export function refreshHome(firstLoad) {
	homeDrawing = homeDrawing.then(() => drawHome(firstLoad)).catch((err) => console.log(err));
	return homeDrawing;
}

/**
 * @description Loads the player's games & friends from the server & draws Home with them: the rating, the game list, the invites,
 * the friends, the friend box & (first load only) the AI game's board picture. Only call it through refreshHome()
 * @param  {[boolean]} firstLoad [true also reads the default start settings & loads the AI game]
 */
async function drawHome(firstLoad) {
	const [gameData, friendData, levels] = await Promise.all([ // levels: the AI games show their bot's name
		getUserGameData(CHESS_URL, PLAYER_ID),
		getFriends(USER_URL),
		botLevels(CHESS_URL),
	]);
	if (firstLoad) { SETTINGS = gameData?.settings || null; } // Only on load, a redraw doesn't undo a pick
	const releaseHeight = holdPageHeight(); // The page doesn't get shorter while it's redrawn, so the scroll stays put
	try {
		showRating(gameData?.rating); // A finished friend game redraws Home (socket "games"), so the new rating shows
		const friendGame = await openGame(gameData?.friend_game_id);
		// Its board picture, drawn alongside the rest
		const currentGame = (firstLoad && gameData?.ai_game_id) ? loadCurrentGame(gameData.ai_game_id) : null;
		listGames(gameData, levels);
		listFinishedGames(gameData, levels);
		loadInvites(gameData);
		loadFriends(friendData);
		await loadFriendBox(gameData, friendGame);
		await currentGame; // Home is drawn once it's in too (showPageWhenDrawn)
	} finally { releaseHeight(); }
}

/**
 * @description Keeps the page at least as tall as it is now until the returned function is called. A redraw swaps boxes & lists
 * part by part (some wait on the server or a board picture), & a page that got shorter for a moment moved the scroll
 * @return {[function]} release [puts the page's height back to its CSS (body min-height 100dvh)]
 */
function holdPageHeight() {
	const body = document.body;
	body.style.minHeight = `${body.offsetHeight}px`;
	return function () { body.style.removeProperty("min-height"); };
}

/**
 * @description Shows the player's rating under the welcome, with a ? while it's provisional (their first 10 rated games)
 * @param  {[object]} rating [{ rating, provisional, rated_games } from GET /user/:userId, left out = nothing shown]
 */
function showRating(rating) {
	if (!rating) { return; }
	playerRating.innerText = `Rating // ${rating.rating}${rating.provisional ? "?" : ""}`;
	playerRating.title = rating.provisional
		? `Provisional until 10 rated games (${rating.rated_games} so far). Friend games change it, AI games don't`
		: "Friend games change it, AI games don't";
	playerRating.hidden = false;
}

/**
 * @description GET a game, only if it's still going
 * @param  {[string]} gameId [ai_game_id or friend_game_id from the server]
 * @return {[object]} game [GET /api/chess/game/:gameId response, null when there's no id or it ended since]
 */
async function openGame(gameId) {
	if (!gameId) { return null; }
	const game = await validate(CHESS_URL, gameId, PLAYER_ID, false, false, false);
	if (game?.status != 200 || game.state != "OPEN") { return null; }
	return game;
}


/* ---------------------------------------------------------------- */
// Your Games
/* ---------------------------------------------------------------- */
/**
 * @description Lists the player's open games, each one is a link to /play/:gameId with its opponent & start settings:
 * "vs Ada // You play white (random)", "vs Bob // You play black // C20 King's Pawn Game". They're also shown in their boxes
 * @param  {[object]} gameData [GET /api/chess/user/:userId response]
 * @param  {[object]} levels [GET /levels, botLevels(): an AI game shows its bot's name]
 */
function listGames(gameData, levels) {
	const openGames = gameData?.open_game_list || []; // New users have no games yet
	const rows = [];
	for (let i = 0; i < openGames.length; i++) {
		const game = openGames[i];
		const listElement = document.createElement("li");
		const gameLink = document.createElement("a");
		const opponent = opponentText(game, levels);
		gameLink.href = `/play/${encodeURIComponent(game.game_id)}`; // A card game too: the play page opens it by its mode
		gameLink.innerHTML = `<span class="label">Game ${i + 1}</span><span class="spec gameInfo"></span><span class="label gameOpen">Open</span>`;
		const opening = game.opening ? ` // ${game.opening.eco} ${game.opening.name}` : "";
		const timeLeft = game.move_deadline ? ` // ${timeLeftText(game.move_deadline)}` : "";
		const settings = colorText(game.player_color, game.start_params);
		// innerText: a name is never HTML
		gameLink.querySelector(".gameInfo").innerText = `${opponent} // ${settings}${opening}${timeLeft}`;
		listElement.append(gameLink);
		rows.push(listElement);
	}
	gameList.replaceChildren(...rows); // Redrawn when the socket says a game changed: built first, then swapped in one step
	loadingDiv.hidden = openGames.length > 0;
	if (!openGames.length) { loadingDiv.innerText = "No open games yet. Start one with the AI or a friend."; }
}

/**
 * @description How a game's opponent reads in Your games & Finished games: "Chess Cards" (always vs Card Guy), the AI level's bot
 * or the friend
 * @param  {[object]} game [one of GET /api/chess/user/:userId's game lists]
 * @param  {[object]} levels [GET /levels, botLevels()]
 * @return {[string]} text ["Chess Cards", "vs Ada", "vs AI // Level 1300" when the levels didn't load, "vs Bob"]
 */
function opponentText(game, levels) {
	if (game.mode === "cards") { return "Chess Cards"; }
	return game.ai ? `vs ${botName(levels, game.ai_level) || `AI // Level ${game.ai_level}`}` : `vs ${game.opponent_name || "Friend"}`;
}


/* ---------------------------------------------------------------- */
// Finished Games
/* ---------------------------------------------------------------- */
/**
 * @description Lists the player's last 20 finished games, newest first, each one is a link to its replay (/replay/:gameId),
 * which opens on its final board: "Won" & "vs Ada // You play white (random) // Checkmate"
 * @param  {[object]} gameData [GET /api/chess/user/:userId response]
 * @param  {[object]} levels [GET /levels, botLevels(): an AI game shows its bot's name]
 */
function listFinishedGames(gameData, levels) {
	const games = gameData?.closed_game_list || []; // New users have no games yet
	const rows = games.map(function (game) {
		const listElement = document.createElement("li");
		const gameLink = document.createElement("a");
		const opponent = opponentText(game, levels);
		const reason = reasonText(game.reason);
		// Step through it. A card game opens on its final board, the replay doesn't know the cards
		gameLink.href = game.mode === "cards" ? `/play/${encodeURIComponent(game.game_id)}` : `/replay/${encodeURIComponent(game.game_id)}`;
		gameLink.innerHTML = `<span class="label"></span><span class="spec gameInfo"></span>`;
		gameLink.querySelector(".label").innerText = game.winner == "draw" ? "Draw" : game.winner == game.player_color ? "Won" : "Lost";
		const settings = colorText(game.player_color, game.start_params);
		gameLink.querySelector(".gameInfo").innerText = `${opponent} // ${settings}${reason}`; // innerText: a name is never HTML
		listElement.append(gameLink);
		return listElement;
	});
	finishedList.replaceChildren(...rows); // Built first, then swapped in one step, as in listGames
	noFinished.hidden = games.length > 0;
	if (!games.length) { noFinished.innerText = "No finished games yet. They show up here when a game ends."; }
}

/**
 * @description A finished game's reason after its color: the result screen's line ("by taking the King" -> " // By taking the King"),
 * or the raw word when there is no line (a forfeit)
 * @param  {[string]} reason [the stored reason or null]
 * @return {[string]} text [" // ..." or ""]
 */
function reasonText(reason) {
	const text = reasonLine(reason) || reason;
	return text ? ` // ${text[0].toUpperCase()}${text.slice(1)}` : "";
}


/* ---------------------------------------------------------------- */
// Current Game
/* ---------------------------------------------------------------- */
/**
 * @description The player's open AI game: its board & Continue current game go in Play the AI, & Play AI becomes New game.
 * A Chess Cards game goes in its own box the same way (it's the player's one open AI game: starting either kind forfeits it,
 * both buttons ask first)
 * @param  {[string]} gameId [ai_game_id from the server]
 */
async function loadCurrentGame(gameId) {
	const game = await openGame(gameId);
	if (!game) { return; } // Ended since, Play AI stays as it is
	CURRENT_GAME_ID = gameId;
	const cards = game.mode === "cards";
	const button = cards ? optNewCardsBtn : optNewSoloBtn;
	button.innerText = "New game";
	button.classList.replace("btnCream", "btnLine");
	await showCurrentGame(cards ? cardsBox : soloBox, game, `/play/${encodeURIComponent(gameId)}`);
}


/* ---------------------------------------------------------------- */
// Play AI
/* ---------------------------------------------------------------- */
/**
 * @description New game vs the AI at the picked level & color (Random lets the server pick), then opens it. Restart keeps both.
 * While an AI game is open the first press says it'll be forfeited, the second starts the new game (the server forfeits the open one)
 */
async function handleNewSoloGame(e) {
	e.preventDefault();
	e.stopPropagation();
	if (CURRENT_GAME_ID && !confirmNewGame) { // First press
		confirmNewGame = true;
		optNewSoloBtn.innerText = "Forfeit & start";
		return soloNote.innerText = "This forfeits your current game. Press again to start a new one.";
	}
	startLoading(optNewSoloBtn); // "Loading" & the fill, one game per press
	soloNote.innerText = "";
	// The server makes the id
	const response = await newAiGame(CHESS_URL, undefined, aiColorSelect.value, aiLevelSelect.value, confirmNewGame, aiFenInput.value);
	// The FEN can't be played, or too many new games: nothing was forfeited
	if (response?.status == 400 || response?.status == 429) {
		stopLoading();
		return soloNote.innerText = response.message;
	}
	// The forfeit failed: nothing was created (as in handleNewCardsGame)
	if (response?.status == 503) { stopLoading(); return soloNote.innerText = confirmNewGame ? "Your other game couldn't be closed. Try again." : "A new game couldn't be started. Try again."; }
	if (response?.status == 409 && response.game_id) { // An AI game opened since (another tab): show it instead
		stopLoading();
		soloNote.innerText = "You already have an AI game open";
		return loadCurrentGame(response.game_id);
	}
	if (response?.status != 200) {
		stopLoading();
		return console.log(response);
	}
	goToPage(`/play/${response.game_id}`); // Once the images are in
}


/* ---------------------------------------------------------------- */
// Chess Cards
/* ---------------------------------------------------------------- */
/**
 * @description New Chess Cards game vs Card Guy at the picked level & color, then opens it (Restart keeps both). The same flow
 * as Play AI: while an AI or card game is open the first press says it'll be forfeited, the second starts the new game, & one
 * opened since (another tab) is shown instead. Off where 3D isn't available (cardsBlocked). A 503 (the open game couldn't be
 * forfeited) creates nothing & says so
 */
async function handleNewCardsGame(e) {
	e.preventDefault();
	e.stopPropagation();
	if (CURRENT_GAME_ID && !confirmNewCards) { // First press
		confirmNewCards = true;
		optNewCardsBtn.innerText = "Forfeit & start";
		return cardsNote.innerText = "This forfeits your current game. Press again to start a new one.";
	}
	startLoading(optNewCardsBtn); // "Loading" & the fill, one game per press
	cardsNote.innerText = "";
	// The server makes the id & picks the sides
	const response = await newCardsGame(CHESS_URL, cardsColorSelect.value, cardsLevelSelect.value, confirmNewCards);
	if (response?.status === 400 || response?.status === 429) { // Too many new games: nothing was forfeited
		stopLoading();
		return cardsNote.innerText = response.message;
	}
	// The forfeit failed: nothing was created, press again. With no replace asked it's the server's own 503 (the data service is down)
	if (response?.status === 503) {
		stopLoading();
		return cardsNote.innerText = confirmNewCards
			? "Your other game couldn't be closed. Try again."
			: "A new game couldn't be started. Try again.";
	}
	if (response?.status === 409 && response.game_id) { // An AI or card game opened since (another tab): show it instead
		stopLoading();
		cardsNote.innerText = "You already have an AI or Chess Cards game open";
		return loadCurrentGame(response.game_id);
	}
	if (response?.status !== 200) {
		stopLoading();
		return console.log(response);
	}
	goToPage(`/play/${response.game_id}`); // Once the images are in, the play page opens it by its mode
}

/**
 * @description Chess Cards is 3D only: off with no WebGL, & on a touch-first device, where the play page has no 3D (the renderer's
 * can3D() uses the same media query; the renderer stays out of Home's bundle)
 * @return {[boolean]} blocked
 */
function cardsBlocked() {
	return !hasWebGL() || window.matchMedia("(pointer: coarse)").matches;
}


/* ---------------------------------------------------------------- */
// Play a Friend
/* ---------------------------------------------------------------- */
/**
 * @description Draws Play a friend: the open friend game (board & Continue current game), then the invite form.
 * While a friend game is open Invite turns into a line button, it forfeits that game
 * @param  {[object]} gameData [GET /api/chess/user/:userId response]
 * @param  {[object]} friendGame [the open friend game or null]
 */
async function loadFriendBox(gameData, friendGame) {
	const friendGameId = friendGame ? gameData.friend_game_id : null;
	if (friendGameId != FRIEND_GAME_ID) { // The game a warning was about is gone
		resetInviteBtn();
		if (confirmAccept) {
			confirmAccept = null;
			inviteNote.innerText = "";
		}
	}
	FRIEND_GAME_ID = friendGameId;
	FRIEND_NAME = friendGame?.opponent_name || "Friend";
	multiEmailBtn.classList.replace(FRIEND_GAME_ID ? "btnCream" : "btnLine", FRIEND_GAME_ID ? "btnLine" : "btnCream");

	if (friendGame) { await showCurrentGame(friendBox, friendGame, `/play/${encodeURIComponent(friendGameId)}`); }
	else { hideCurrentGame(friendBox); }
}

/**
 * @description Searches for players as a username is typed, once the keys stop for SEARCH_DELAY
 */
function handlePlayerSearch() {
	clearPlayerSearch();
	const prefix = multiEmailInput.value.trim();
	if (!/^[A-Za-z0-9_-]{2,20}$/.test(prefix)) { return; } // server/utils/username.js readSearchPrefix
	const turn = searchTurn;
	searchTimer = setTimeout(() => showPlayers(prefix, turn), SEARCH_DELAY);
}

/**
 * @description Asks for the usernames & lists them under the field, unless another key was pressed since
 * @param  {[string]} prefix [what was typed]
 * @param  {[number]} turn [searchTurn when it was typed]
 */
async function showPlayers(prefix, turn) {
	const response = await searchPlayers(USER_URL, prefix);
	if (turn != searchTurn) { return; }
	if (response?.status == 429) { return playerSearchNote.innerText = response.message; }
	if (response?.status != 200) { return playerSearchNote.innerText = "Couldn't search for players, try again"; }
	if (!response.usernames.length) { return playerSearchNote.innerText = "No players found"; }
	playerResults.replaceChildren(...response.usernames.map(playerResult));
	playerResults.hidden = false;
	playerSearchNote.innerText = `${response.usernames.length} player${response.usernames.length == 1 ? "" : "s"} found`;
}

/**
 * @description One found player: pressing it fills the field, ready for Invite
 * @param  {[string]} username [as they wrote it]
 * @return {[element]} item [the list item]
 */
function playerResult(username) {
	const item = document.createElement("li");
	const button = document.createElement("button");
	button.type = "button";
	button.className = "btn btnLine";
	button.textContent = username;
	button.addEventListener("click", () => pickPlayer(username));
	item.append(button);
	return item;
}

/**
 * @description A found player was pressed: their username goes in the field & the list closes
 * @param  {[string]} username [as they wrote it]
 */
function pickPlayer(username) {
	multiEmailInput.value = username;
	clearPlayerSearch();
	multiEmailInput.focus();
}

/**
 * @description Clears the found players & cancels a search still waiting or on its way
 */
export function clearPlayerSearch() {
	clearTimeout(searchTimer);
	searchTurn++;
	playerResults.replaceChildren();
	playerResults.hidden = true;
	playerSearchNote.innerText = "";
}

/**
 * @description Checks what was typed could be a username (server/utils/username.js has the full rules) before the invite is sent
 * @param  {[string]} username [what was typed]
 * @return {[boolean]} valid
 */
export function validateUsername(username) {
	return /^[A-Za-z0-9_-]{3,20}$/.test(username);
}

/**
 * @description Starts an invited game & opens it. While a friend game is open the first press says it'll be forfeited
 */
export async function handleAccept(e, gameId, acceptBtn) {
	e.preventDefault();
	e.stopPropagation();
	if (FRIEND_GAME_ID && confirmAccept != gameId) { // First press
		inviteList.querySelectorAll(".btnCream").forEach((button) => button.innerText = "Accept"); // One warning at a time
		confirmAccept = gameId;
		acceptBtn.innerText = "Forfeit & accept";
		return inviteNote.innerText = `This forfeits your game vs ${FRIEND_NAME}, they win. Press again to accept.`;
	}
	startLoading(acceptBtn); // "Loading" & the fill, one game per press
	inviteNote.innerText = "";
	const response = await acceptInvite(CHESS_URL, gameId, confirmAccept == gameId);
	if (response?.status == 200) { return goToPage(`/play/${encodeURIComponent(gameId)}`); } // Once the images are in
	stopLoading();
	await refreshHome(); // The invite or the open game changed since
	if (response?.status == 409 && response.game_id) { inviteNote.innerText = "You already have a friend game open"; }
	else if (response?.message == "They're in another game now") {
		inviteNote.innerText = "They're in another game now, the invite was removed";
	}
	else if (response?.message == "Invite not found") { inviteNote.innerText = "That invite was cancelled"; }
	else { inviteNote.innerText = "Couldn't accept, try again"; }
}
