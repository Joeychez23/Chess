/*
 *  index.js  --  chess frontend
 *	Home Page (/, signed in)
 *	Seven boxes: Play the AI (at a level & color), Play a friend (by username, with your color), Chess Cards (vs Card Guy at a level & color, 3D only), Invites (sent & received),
 *	the player's open games, their finished games & Friends. A player has one AI game (a card game counts) & one friend game open at a time: each box shows its game's board & Continue current game,
 *	& starting another forfeits it (after a second press). Friend invites wait (PENDING) until the friend accepts them in Invites, a challenge link waits until someone opens it & joins,
 *	the socket redraws Play a friend & Invites when one changes. Every game opens on its own page, /play/:gameId. Logout is in the menu (3 lines, top right)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
import "../../../css/nav.css"; // MENU (3 LINES, TOP RIGHT), COLORS & FONTS
import "../../../css/home.css"; // HOME PAGE STYLES
require("../utils/reportErrors.js").startErrorReports(); // BEFORE THE OTHER MODULES RUN, SO THEIR ERRORS ARE REPORTED TOO (#194)
const { InternalAuth } = require("../../auth/index.js");
const { validate, newAiGame, getUserGameData, searchPlayers, acceptInvite, getFriends } = require("../../gameplay/validate/index.js");
const { newCardsGame } = require("../../gameplay/cards/api.js"); // CHESS CARDS: A NEW GAME VS CARD GUY
const { hasWebGL } = require("../../gameplay/three/load.js"); // CHESS CARDS IS 3D ONLY
const { reasonLine } = require("../utils/resultReasons.js"); // A FINISHED GAME'S REASON AS THE RESULT SCREEN SAYS IT
const { preloadImages } = require("../../gameplay/images/index.js");
const { watchGames } = require("../../socket/index.js");
const { timeLeftText } = require("../utils/timeLeft.js"); // A TIME LIMIT'S TIME LEFT ON YOUR GAMES
const { startBoxNav, startDropdowns, startLogoutButtons, showCurrentGame, hideCurrentGame, loadLevels, botLevels, botName, colorText, startLoading, goToPage, stopLoading, startGameLinks, showPageWhenDrawn } = require("../utils/index.js");
const { handleMultiSubmit, handleCreateChallenge, handleCopyChallenge, handleCancelInvite, loadInvites, resetInviteBtn } = require("./invites.js");
const { handleAddFriend, loadFriends } = require("./friends.js");

export const CHESS_URL = "/api/chess"; // CHESS ROUTES LIVE ON THE EXPRESS SERVER (server/routes/api/chessRoutes.js)
export const USER_URL = "/api/user"; // server/routes/api/userRoutes.js
const SEARCH_DELAY = 250; // MS AFTER THE LAST KEY BEFORE A PLAYER SEARCH, SO A NAME TYPED QUICKLY IS ONE OR TWO SEARCHES

const signedInAs = document.getElementById("signedInAs"); // "SIGNED IN // EMAIL"
const welcome = document.getElementById("welcome"); // "WELCOME BACK, USERNAME"
const playerRating = document.getElementById("playerRating"); // "RATING // 1520?", FRIEND GAMES CHANGE IT
const soloBox = document.getElementById("soloBox"); // PLAY THE AI
const optNewSoloBtn = document.getElementById("optNewSolo"); // PLAY THE AI: PLAY AI, OR NEW GAME WHILE AN AI GAME IS OPEN
const aiLevelSelect = document.getElementById("aiLevel"); // ABOVE PLAY AI, FILLED FROM THE SERVER'S LEVELS
const aiColorSelect = document.getElementById("aiColor"); // ALTERNATE, RANDOM, WHITE OR BLACK, RESTART KEEPS IT
const aiFenInput = document.getElementById("aiFen"); // START POSITION (FEN), BLANK = THE STANDARD POSITION, RESTART KEEPS IT
const soloNote = document.getElementById("soloNote"); // NEW GAME: "THIS FORFEITS YOUR CURRENT GAME"
const cardsBox = document.getElementById("cardsBox"); // CHESS CARDS, ITS OPEN GAME SHOWS HERE (THE SAME ONE AT A TIME AS AN AI GAME)
const optNewCardsBtn = document.getElementById("optNewCards"); // CHESS CARDS: START, OR NEW GAME WHILE A CARD GAME IS OPEN. OFF WITHOUT WEBGL
const cardsLevelSelect = document.getElementById("cardsLevel"); // CARD GUY'S LEVEL, THE SAME LEVELS AS THE AI'S
const cardsColorSelect = document.getElementById("cardsColor"); // ALTERNATE, RANDOM, WHITE OR BLACK, RESTART KEEPS IT
const cardsNote = document.getElementById("cardsNote"); // THE FORFEIT WARNING, OR WHY IT CAN'T START (NO 3D)
const friendBox = document.getElementById("friendBox"); // PLAY A FRIEND
const muliplayerForm = document.getElementById("muliplayerForm"); // PLAY A FRIEND: USERNAME & INVITE
export const multiEmailInput = document.getElementById("enterMultiEmail");
const playerResults = document.getElementById("playerResults"); // USERNAMES STARTING WITH WHAT WAS TYPED, PRESSING ONE FILLS THE FIELD
const playerSearchNote = document.getElementById("playerSearchNote"); // NOBODY FOUND, OR WHY THE SEARCH FAILED
export const multiEmailBtn = document.getElementById("enterMultiSubmit");
export const friendColorSelect = document.getElementById("friendColor"); // THE INVITER'S COLOR, THE INVITE SHOWS IT & REMATCHES KEEP IT
export const friendTakebacksSelect = document.getElementById("friendTakebacks"); // THE GAME'S TAKEBACK SETTING, REMATCHES KEEP IT
export const friendDaysSelect = document.getElementById("friendDays"); // THE GAME'S TIME PER MOVE, REMATCHES KEEP IT
export const friendFenInput = document.getElementById("friendFen"); // START POSITION (FEN) FOR THE INVITE, BLANK = THE STANDARD POSITION
export const createChallengeBtn = document.getElementById("createChallenge"); // A LINK ANYONE SIGNED IN CAN OPEN TO PLAY YOU, WITH THE SAME START SETTINGS
export const multiNote = document.getElementById("multiNote"); // WHY AN INVITE DIDN'T GO THROUGH, INVITE'S FORFEIT WARNING
export const noInvites = document.getElementById("noInvites"); // INVITES: "NO INVITES RIGHT NOW"
export const inviteList = document.getElementById("inviteList"); // "BOB INVITED YOU", ACCEPT & DECLINE
export const sentInvite = document.getElementById("sentInvite"); // "INVITE SENT TO BOB // WAITING" & CANCEL INVITE
export const sentInviteText = document.getElementById("sentInviteText");
export const cancelInviteBtn = document.getElementById("cancelInvite");
export const challengeLinkField = document.getElementById("challengeLinkField"); // A SENT CHALLENGE LINK: THE LINK & COPY LINK
export const challengeLinkInput = document.getElementById("challengeLink");
const copyChallengeBtn = document.getElementById("copyChallenge");
export const inviteNote = document.getElementById("inviteNote"); // ACCEPT'S FORFEIT WARNING, WHY AN ACCEPT DIDN'T GO THROUGH
const loadingDiv = document.getElementById("loadingDiv"); // "Loading...", THEN "No open games" IF THERE ARE NONE
const gameList = document.getElementById("gameList");
const noFinished = document.getElementById("noFinished"); // "Loading...", THEN "No finished games" IF THERE ARE NONE
const finishedList = document.getElementById("finishedList");
export const noFriends = document.getElementById("noFriends"); // FRIENDS: "NO FRIENDS YET"
export const friendRequests = document.getElementById("friendRequests"); // "BOB WANTS TO BE FRIENDS", ACCEPT & DECLINE
export const sentRequests = document.getElementById("sentRequests"); // "REQUEST SENT TO BOB // WAITING" & CANCEL
export const friendList = document.getElementById("friendList"); // EACH FRIEND, ONLINE OR NOT, WITH CHALLENGE & REMOVE
const addFriendForm = document.getElementById("addFriendForm");
export const addFriendInput = document.getElementById("addFriendName");
export const addFriendBtn = document.getElementById("addFriendBtn");
export const friendNote = document.getElementById("friendNote"); // WHY A FRIEND ACTION DIDN'T GO THROUGH, REMOVE'S WARNING

const auth = new InternalAuth;
const sessionCheck = auth.getUser(); // STARTS CHECKING THE SESSION NOW INSTEAD OF AFTER THE PAGE LOADS

export let PLAYER_ID;
let CURRENT_GAME_ID = null; // THE PLAYER'S OPEN AI GAME (ONE AT A TIME)
let confirmNewGame = false; // NEW GAME NEEDS A SECOND PRESS WHILE AN AI GAME IS OPEN, IT FORFEITS THAT ONE
let confirmNewCards = false; // THE SAME FOR CHESS CARDS' START (A CARD GAME IS THE PLAYER'S ONE OPEN AI GAME TOO)
export let FRIEND_GAME_ID = null; // THE PLAYER'S OPEN FRIEND GAME (ONE AT A TIME)
export let FRIEND_NAME = "Friend"; // ITS OPPONENT, FOR THE FORFEIT WARNINGS
export let confirmAccept = null; // THE INVITE WHOSE ACCEPT WAS PRESSED ONCE WHILE A FRIEND GAME IS OPEN (SAME WARNING)
let searchTimer = null; // THE PLAYER SEARCH WAITING FOR SEARCH_DELAY
let searchTurn = 0; // A NEWER KEY PRESS MAKES AN OLDER SEARCH'S ANSWER STALE
let homeDrawing = Promise.resolve(); // ONE REDRAW AT A TIME (refreshHome)
let SETTINGS = null; // THE PLAYER'S DEFAULT START SETTINGS (THE SETTINGS PAGE), THE DROPDOWNS START ON THEM

startBoxNav();
startDropdowns(); // ENTER OPENS A DROPDOWN, A NATIVE <select> CAN'T BE OPENED BY A SCRIPT IN SAFARI
startLogoutButtons(auth); // LOGOUT IN THE MENU IS A POST (#332)
preloadImages(); // THE GAME'S IMAGES, AS SOON AS THE PAGE OPENS, SO THE GAME OPENS FROM THE BROWSER CACHE
startGameLinks(); // CONTINUE CURRENT GAME & YOUR GAMES SAY LOADING TOO
optNewSoloBtn.addEventListener("click", handleNewSoloGame);
optNewCardsBtn.addEventListener("click", handleNewCardsGame);
if (cardsBlocked()) { optNewCardsBtn.disabled = true; cardsNote.innerText = "Chess Cards needs 3D, which this device can't show."; } // A CARD GAME IS 3D ONLY
muliplayerForm.addEventListener("submit", handleMultiSubmit); // INVITE BUTTON & ENTER IN THE USERNAME FIELD
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
 * @description Gets the player, then fills the AI levels, the boxes & the open games. The socket keeps Play a friend & Invites up to date.
 * From a game (its Home button) the game stays on screen until all of it is drawn, then fades into it (showPageWhenDrawn)
 */
