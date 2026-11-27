/*
 *  index.js  --  chess frontend
 *	Page Utils
 *	Shared by the pages: the menu (on pages without the game), the table background, the current game in the Play the AI
 *	& Play a friend boxes, the AI level dropdown, how a game's start settings read ("You play white (random)") & the Loading
 *	button into a game
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { drawBoardPicture } = require("./boardPicture.js");
const { getLevels } = require("../../gameplay/validate/index.js");
const { botFor } = require("../../gameplay/bots/index.js"); // The bot that plays at a level
const { imageProgress } = require("../../gameplay/images/index.js");
const { confirmPress } = require("./confirm.js"); // Logout in the menu needs a second press
const { setFill } = require("./menuItem.js"); // Logout in the menu fills while it waits
const { timeLeftText } = require("./timeLeft.js");

export { startNav } from "./nav.js"; // The menu button
export { startBoxNav } from "./boxNav.js"; // The menu button & the boxes' keys (Guest, Home, Login, Signup & Settings)
export { startDropdowns } from "./dropdown.js"; // The <select>s as a button & list that Enter opens (Home, Settings & Guest)

let loadingBtn = null; // The button or link that says Loading (one at a time), stopLoading() puts it back
let loadingText; // Its text before it said Loading
let loadingCheck; // Fills it as the game's images load
let loadingStartTime; // When it started, goToPage() goes anyway 8 seconds after this

/* ---------------------------------------------------------------- */
// Logout Buttons
/* ---------------------------------------------------------------- */
/**
 * @description Logout & Sign out (Home & Settings) end the session with a POST (auth.logout()), a link's GET is refused.
 * Logout in the menu asks "Are you sure?" first (confirm.js), Sign out is on the Settings page itself.
 * The button is turned off so another press doesn't send a second logout
 * @param  {[object]} auth [the page's InternalAuth]
 */
export function startLogoutButtons(auth) {
	document.querySelectorAll(".logoutBtn").forEach(function (button) {
		button.addEventListener("click", function (e) { handleLogout(e, button, auth); });
	});
}

/**
 * @description A press on Logout or Sign out: the menu's Logout asks first, then says Logging Out & fills while the session ends
 * @param  {[object]} e [the click]
 * @param  {[object]} button [the Logout or Sign out button]
 * @param  {[object]} auth [the page's InternalAuth]
 */
function handleLogout(e, button, auth) {
	e.preventDefault();
	if (button.disabled) { return; }
	if (button.closest("#menuContainer") && !confirmPress(button)) { return; } // The first press asks
	button.disabled = true;
	if (button.closest("#menuContainer")) {
		button.innerText = "Logging Out";
		setFill(button);
	}
	auth.logout(); // POST /api/auth/logout, then the guest page
}

/* ---------------------------------------------------------------- */
// Show Table
/* ---------------------------------------------------------------- */
/**
 * @description The table behind the board, as the page background (the play page draws it on the canvas instead)
 */
export function showTable() {
	const main = document.querySelector("#main");
	main.style.backgroundRepeat = "repeat-y";
	main.style.backgroundImage = `url("${process.env.CHESS_ASSETS_URL}/images/board/table.webp")`;
	main.style.backgroundSize = "cover";
	main.style.backgroundPosition = "center";
}

/* ---------------------------------------------------------------- */
// Show Current Game
/* ---------------------------------------------------------------- */
/**
 * @description Play the AI (Home & guest) & Play a friend (Home): swaps the box's text for a picture of the player's open game,
 * a line about it (level or opponent, color, whose move) & Continue current game. If the picture can't be drawn Continue still shows
 * @param  {[object]} box [the .box, it holds a .boxText, a .boardPicture (canvas & figcaption) & a .continueGame link]
 * @param  {[object]} game [GET /api/chess/game/:gameId response]
 * @param  {[string]} href [where Continue goes: /play/:gameId (signed in) or /play (guest)]
 */
export async function showCurrentGame(box, game, href) {
	const picture = box.querySelector(".boardPicture");
	const continueLink = box.querySelector(".continueGame");
	const turn = game.game_board.split(" ")[1]; // FEN: w or b to move
	// A card game is always vs Card Guy
	const opponent = game.mode === "cards" ? "Chess Cards"
		: game.ai ? await aiOpponent(game.ai_level) : `vs ${game.opponent_name || "Friend"}`;
	const theirMove = game.ai ? "AI's move" : "Their move";
	const whoseMove = turn == game.player_color ? "Your move" : theirMove;
	const timeLeft = game.move_deadline ? ` // ${timeLeftText(game.move_deadline)}` : "";
	const settings = colorText(game.player_color, game.start_params);
	picture.querySelector("figcaption").innerText = `${opponent} // ${settings} // ${whoseMove}${timeLeft}`;
	continueLink.href = href;
	try {
		await drawBoardPicture(picture.querySelector("canvas"), game);
		picture.hidden = false;
	} catch (err) { console.log(err); } // An image didn't load, Continue still works
	box.querySelector(".boxText").hidden = true;
	continueLink.hidden = false;
}

