/*
 *  index.js  --  chess frontend
 *	Home Page (/, signed in)
 *	Six boxes: Play the AI (at a level & color), Play a friend (by username or email, with your color), Invites (sent & received), the player's open games, their finished games & Friends.
 *	A player has one AI game & one friend game open at a time: each box shows its game's board & Continue current game,
 *	& starting another forfeits it (after a second press). Friend invites wait (PENDING) until the friend accepts them in Invites,
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
const { validate, newAiGame, getUserGameData, initMultiplayerGame, searchPlayers, acceptInvite, declineInvite, getFriends, friendAction } = require("../../gameplay/validate/index.js");
const { preloadImages } = require("../../gameplay/images/index.js");
const { watchGames } = require("../../socket/index.js");
const { startNav, startLogoutButtons, showCurrentGame, hideCurrentGame, loadLevels, colorText, startLoading, goToPage, stopLoading, startGameLinks, showPageWhenDrawn } = require("../utils/index.js");

const CHESS_URL = "/api/chess"; // CHESS ROUTES LIVE ON THE EXPRESS SERVER (server/routes/api/chessRoutes.js)
const USER_URL = "/api/user"; // server/routes/api/userRoutes.js
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
const friendBox = document.getElementById("friendBox"); // PLAY A FRIEND
const muliplayerForm = document.getElementById("muliplayerForm"); // PLAY A FRIEND: EMAIL & INVITE
const multiEmailInput = document.getElementById("enterMultiEmail");
const playerResults = document.getElementById("playerResults"); // USERNAMES STARTING WITH WHAT WAS TYPED, PRESSING ONE FILLS THE FIELD
const playerSearchNote = document.getElementById("playerSearchNote"); // NOBODY FOUND, OR WHY THE SEARCH FAILED
const multiEmailBtn = document.getElementById("enterMultiSubmit");
const friendColorSelect = document.getElementById("friendColor"); // THE INVITER'S COLOR, THE INVITE SHOWS IT & REMATCHES KEEP IT
const friendTakebacksSelect = document.getElementById("friendTakebacks"); // THE GAME'S TAKEBACK SETTING, REMATCHES KEEP IT
const friendFenInput = document.getElementById("friendFen"); // START POSITION (FEN) FOR THE INVITE, BLANK = THE STANDARD POSITION
const multiNote = document.getElementById("multiNote"); // WHY AN INVITE DIDN'T GO THROUGH, INVITE'S FORFEIT WARNING
const noInvites = document.getElementById("noInvites"); // INVITES: "NO INVITES RIGHT NOW"
const inviteList = document.getElementById("inviteList"); // "BOB INVITED YOU", ACCEPT & DECLINE
const sentInvite = document.getElementById("sentInvite"); // "INVITE SENT TO BOB // WAITING" & CANCEL INVITE
const sentInviteText = document.getElementById("sentInviteText");
const cancelInviteBtn = document.getElementById("cancelInvite");
const inviteNote = document.getElementById("inviteNote"); // ACCEPT'S FORFEIT WARNING, WHY AN ACCEPT DIDN'T GO THROUGH
const loadingDiv = document.getElementById("loadingDiv"); // "Loading...", THEN "No open games" IF THERE ARE NONE
const gameList = document.getElementById("gameList");
const noFinished = document.getElementById("noFinished"); // "Loading...", THEN "No finished games" IF THERE ARE NONE
const finishedList = document.getElementById("finishedList");
const noFriends = document.getElementById("noFriends"); // FRIENDS: "NO FRIENDS YET"
const friendRequests = document.getElementById("friendRequests"); // "BOB WANTS TO BE FRIENDS", ACCEPT & DECLINE
const sentRequests = document.getElementById("sentRequests"); // "REQUEST SENT TO BOB // WAITING" & CANCEL
const friendList = document.getElementById("friendList"); // EACH FRIEND, ONLINE OR NOT, WITH CHALLENGE & REMOVE
const addFriendForm = document.getElementById("addFriendForm");
const addFriendInput = document.getElementById("addFriendName");
const addFriendBtn = document.getElementById("addFriendBtn");
const friendNote = document.getElementById("friendNote"); // WHY A FRIEND ACTION DIDN'T GO THROUGH, REMOVE'S WARNING

const auth = new InternalAuth;
const sessionCheck = auth.getUser(); // STARTS CHECKING THE SESSION NOW INSTEAD OF AFTER THE PAGE LOADS

let PLAYER_ID;
let CURRENT_GAME_ID = null; // THE PLAYER'S OPEN AI GAME (ONE AT A TIME)
let confirmNewGame = false; // NEW GAME NEEDS A SECOND PRESS WHILE AN AI GAME IS OPEN, IT FORFEITS THAT ONE
let FRIEND_GAME_ID = null; // THE PLAYER'S OPEN FRIEND GAME (ONE AT A TIME)
let FRIEND_NAME = "Friend"; // ITS OPPONENT, FOR THE FORFEIT WARNINGS
let SENT_INVITE_ID = null; // THE PLAYER'S SENT INVITE (ONE AT A TIME)
let confirmInvite = false; // INVITE NEEDS A SECOND PRESS WHILE A FRIEND GAME IS OPEN, IT FORFEITS THAT ONE
let confirmAccept = null; // THE INVITE WHOSE ACCEPT WAS PRESSED ONCE WHILE A FRIEND GAME IS OPEN (SAME WARNING)
let confirmRemove = null; // THE FRIEND WHOSE REMOVE WAS PRESSED ONCE
let searchTimer = null; // THE PLAYER SEARCH WAITING FOR SEARCH_DELAY
let searchTurn = 0; // A NEWER KEY PRESS MAKES AN OLDER SEARCH'S ANSWER STALE
let homeDrawing = Promise.resolve(); // ONE REDRAW AT A TIME (refreshHome)
let SETTINGS = null; // THE PLAYER'S DEFAULT START SETTINGS (THE SETTINGS PAGE), THE DROPDOWNS START ON THEM

startNav();
startLogoutButtons(auth); // LOGOUT IN THE MENU IS A POST (#332)
preloadImages(); // THE GAME'S IMAGES, AS SOON AS THE PAGE OPENS, SO THE GAME OPENS FROM THE BROWSER CACHE
startGameLinks(); // CONTINUE CURRENT GAME & YOUR GAMES SAY LOADING TOO
optNewSoloBtn.addEventListener("click", handleNewSoloGame);
muliplayerForm.addEventListener("submit", handleMultiSubmit); // INVITE BUTTON & ENTER IN THE EMAIL FIELD
multiEmailInput.addEventListener("input", handlePlayerSearch);
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
	const levelsLoaded = loadLevels(CHESS_URL, aiLevelSelect);
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
	friendColorSelect.value = SETTINGS.friend_color;
}

/**
 * @description Redraws Home from the server, one redraw at a time (the socket can send a few in a row)
 * @param  {[boolean]} firstLoad [true also loads the AI game, it only changes from this page]
 */
