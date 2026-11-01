/*
 *  index.js  --  chess frontend
 *	Home Page (/, signed in)
 *	Four boxes: Play the AI (at a level & color), Play a friend (by email, with your color), Invites (sent & received) & the player's open games.
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
const { InternalAuth } = require("../../auth/index.js");
const { validate, newAiGame, getUserGameData, initMultiplayerGame, acceptInvite, declineInvite } = require("../../gameplay/validate/index.js");
const { preloadImages } = require("../../gameplay/images/index.js");
const { watchGames } = require("../../socket/index.js");
const { startNav, startLogoutButtons, showCurrentGame, hideCurrentGame, loadLevels, colorText, startLoading, goToPage, stopLoading, startGameLinks, showPageWhenDrawn } = require("../utils/index.js");

const CHESS_URL = "/api/chess"; // CHESS ROUTES LIVE ON THE EXPRESS SERVER (server/routes/api/chessRoutes.js)

const signedInAs = document.getElementById("signedInAs"); // "SIGNED IN // EMAIL"
const welcome = document.getElementById("welcome"); // "WELCOME BACK, USERNAME"
const playerRating = document.getElementById("playerRating"); // "RATING // 1520?", FRIEND GAMES CHANGE IT
const soloBox = document.getElementById("soloBox"); // PLAY THE AI
const optNewSoloBtn = document.getElementById("optNewSolo"); // PLAY THE AI: PLAY AI, OR NEW GAME WHILE AN AI GAME IS OPEN
const aiLevelSelect = document.getElementById("aiLevel"); // ABOVE PLAY AI, FILLED FROM THE SERVER'S LEVELS
const aiColorSelect = document.getElementById("aiColor"); // RANDOM, WHITE OR BLACK, RESTART KEEPS IT
const aiFenInput = document.getElementById("aiFen"); // START POSITION (FEN), BLANK = THE STANDARD POSITION, RESTART KEEPS IT
const soloNote = document.getElementById("soloNote"); // NEW GAME: "THIS FORFEITS YOUR CURRENT GAME"
const friendBox = document.getElementById("friendBox"); // PLAY A FRIEND
const muliplayerForm = document.getElementById("muliplayerForm"); // PLAY A FRIEND: EMAIL & INVITE
const multiEmailInput = document.getElementById("enterMultiEmail");
const multiEmailBtn = document.getElementById("enterMultiSubmit");
const friendColorSelect = document.getElementById("friendColor"); // THE INVITER'S COLOR, THE INVITE SHOWS IT & REMATCHES KEEP IT
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
let homeDrawing = Promise.resolve(); // ONE REDRAW AT A TIME (refreshHome)
let SETTINGS = null; // THE PLAYER'S DEFAULT START SETTINGS (THE SETTINGS PAGE), THE DROPDOWNS START ON THEM

startNav();
startLogoutButtons(auth); // LOGOUT IN THE MENU IS A POST (#332)
preloadImages(); // THE GAME'S IMAGES, AS SOON AS THE PAGE OPENS, SO THE GAME OPENS FROM THE BROWSER CACHE
startGameLinks(); // CONTINUE CURRENT GAME & YOUR GAMES SAY LOADING TOO
optNewSoloBtn.addEventListener("click", handleNewSoloGame);
muliplayerForm.addEventListener("submit", handleMultiSubmit); // INVITE BUTTON & ENTER IN THE EMAIL FIELD
cancelInviteBtn.addEventListener("click", handleCancelInvite);

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
 * @description Loads the player's games from the server & draws Home with them: the rating, the game list, the invites,
 * the friend box & (first load only) the AI game's board picture. Only call it through refreshHome()
 * @param  {[boolean]} firstLoad [true also reads the default start settings & loads the AI game]
 */
async function drawHome(firstLoad) {
	const gameData = await getUserGameData(CHESS_URL, PLAYER_ID);
	if (firstLoad) { SETTINGS = gameData?.settings || null; } // ONLY ON LOAD, A REDRAW DOESN'T UNDO A PICK
	const releaseHeight = holdPageHeight(); // THE PAGE DOESN'T GET SHORTER WHILE IT'S REDRAWN, SO THE SCROLL STAYS PUT (#240)
	try {
		showRating(gameData?.rating); // A FINISHED FRIEND GAME REDRAWS HOME (SOCKET "games"), SO THE NEW RATING SHOWS
		const friendGame = await openGame(gameData?.friend_game_id);
		const currentGame = (firstLoad && gameData?.ai_game_id) ? loadCurrentGame(gameData.ai_game_id) : null; // ITS BOARD PICTURE, DRAWN ALONGSIDE THE REST
		listGames(gameData);
		loadInvites(gameData);
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
 * "vs AI // Level 3 // You play white (random)", "vs Bob // You play black". They're also shown in their boxes
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
		gameLink.querySelector(".gameInfo").innerText = `${opponent} // ${colorText(openGames[i].player_color, openGames[i].start_params)}`; // innerText, THE NAME IS NEVER READ AS HTML
		listElement.append(gameLink);
		rows.push(listElement);
	}
	gameList.replaceChildren(...rows); // REDRAWN WHEN THE SOCKET SAYS A GAME CHANGED: BUILT FIRST, THEN SWAPPED IN ONE STEP (#240)
	loadingDiv.hidden = openGames.length > 0;
	if (!openGames.length) { loadingDiv.innerText = "No open games yet. Start one with the AI or a friend."; }
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
 * @description Draws Play a friend: the open friend game (board & Continue current game), then the email form.
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
 * @description Invites a friend by email with the picked color (Random is drawn now), they accept it on their Home. Stays here & the invite shows in Invites.
 * While a friend game is open the first press says it'll be forfeited, the second sends the invite (the server forfeits the open one)
 */
async function handleMultiSubmit(e) {
	e.preventDefault();
	e.stopPropagation();
	const email = multiEmailInput.value.trim();
	if (!validateEmail(email)) { return multiNote.innerText = "Enter an email address"; }
	if (FRIEND_GAME_ID && !confirmInvite) { // FIRST PRESS
		confirmInvite = true;
		multiEmailBtn.innerText = "Forfeit & invite";
		return multiNote.innerText = `This forfeits your game vs ${FRIEND_NAME}, they win. Press again to send the invite.`;
	}
	multiNote.innerText = "";
	multiEmailBtn.disabled = true; // ONE INVITE PER PRESS
	try {
		const response = await initMultiplayerGame(CHESS_URL, PLAYER_ID, email, confirmInvite, friendColorSelect.value, friendFenInput.value);
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
	if (message == "Opponent not found") { return "No player has that email"; }
	if (message == "That's your email") { return "That's your email, invite a friend"; }
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