/**
 * @description Puts the box's text back once its game is over (Play a friend redraws when the socket says it changed)
 * @param  {[object]} box [the .box showCurrentGame drew in]
 */
export function hideCurrentGame(box) {
	box.querySelector(".boardPicture").hidden = true;
	box.querySelector(".continueGame").hidden = true;
	box.querySelector(".boxText").hidden = false;
}

/* ---------------------------------------------------------------- */
// AI Levels
/* ---------------------------------------------------------------- */
let levelsRequest = null; // One GET /levels a page, the dropdown & the game lists share it

/**
 * @description The levels, each one a bot, asked for once a page
 * @param  {[string]} gameUrl [chess api, "/api/chess"]
 * @return {[object]} response [GET /levels, null when it failed]
 */
export function botLevels(gameUrl = "/api/chess") {
	levelsRequest ||= getLevels(gameUrl).then((response) => (response?.status == 200 ? response : null));
	return levelsRequest;
}

/**
 * @description The name of the bot that plays at a level
 * @param  {[object]} levels [GET /levels, botLevels()]
 * @param  {[any]} aiLevel [the game's ai_level]
 * @return {[string]} name [null when the levels didn't load or the level isn't there]
 */
export function botName(levels, aiLevel) {
	return botFor(levels, aiLevel)?.name || null;
}

/**
 * @description How an AI game's opponent reads in its box (Home & the guest page): the bot's name, "Level 1300" when the levels didn't load
 * @param  {[any]} aiLevel [the game's ai_level]
 * @return {[string]} text
 */
async function aiOpponent(aiLevel) {
	return botName(await botLevels(), aiLevel) || `Level ${aiLevel}`;
}

/**
 * @description Fills a level dropdown (Play the AI on Home & the guest page, Settings, Chess Cards) with the server's levels,
 * each one a bot & its approx Elo: "Ada · ≈1300 Elo". The level is saved with the game, so it only changes by starting a new game
 * @param  {[string]} gameUrl [chess api, "/api/chess"]
 * @param  {[object]} select [the <select>]
 * @param  {[boolean]} named [false: the Elo only, "≈1300 Elo" (Chess Cards: every level is Card Guy, not the level's bot)]
 * @return {[object]} response [GET /levels, undefined when it failed]
 */
export async function loadLevels(gameUrl, select, named = true) {
	const response = await botLevels(gameUrl);
	if (!response) { return; } // No levels: the server uses its default
	for (let i = 0; i < response.levels.length; i++) {
		const level = response.levels[i];
		const option = document.createElement("option");
		option.value = level.level;
		option.innerText = named && level.name ? `${level.name} · ${level.elo} Elo` : `${level.elo} Elo`; // The level is its Elo
		if (level.level == response.default_level) { option.selected = true; }
		select.append(option);
	}
	return response;
}

/* ---------------------------------------------------------------- */
// Color Text
/* ---------------------------------------------------------------- */
/**
 * @description How a game's start settings read on Home: the picture's caption, Invites & Your games
 * @param  {[string]} playerColor ["w" or "b", the player's side in this game]
 * @param  {[object]} startParams [the game's start settings, { color: "alternate" | "random" | "w" | "b", fen (a set position) }]
 * @return {[string]} text ["You play white", "You play white (random)" when it was drawn, "You play white (alternating)",
 * then " // Set position" for a game from a FEN, " // No takebacks" & " // 3 days per move"]
 */
export function colorText(playerColor, startParams) {
	const side = playerColor == "w" ? "white" : "black";
	const picked = startParams?.color == "random" ? " (random)" : startParams?.color == "alternate" ? " (alternating)" : "";
	const position = startParams?.fen ? " // Set position" : ""; // Started from the start position box
	const takebacks = startParams?.takebacks === 0 ? " // No takebacks" : ""; // The invite's setting
	const days = startParams?.days_per_move;
	const timeLimit = days ? ` // ${days} day${days == 1 ? "" : "s"} per move` : ""; // The invite's setting
	return `You play ${side}${picked}${position}${takebacks}${timeLimit}`;
}