function refreshHome(firstLoad) {
	homeDrawing = homeDrawing.then(() => drawHome(firstLoad)).catch((err) => console.log(err));
	return homeDrawing;
}

/**
 * @description Loads the player's games & friends from the server & draws Home with them: the rating, the game list, the invites, the friends,
 * the friend box & (first load only) the AI game's board picture. Only call it through refreshHome()
 * @param  {[boolean]} firstLoad [true also reads the default start settings & loads the AI game]
 */
async function drawHome(firstLoad) {
	const [gameData, friendData] = await Promise.all([getUserGameData(CHESS_URL, PLAYER_ID), getFriends(USER_URL)]);
	if (firstLoad) { SETTINGS = gameData?.settings || null; } // ONLY ON LOAD, A REDRAW DOESN'T UNDO A PICK
	const releaseHeight = holdPageHeight(); // THE PAGE DOESN'T GET SHORTER WHILE IT'S REDRAWN, SO THE SCROLL STAYS PUT (#240)
	try {
		showRating(gameData?.rating); // A FINISHED FRIEND GAME REDRAWS HOME (SOCKET "games"), SO THE NEW RATING SHOWS
		const friendGame = await openGame(gameData?.friend_game_id);
		const currentGame = (firstLoad && gameData?.ai_game_id) ? loadCurrentGame(gameData.ai_game_id) : null; // ITS BOARD PICTURE, DRAWN ALONGSIDE THE REST
		listGames(gameData);
		listFinishedGames(gameData);
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
 * "vs AI // Level 3 // You play white (random)", "vs Bob // You play black // C20 King's Pawn Game". They're also shown in their boxes
 * @param  {[object]} gameData [GET /api/chess/user/:userId response]
 */
function listGames(gameData) {
	const openGames = gameData?.open_game_list || []; // NEW USERS HAVE NO GAMES YET
	const rows = [];
	for (let i = 0; i < openGames.length; i++) {
		const listElement = document.createElement("li");
		const gameLink = document.createElement("a");
		const opponent = openGames[i].ai ? `vs AI // Level ${openGames[i].ai_level}` : `vs ${openGames[i].opponent_name || "Friend"}`;
		gameLink.href = `/play/${encodeURIComponent(openGames[i].game_id)}`;
		gameLink.innerHTML = `<span class="label">Game ${i + 1}</span><span class="spec gameInfo"></span><span class="label gameOpen">Open</span>`;
		const opening = openGames[i].opening ? ` // ${openGames[i].opening.eco} ${openGames[i].opening.name}` : "";
		gameLink.querySelector(".gameInfo").innerText = `${opponent} // ${colorText(openGames[i].player_color, openGames[i].start_params)}${opening}`; // innerText, THE NAME IS NEVER READ AS HTML
		listElement.append(gameLink);
		rows.push(listElement);
	}
	gameList.replaceChildren(...rows); // REDRAWN WHEN THE SOCKET SAYS A GAME CHANGED: BUILT FIRST, THEN SWAPPED IN ONE STEP (#240)
	loadingDiv.hidden = openGames.length > 0;
	if (!openGames.length) { loadingDiv.innerText = "No open games yet. Start one with the AI or a friend."; }
}


/* ---------------------------------------------------------------- */
// Finished Games
/* ---------------------------------------------------------------- */
/**
 * @description Lists the player's last 20 finished games, newest first, each one is a link to /play/:gameId with its final board:
 * "Won" & "vs AI // Level 3 // You play white (random) // Checkmate"
 * @param  {[object]} gameData [GET /api/chess/user/:userId response]
 */
function listFinishedGames(gameData) {
	const games = gameData?.closed_game_list || []; // NEW USERS HAVE NO GAMES YET
	const rows = games.map(function (game) {
		const listElement = document.createElement("li");
		const gameLink = document.createElement("a");
		const opponent = game.ai ? `vs AI // Level ${game.ai_level}` : `vs ${game.opponent_name || "Friend"}`;
		const reason = game.reason ? ` // ${game.reason[0].toUpperCase()}${game.reason.slice(1)}` : "";
		gameLink.href = `/play/${encodeURIComponent(game.game_id)}`;
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


/* ---------------------------------------------------------------- */
// Current Game
/* ---------------------------------------------------------------- */
/**
 * @description The player's open AI game: its board & Continue current game go in Play the AI, & Play AI becomes New game
 * @param  {[string]} gameId [ai_game_id from the server]
 */
async function loadCurrentGame(gameId) {
	const game = await openGame(gameId);
	if (!game) { return; } // ENDED SINCE, PLAY AI STAYS AS IT IS
	CURRENT_GAME_ID = gameId;
	optNewSoloBtn.innerText = "New game";
	optNewSoloBtn.classList.replace("btnCream", "btnLine");
	await showCurrentGame(soloBox, game, `/play/${encodeURIComponent(gameId)}`);
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
	if (response?.status == 409) { // AN AI GAME OPENED SINCE (ANOTHER TAB): SHOW IT INSTEAD
		stopLoading();
		soloNote.innerText = "You already have an AI game open";
		return loadCurrentGame(response.game_id);
	}
	if (response?.status != 200) { stopLoading(); return console.log(response); }
	goToPage(`/play/${response.game_id}`); // ONCE THE IMAGES ARE IN
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
 * @description Checks an email looks like an address before the invite is sent (the server checks the player exists)
 * @param  {[string]} email [what was typed]
 * @return {[array]} match [the match, null when it isn't an email]
 */
function validateEmail(email) {
	return String(email).toLowerCase().match(
		/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|.(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
	);
};

/**
 * @description Searches for players as a username is typed, once the keys stop for SEARCH_DELAY. An email isn't searched
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
function clearPlayerSearch() {
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
function validateUsername(username) {
	return /^[A-Za-z0-9_-]{3,20}$/.test(username);
}

/**
 * @description Invites a friend by username or email with the picked color (Random is drawn now), they accept it on their Home. Stays here & the invite shows in Invites.
 * While a friend game is open the first press says it'll be forfeited, the second sends the invite (the server forfeits the open one)
 */
async function handleMultiSubmit(e) {
	e.preventDefault();
	e.stopPropagation();
	clearPlayerSearch();
	const opponent = multiEmailInput.value.trim();
	if (!validateEmail(opponent) && !validateUsername(opponent)) { return multiNote.innerText = "Enter a username or email"; }
	if (FRIEND_GAME_ID && !confirmInvite) { // FIRST PRESS
		confirmInvite = true;
		multiEmailBtn.innerText = "Forfeit & invite";
		return multiNote.innerText = `This forfeits your game vs ${FRIEND_NAME}, they win. Press again to send the invite.`;
	}
	multiNote.innerText = "";
	multiEmailBtn.disabled = true; // ONE INVITE PER PRESS
	try {
		const response = await initMultiplayerGame(CHESS_URL, PLAYER_ID, opponent, confirmInvite, friendColorSelect.value, friendFenInput.value, Number(friendTakebacksSelect.value));
		if (response?.status == 200) {
			multiEmailInput.value = "";
			friendFenInput.value = "";
			resetInviteBtn();
			await refreshHome(); // SHOWS THE SENT INVITE IN INVITES
		} else if (response?.status == 409) { // A FRIEND GAME OPENED SINCE (ANOTHER TAB): SHOW IT INSTEAD
			await refreshHome();
			multiNote.innerText = "You already have a friend game open";
		} else {
			resetInviteBtn(); // NOTHING WAS FORFEITED, THE NEXT TRY WARNS AGAIN
			multiNote.innerText = response?.status == 400 || response?.status == 429 ? response.message : inviteError(response?.message); // 400: THE FEN CAN'T BE PLAYED, 429: TOO MANY NEW GAMES
		}
	} catch (err) { console.log(err); resetInviteBtn(); multiNote.innerText = "Couldn't send the invite, try again"; }
	multiEmailBtn.disabled = false;
}

/**
 * @description Why an invite didn't go through, from the server's message
 */
function inviteError(message) {
	if (message == "Opponent not found") { return "No player has that username or email"; }
	if (message == "That's your email" || message == "That's your username") { return `${message}, invite a friend`; }
	if (message == "They already invited you") { return "They already invited you, accept it in Invites"; }
	return "Couldn't send the invite, try again";
}

/**
 * @description Puts the invite button back to "Invite": the next press warns about the forfeit again
 */
function resetInviteBtn() {
	confirmInvite = false;
	multiEmailBtn.innerText = "Invite";
	multiNote.innerText = "";
}


/* ---------------------------------------------------------------- */
// Invites
/* ---------------------------------------------------------------- */
/**
 * @description Draws Invites: invites to the player (Accept & Decline), then their sent invite (Cancel invite). Each one says the player's color
 * @param  {[object]} gameData [GET /api/chess/user/:userId response]
 */
function loadInvites(gameData) {
	const received = gameData?.received_invites || [];
	const sent = gameData?.sent_invite;
	listInvites(received);
	SENT_INVITE_ID = sent?.game_id || null;
	sentInviteText.innerText = sent ? `Invite sent to ${sent.name || "your friend"} // ${colorText(sent.player_color, sent.start_params)} // Waiting` : "";
	sentInvite.hidden = !SENT_INVITE_ID;
	noInvites.hidden = Boolean(received.length || SENT_INVITE_ID);
}

/**
 * @description "Bob invited you // You play black (random)" rows, each with Accept & Decline
 * @param  {[array]} invites [received_invites: [{ game_id, name, player_color, start_params }]]
 */
function listInvites(invites) {
	const rows = [];
	for (let i = 0; i < invites.length; i++) {
		const listElement = document.createElement("li");
		listElement.innerHTML = `<span class="inviteText"><span class="label inviteName"></span><span class="spec inviteParams"></span></span><span class="inviteButtons"><button class="btn btnCream" type="button">Accept</button><button class="btn btnLine" type="button">Decline</button></span>`;
		listElement.querySelector(".inviteName").innerText = `${invites[i].name || "A friend"} invited you`; // innerText, THE NAME IS NEVER READ AS HTML
		listElement.querySelector(".inviteParams").innerText = colorText(invites[i].player_color, invites[i].start_params); // THE START SETTINGS THEY PICKED
		const [acceptBtn, declineBtn] = listElement.querySelectorAll("button");
		if (confirmAccept == invites[i].game_id) { acceptBtn.innerText = "Forfeit & accept"; } // STILL WARNING AFTER A REDRAW
		acceptBtn.addEventListener("click", (e) => handleAccept(e, invites[i].game_id, acceptBtn));
		declineBtn.addEventListener("click", (e) => handleDecline(e, invites[i].game_id, declineBtn));
		rows.push(listElement);
	}
	inviteList.replaceChildren(...rows); // BUILT FIRST, THEN SWAPPED IN ONE STEP (#240)
	inviteList.hidden = !invites.length;
}

/**
 * @description Starts an invited game & opens it. While a friend game is open the first press says it'll be forfeited
 */
async function handleAccept(e, gameId, acceptBtn) {
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

/**
 * @description Declines an invite, the inviter's Home drops it too
 */
async function handleDecline(e, gameId, declineBtn) {
	e.preventDefault();
	e.stopPropagation();
	declineBtn.disabled = true;
	const response = await declineInvite(CHESS_URL, gameId);
	if (response?.status != 200) { console.log(response); }
	await refreshHome();
}

/**
 * @description Cancels the sent invite, the friend's Home drops it too
 */
async function handleCancelInvite(e) {
	e.preventDefault();
	e.stopPropagation();
	if (!SENT_INVITE_ID) { return; }
	cancelInviteBtn.disabled = true;
	const response = await declineInvite(CHESS_URL, SENT_INVITE_ID);
	if (response?.status != 200) { console.log(response); }
	await refreshHome();
	cancelInviteBtn.disabled = false;
}


/* ---------------------------------------------------------------- */
// Friends
/* ---------------------------------------------------------------- */
/**
 * @description Draws Friends: requests to the player (Accept & Decline), the ones they sent (Cancel), then their friends (Challenge & Remove).
 * A failed read keeps what's on screen
 * @param  {[object]} friendData [GET /api/user/friends response]
 */
function loadFriends(friendData) {
	if (friendData?.status != 200) { return; }
	const { friends, sent, received } = friendData;
	drawFriendRows(friendRequests, received.map(({ username }) => friendRow(`${username} wants to be friends`, "", [
		{ text: "Accept", cream: true, press: (button) => runFriendAction("accept", username, button) },
		{ text: "Decline", press: (button) => runFriendAction("decline", username, button) },
	])));
	drawFriendRows(sentRequests, sent.map(({ username }) => friendRow(`Request sent to ${username}`, "Waiting", [
		{ text: "Cancel", press: (button) => runFriendAction("cancel", username, button) },
	])));
	drawFriendRows(friendList, friends.map(({ username, online }) => friendRow(username, online ? "Online" : "", [
		{ text: "Challenge", cream: true, press: () => challengeFriend(username) },
		{ text: confirmRemove == username ? "Press again" : "Remove", press: (button) => handleRemoveFriend(username, button) }, // STILL WARNING AFTER A REDRAW
	])));
	noFriends.hidden = Boolean(friends.length || sent.length || received.length);
}

/**
 * @description Swaps a list's rows in one step (#240) & hides it when there are none
 */
function drawFriendRows(list, rows) {
	list.replaceChildren(...rows);
	list.hidden = !rows.length;
}

/**
 * @description One row of the Friends box
 * @param  {[string]} title [the row's name, innerText: a name is never read as HTML]
 * @param  {[string]} detail [the small text under it, "" = none]
 * @param  {[array]} buttons [{ text, cream (the main button), press(button) }]
 * @return {[element]} row [the list item]
 */
function friendRow(title, detail, buttons) {
	const listElement = document.createElement("li");
	listElement.innerHTML = `<span class="inviteText"><span class="label inviteName"></span><span class="spec inviteParams"></span></span><span class="inviteButtons"></span>`;
	listElement.querySelector(".inviteName").innerText = title;
	listElement.querySelector(".inviteParams").innerText = detail;
	listElement.querySelector(".inviteButtons").append(...buttons.map(({ text, cream, press }) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = `btn ${cream ? "btnCream" : "btnLine"}`;
		button.innerText = text;
		button.addEventListener("click", () => press(button));
		return button;
	}));
	return listElement;
}

/**
 * @description Runs a friend action, then redraws Home. A refusal says why in the box
 * @param  {[string]} action ["request", "accept", "decline", "cancel" or "remove"]
 * @param  {[string]} username [their username]
 * @param  {[element]} button [off until the answer, one action per press]
 * @return {[boolean]} done [true when it saved]
 */
async function runFriendAction(action, username, button) {
	button.disabled = true;
	friendNote.innerText = "";
	const response = await friendAction(USER_URL, action, username);
	confirmRemove = null;
	await refreshHome();
	button.disabled = false;
	if (response?.status == 200) { return true; }
	friendNote.innerText = response?.status < 500 ? response.message : "Couldn't update your friends, try again";
	return false;
}

/**
 * @description Sends a friend request to the username typed in the box
 */
async function handleAddFriend(e) {
	e.preventDefault();
	e.stopPropagation();
	const username = addFriendInput.value.trim();
	if (!validateUsername(username)) { return friendNote.innerText = "Enter a username"; }
	if (await runFriendAction("request", username, addFriendBtn)) { addFriendInput.value = ""; }
}

/**
 * @description Challenge: fills their username in the invite form, the player picks a color & presses Invite
 * @param  {[string]} username [the friend's username]
 */
function challengeFriend(username) {
	multiEmailInput.value = username;
	clearPlayerSearch();
	resetInviteBtn(); // A FORFEIT WARNING WAS ABOUT THE LAST NAME, THE NEXT PRESS WARNS AGAIN
	multiEmailInput.focus();
}

/**
 * @description Remove: only they can put it back by accepting a new request, so the first press says so & the second removes them
 * @param  {[string]} username [the friend's username]
 * @param  {[element]} button [their Remove button]
 */
function handleRemoveFriend(username, button) {
	if (confirmRemove != username) {
		friendList.querySelectorAll(".btnLine").forEach((other) => other.innerText = "Remove"); // ONE WARNING AT A TIME
		confirmRemove = username;
		button.innerText = "Press again";
		return friendNote.innerText = `This removes ${username} from your friends. Press again to remove them.`;
	}
	return runFriendAction("remove", username, button);
}
