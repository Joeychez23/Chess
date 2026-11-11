/*
 *  say.js  --  chess frontend
 *	The AI's bot on the play page (#76): its avatar & name beside the board (#botDisplay) & its lines at the start, a capture, check, a win & a loss.
 *	Which bot & which moment come from index.js, this only shows them. Friend games never show it
 *
 */

const { game } = require("../state/index.js");
const { getLevels } = require("../validate/index.js");
const { botFor, pickLine } = require("./index.js");

const LINE_TIME = 4000; // A LINE SHOWS THIS LONG, A NEWER ONE REPLACES IT (ms)

const botDisplay = document.getElementById("botDisplay");
const botAvatar = document.getElementById("botAvatar");
const botInitial = document.getElementById("botInitial");
const botName = document.getElementById("botName");
const botLine = document.getElementById("botLine");
let levelsRequest = null; // ONE GET /levels A PAGE (RESTART KEEPS THE LEVEL, IT'S ASKED ONCE)
let lineTimer = null;
let saying = null; // THE MOMENT ON SCREEN: A MATE SAYS "win", THE GAME OVER RIGHT AFTER DOESN'T SAY IT AGAIN

botAvatar.addEventListener("error", function () { // NO AVATAR ON S3 YET (OR IT DIDN'T LOAD): THE NAME'S FIRST LETTER IN A CIRCLE, NOT A BROKEN IMAGE
	botAvatar.hidden = true;
	botInitial.hidden = false;
});

/**
 * @description Shows the bot of the game's level beside the board, or hides it (a friend game, the levels didn't load)
 * @param  {[string]} gameUrl [chess api, "/api/chess"]
 * @param  {[object]} response [the game, { ai, ai_level }]
 * @return {[object]} bot [game.bot, null when none shows]
 */
export async function showBot(gameUrl, response) {
	if (!response?.ai) { return hideBot(); }
	levelsRequest ||= getLevels(gameUrl);
	const bot = botFor(await levelsRequest, response.ai_level);
	if (!bot) { return hideBot(); }
	if (game.bot?.level !== bot.level) {
		botName.innerText = bot.name; // innerText, NEVER READ AS HTML
		botInitial.innerText = bot.name[0];
		botInitial.hidden = true;
		botAvatar.hidden = false;
		botAvatar.src = `${process.env.CHESS_ASSETS_URL}/${bot.avatar}`;
	}
	game.bot = bot;
	botDisplay.hidden = false;
	return bot;
}

/**
 * @description No bot shows (a friend game)
 * @return {[object]} null
 */
function hideBot() {
	game.bot = null;
	botDisplay.hidden = true;
	clearLine();
	return null;
}

/**
 * @description The bot says one of its lines for a moment, nothing when there's no bot or no moment
 * @param  {[string]} moment ["start" | "capture" | "check" | "win" | "lose" | null]
 */
export function sayLine(moment) {
	const line = moment && !(moment === "win" && saying === "win") && pickLine(game.bot, moment);
	if (!line) { return; }
	clearTimeout(lineTimer);
	saying = moment;
	botLine.textContent = line; // aria-live (ALWAYS IN THE PAGE, EMPTY HIDES IT): SCREEN READERS READ IT OUT
	lineTimer = setTimeout(clearLine, LINE_TIME);
}

/**
 * @description Takes the line away
 */
function clearLine() {
	clearTimeout(lineTimer);
	saying = null;
	botLine.textContent = "";
}