/* ---------------------------------------------------------------- */
// Loading
/* ---------------------------------------------------------------- */
/**
 * @description Every way into a game (Play AI, Accept, Continue current game & Your games), Home on Game not found & the login
 * & signup buttons: it says Loading & fills up from the left (--load, .loading in nav.css) as the game's images load,
 * preloadImages() started them when the page opened. The last 10% is the server (new game, accept), goToPage() fills it & goes
 * to the page. stopLoading() puts it back if it didn't go through
 * @param  {[object]} btn [the button or link pressed]
 */
export function startLoading(btn) {
	if (loadingBtn) { stopLoading(); } // One at a time
	const label = btn.querySelector(".gameOpen") || btn; // Your games: only "Open" says Loading
	loadingBtn = btn;
	loadingText = label.innerText;
	label.innerText = "Loading";
	btn.classList.add("loading");
	btn.disabled = true; // One game per press (links don't have disabled, .loading turns off their clicks)
	loadingStartTime = Date.now();
	// From empty (the fill is drawn first)
	loadingCheck = setInterval(function () { btn.style.setProperty("--load", Math.min(imageProgress(), 0.9)); }, 50);
}

/**
 * @description Goes to the page once the game's images are in (or after 8 seconds, an image that failed never counts), the fill
 * finishes first. The next page keeps this page on screen until it's drawn, then fades into it (play.html, home.html, guest.html)
 * @param  {[string]} href [/play/:gameId (signed in), /play (guest), / (Home) or the returnTo after signing in]
 * @param  {[boolean]} replace [true: Back skips this page (signing in)]
 */
export function goToPage(href, replace) {
	const openCheck = setInterval(function () {
		if (imageProgress() < 1 && Date.now() - loadingStartTime < 8000) { return; } // Still loading
		clearInterval(openCheck);
		clearInterval(loadingCheck);
		if (loadingBtn) { loadingBtn.style.setProperty("--load", 1); }
		setTimeout(function () { openPage(href, replace); }, 200); // The fill reaches the end first (200ms in nav.css)
	}, 50);
}

/**
 * @description Opens the page, in place of this one when Back should skip it
 * @param  {[string]} href [where to go]
 * @param  {[boolean]} replace [true: Back skips this page]
 */
function openPage(href, replace) {
	if (replace) { window.location.replace(href); }
	else { window.location.href = href; }
}

/**
 * @description Puts the button back as it was (the server said no, or Back from the game showed this page as it was left)
 */
export function stopLoading() {
	if (!loadingBtn) { return; }
	clearInterval(loadingCheck);
	(loadingBtn.querySelector(".gameOpen") || loadingBtn).innerText = loadingText;
	loadingBtn.classList.remove("loading");
	loadingBtn.style.removeProperty("--load");
	loadingBtn.disabled = false;
	loadingBtn = null;
}

/**
 * @description Continue current game, the games in Your games (Home & guest) & the links between login & signup load like Play AI.
 * Clicks that open a new tab (cmd, ctrl, shift, middle) open as usual. Back from the game can show this page as it was left
 * (the browser keeps it), so the button is put back
 */
export function startGameLinks() {
	document.addEventListener("click", function (e) {
		const link = e.target.closest("a.continueGame, .gameRows a, a.keepReturnTo");
		if (!link || e.button != 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { return; }
		e.preventDefault();
		startLoading(link);
		goToPage(link.href);
	});
	window.addEventListener("pageshow", function (e) { if (e.persisted) { stopLoading(); } });
}

/* ---------------------------------------------------------------- */
// Show Page
/* ---------------------------------------------------------------- */
/**
 * @description Shows the page: removes loadingPage from <html>. Coming from another page (a game's Home button, Play AI) the last
 * page stays on screen until then & fades into this one (the <style> in home.html, guest.html & play.html)
 */
export function showPage() {
	document.documentElement.classList.remove("loadingPage");
}

/**
 * @description Home & guest: shows the page once it's drawn, its images are in (window load) & what it fills from the server is filled
 * (the levels, the boxes, the board pictures). After 8 seconds it's shown anyway (server down)
 * @param  {[array]} drawn [promises of what the page fills]
 */
export async function showPageWhenDrawn(drawn) {
	const showAnyway = setTimeout(showPage, 8000);
	const pageLoaded = new Promise(function (resolve) {
		if (document.readyState == "complete") { resolve(); }
		else { window.addEventListener("load", resolve); }
	});
	await Promise.allSettled([pageLoaded, ...drawn]); // allSettled: one that failed still shows the page
	clearTimeout(showAnyway);
	showPage();
}