async function startHome() {
	const sessionUser = await sessionCheck;
	if (!sessionUser) { return auth.login(); } // THE SERVER ONLY SENDS HOME TO SIGNED IN PLAYERS, THIS CATCHES A SESSION THAT ENDED SINCE
	PLAYER_ID = sessionUser.userId.split("auth0|")[1];
	const name = sessionUser.username || sessionUser.screenname; // THE SERVER SENDS A PLAYER WITHOUT A USERNAME TO /settings FIRST
	if (name) { welcome.innerText = `Welcome back, ${name}`; }
	if (sessionUser.email) { signedInAs.innerText = `Signed in // ${sessionUser.email}`; }
	const levelsLoaded = Promise.all([loadLevels(CHESS_URL, aiLevelSelect), loadLevels(CHESS_URL, cardsLevelSelect, false)]); // ONE GET /levels FOR BOTH, CARD GUY'S BY ELO ONLY
	const homeDrawn = refreshHome(true);
	const settingsUsed = useSettings(levelsLoaded, homeDrawn);
	watchGames(refreshHome); // INVITES & FRIEND GAMES CHANGE WITHOUT A RELOAD
	showPageWhenDrawn([levelsLoaded, homeDrawn, settingsUsed]);
}

/**
 * @description Starts the level & color dropdowns on the player's Default start settings, once the levels & the game lists (which carry them) are in
 * @param  {[object]} levelsLoaded [loadLevels() promise]
 * @param  {[object]} homeDrawn [the first refreshHome() promise, it sets SETTINGS]
 */
async function useSettings(levelsLoaded, homeDrawn) {
	await Promise.allSettled([levelsLoaded, homeDrawn]);
	if (!SETTINGS) { return; } // NO ROW YET: THE DROPDOWNS KEEP THEIR DEFAULTS
	aiLevelSelect.value = `${SETTINGS.ai_level}`;
	aiColorSelect.value = SETTINGS.ai_color;
	cardsLevelSelect.value = `${SETTINGS.ai_level}`; // CARD GUY STARTS ON THE AI'S DEFAULTS, IT HAS NONE OF ITS OWN
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
 * @description Loads the player's games & friends from the server & draws Home with them: the rating, the game list, the invites, the friends,
 * the friend box & (first load only) the AI game's board picture. Only call it through refreshHome()
 * @param  {[boolean]} firstLoad [true also reads the default start settings & loads the AI game]
 */
async function drawHome(firstLoad) {
	const [gameData, friendData, levels] = await Promise.all([getUserGameData(CHESS_URL, PLAYER_ID), getFriends(USER_URL), botLevels(CHESS_URL)]); // levels: THE AI GAMES SHOW THEIR BOT'S NAME
	if (firstLoad) { SETTINGS = gameData?.settings || null; } // ONLY ON LOAD, A REDRAW DOESN'T UNDO A PICK
	const releaseHeight = holdPageHeight(); // THE PAGE DOESN'T GET SHORTER WHILE IT'S REDRAWN, SO THE SCROLL STAYS PUT (#240)
	try {
		showRating(gameData?.rating); // A FINISHED FRIEND GAME REDRAWS HOME (SOCKET "games"), SO THE NEW RATING SHOWS
		const friendGame = await openGame(gameData?.friend_game_id);
		const currentGame = (firstLoad && gameData?.ai_game_id) ? loadCurrentGame(gameData.ai_game_id) : null; // ITS BOARD PICTURE, DRAWN ALONGSIDE THE REST
		listGames(gameData, levels);
		listFinishedGames(gameData, levels);
		loadInvites(gameData);
		loadFriends(friendData);
		await loadFriendBox(gameData, friendGame);
		await currentGame; // HOME IS DRAWN ONCE IT'S IN TOO (showPageWhenDrawn)
	} finally { releaseHeight(); }
}

/**
 * @description Keeps the page at least as tall as it is now until the returned function is called. A redraw swaps boxes & lists
 * part by part (some wait on the server or a board picture), & a page that got shorter for a moment moved the scroll (#240)
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
	playerRating.title = rating.provisional ? `Provisional until 10 rated games (${rating.rated_games} so far). Friend games change it, AI games don't` : "Friend games change it, AI games don't";
	playerRating.hidden = false;
}

/**
 * @description GET a game, only if it's still going
 * @param  {[string]} gameId [ai_game_id or friend_game_id from the server]
 * @return {[object]} game [GET /api/chess/game/:gameId response, null when there's no id or it ended since]
 */
async function openGame(gameId) {
	if (!gameId) { return null; }
	const game = await validate(CHESS_URL, gameId, PLAYER_ID, false, false, false); // GET THE GAME
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
	const openGames = gameData?.open_game_list || []; // NEW USERS HAVE NO GAMES YET
	const rows = [];
	for (let i = 0; i < openGames.length; i++) {
		const listElement = document.createElement("li");
		const gameLink = document.createElement("a");
		const opponent = opponentText(openGames[i], levels);
		gameLink.href = `/play/${encodeURIComponent(openGames[i].game_id)}`; // A CARD GAME TOO: THE PLAY PAGE OPENS IT BY ITS MODE
		gameLink.innerHTML = `<span class="label">Game ${i + 1}</span><span class="spec gameInfo"></span><span class="label gameOpen">Open</span>`;
		const opening = openGames[i].opening ? ` // ${openGames[i].opening.eco} ${openGames[i].opening.name}` : "";
		const timeLeft = openGames[i].move_deadline ? ` // ${timeLeftText(openGames[i].move_deadline)}` : "";
		gameLink.querySelector(".gameInfo").innerText = `${opponent} // ${colorText(openGames[i].player_color, openGames[i].start_params)}${opening}${timeLeft}`; // innerText, THE NAME IS NEVER READ AS HTML
		listElement.append(gameLink);
		rows.push(listElement);
	}
	gameList.replaceChildren(...rows); // REDRAWN WHEN THE SOCKET SAYS A GAME CHANGED: BUILT FIRST, THEN SWAPPED IN ONE STEP (#240)
	loadingDiv.hidden = openGames.length > 0;
	if (!openGames.length) { loadingDiv.innerText = "No open games yet. Start one with the AI or a friend."; }
}

/**
 * @description How a game's opponent reads in Your games & Finished games: "Chess Cards" (always vs Card Guy), the AI level's bot or the friend
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
 * @description Lists the player's last 20 finished games, newest first, each one is a link to its replay (/replay/:gameId), which opens on its final board:
 * "Won" & "vs Ada // You play white (random) // Checkmate"
 * @param  {[object]} gameData [GET /api/chess/user/:userId response]
 * @param  {[object]} levels [GET /levels, botLevels(): an AI game shows its bot's name]
 */
function listFinishedGames(gameData, levels) {
	const games = gameData?.closed_game_list || []; // NEW USERS HAVE NO GAMES YET
	const rows = games.map(function (game) {
		const listElement = document.createElement("li");
		const gameLink = document.createElement("a");
		const opponent = opponentText(game, levels);
		const reason = reasonText(game.reason);
		gameLink.href = game.mode === "cards" ? `/play/${encodeURIComponent(game.game_id)}` : `/replay/${encodeURIComponent(game.game_id)}`; // STEP THROUGH IT (#78). A CARD GAME OPENS ON ITS FINAL BOARD, THE REPLAY DOESN'T KNOW THE CARDS
		gameLink.innerHTML = `<span class="label"></span><span class="spec gameInfo"></span>`;
		gameLink.querySelector(".label").innerText = game.winner == "draw" ? "Draw" : game.winner == game.player_color ? "Won" : "Lost";
		gameLink.querySelector(".gameInfo").innerText = `${opponent} // ${colorText(game.player_color, game.start_params)}${reason}`; // innerText, THE NAME IS NEVER READ AS HTML
		listElement.append(gameLink);
		return listElement;
	});
	finishedList.replaceChildren(...rows); // SAME AS listGames (#240)
	noFinished.hidden = games.length > 0;
	if (!games.length) { noFinished.innerText = "No finished games yet. They show up here when a game ends."; }
}

/**
 * @description A finished game's reason after its color: the result screen's line ("by taking the King" -> " // By taking the King"), or the raw word when there is no line (a forfeit)
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
 * @description The player's open AI game: its board & Continue current game go in Play the AI, & Play AI becomes New game. A Chess Cards game goes in its own box the same way
 * (it's the player's one open AI game: starting either kind forfeits it, both buttons ask first)
 * @param  {[string]} gameId [ai_game_id from the server]
 */
async function loadCurrentGame(gameId) {
	const game = await openGame(gameId);
	if (!game) { return; } // ENDED SINCE, PLAY AI STAYS AS IT IS
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
	if (CURRENT_GAME_ID && !confirmNewGame) { // FIRST PRESS
		confirmNewGame = true;
		optNewSoloBtn.innerText = "Forfeit & start";
		return soloNote.innerText = "This forfeits your current game. Press again to start a new one.";
	}
	startLoading(optNewSoloBtn); // "Loading" & THE FILL, ONE GAME PER PRESS
	soloNote.innerText = "";
	const response = await newAiGame(CHESS_URL, undefined, aiColorSelect.value, aiLevelSelect.value, confirmNewGame, aiFenInput.value); // CREATE NEW GAME AT THE PICKED LEVEL, COLOR & POSITION (THE SERVER MAKES THE ID)
	if (response?.status == 400 || response?.status == 429) { stopLoading(); return soloNote.innerText = response.message; } // THE FEN CAN'T BE PLAYED, OR TOO MANY NEW GAMES: NOTHING WAS FORFEITED
	if (response?.status == 503) { stopLoading(); return soloNote.innerText = confirmNewGame ? "Your other game couldn't be closed. Try again." : "A new game couldn't be started. Try again."; } // THE FORFEIT FAILED: NOTHING WAS CREATED (AS handleNewCardsGame)
	if (response?.status == 409) { // AN AI GAME OPENED SINCE (ANOTHER TAB): SHOW IT INSTEAD
		stopLoading();
		soloNote.innerText = "You already have an AI game open";
		return loadCurrentGame(response.game_id);
	}
	if (response?.status != 200) { stopLoading(); return console.log(response); }
	goToPage(`/play/${response.game_id}`); // ONCE THE IMAGES ARE IN
}


/* ---------------------------------------------------------------- */
// Chess Cards
/* ---------------------------------------------------------------- */
/**
 * @description New Chess Cards game vs Card Guy at the picked level & color, then opens it (Restart keeps both). The same flow as Play AI: while an AI or card game is open
 * the first press says it'll be forfeited, the second starts the new game, & one opened since (another tab) is shown instead. Off where 3D isn't available (cardsBlocked). A 503 (the open game couldn't be forfeited) creates nothing & says so
 */
async function handleNewCardsGame(e) {
	e.preventDefault();
	e.stopPropagation();
	if (CURRENT_GAME_ID && !confirmNewCards) { // FIRST PRESS
		confirmNewCards = true;
		optNewCardsBtn.innerText = "Forfeit & start";
		return cardsNote.innerText = "This forfeits your current game. Press again to start a new one.";
	}
	startLoading(optNewCardsBtn); // "Loading" & THE FILL, ONE GAME PER PRESS
	cardsNote.innerText = "";
	const response = await newCardsGame(CHESS_URL, cardsColorSelect.value, cardsLevelSelect.value, confirmNewCards); // THE SERVER MAKES THE ID & PICKS THE SIDES
	if (response?.status === 400 || response?.status === 429) { stopLoading(); return cardsNote.innerText = response.message; } // TOO MANY NEW GAMES: NOTHING WAS FORFEITED
	if (response?.status === 503) { stopLoading(); return cardsNote.innerText = confirmNewCards ? "Your other game couldn't be closed. Try again." : "A new game couldn't be started. Try again."; } // THE FORFEIT FAILED: NOTHING WAS CREATED, PRESS AGAIN. WITH NO REPLACE ASKED IT'S THE SERVER'S OWN 503 (THE DATA SERVICE DOWN, F10-m1)
	if (response?.status === 409) { // AN AI OR CARD GAME OPENED SINCE (ANOTHER TAB): SHOW IT INSTEAD
		stopLoading();
		cardsNote.innerText = "You already have an AI or Chess Cards game open";
		return loadCurrentGame(response.game_id);
	}
	if (response?.status !== 200) { stopLoading(); return console.log(response); }
	goToPage(`/play/${response.game_id}`); // ONCE THE IMAGES ARE IN, THE PLAY PAGE OPENS IT BY ITS MODE
}

/**
 * @description Chess Cards is 3D only: off with no WebGL, & on a touch-first device, where the play page has no 3D (the renderer's can3D() uses the same media query; the renderer stays out of Home's bundle)
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
	if (friendGameId != FRIEND_GAME_ID) { // THE GAME A WARNING WAS ABOUT IS GONE
		resetInviteBtn();
		if (confirmAccept) { confirmAccept = null; inviteNote.innerText = ""; }
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
	button.addEventListener("click", () => {
		multiEmailInput.value = username;
		clearPlayerSearch();
		multiEmailInput.focus();
	});
	item.append(button);
	return item;
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
	if (FRIEND_GAME_ID && confirmAccept != gameId) { // FIRST PRESS
		inviteList.querySelectorAll(".btnCream").forEach((btn) => btn.innerText = "Accept"); // ONE WARNING AT A TIME
		confirmAccept = gameId;
		acceptBtn.innerText = "Forfeit & accept";
		return inviteNote.innerText = `This forfeits your game vs ${FRIEND_NAME}, they win. Press again to accept.`;
	}
	startLoading(acceptBtn); // "Loading" & THE FILL, ONE GAME PER PRESS
	inviteNote.innerText = "";
	const response = await acceptInvite(CHESS_URL, gameId, confirmAccept == gameId);
	if (response?.status == 200) { return goToPage(`/play/${encodeURIComponent(gameId)}`); } // ONCE THE IMAGES ARE IN
	stopLoading();
	await refreshHome(); // THE INVITE OR THE OPEN GAME CHANGED SINCE
	if (response?.status == 409) { inviteNote.innerText = "You already have a friend game open"; }
	else if (response?.message == "They're in another game now") { inviteNote.innerText = "They're in another game now, the invite was removed"; }
	else if (response?.message == "Invite not found") { inviteNote.innerText = "That invite was cancelled"; }
	else { inviteNote.innerText = "Couldn't accept, try again"; }
}
