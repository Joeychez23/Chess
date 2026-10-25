/*
 *  rating.js  --  chess server
 *	Elo Ratings
 *  Every signed-in player has a rating on their user_db row, starting at 1500. Finished friend games change it (closeGame in
 *  dynamoDB.js), AI games, games from a set position & games that end before both sides moved don't
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { DEFAULT_POSITION } = require("chess.js");
const { startFen } = require("./validate.js");

const START_RATING = 1500;
const PROVISIONAL_GAMES = 10; // A RATING SHOWS "?" FOR A PLAYER'S FIRST 10 RATED GAMES
const K_PROVISIONAL = 40; // HOW FAR ONE GAME MOVES IT WHILE IT'S PROVISIONAL (FIDE USES 40 FOR NEW PLAYERS TOO)
const K_SETTLED = 20; // AFTER THAT
const MIN_RATING = 100;

/* ---------------------------------------------------------------- */
// Expected Score
/* ---------------------------------------------------------------- */
/**
 * @description The score Elo expects from a player against an opponent: 0.5 between equals, 0.76 for 200 points more
 * @param  {[number]} rating [the player's rating]
 * @param  {[number]} opponentRating [the opponent's]
 * @return {[number]} expected [0 to 1]
 */
function expectedScore(rating, opponentRating) {
	return 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
}

/* ---------------------------------------------------------------- */
// New Rating
/* ---------------------------------------------------------------- */
/**
 * @description A player's rating after one game
 * @param  {[object]} player [{ rating, rated_games } before the game, readRating]
 * @param  {[object]} opponent [{ rating } before the game]
 * @param  {[number]} score [1 a win, 0.5 a draw, 0 a loss]
 * @return {[number]} rating [rounded, never below MIN_RATING]
 */
function newRating(player, opponent, score) {
	const k = player.rated_games < PROVISIONAL_GAMES ? K_PROVISIONAL : K_SETTLED;
	return Math.max(MIN_RATING, Math.round(player.rating + k * (score - expectedScore(player.rating, opponent.rating))));
}

/**
 * @description The score a side got from a game's result
 * @param  {[string]} winner ["w", "b" or "draw"]
 * @param  {[string]} color ["w" or "b"]
 * @return {[number]} score [1, 0.5 or 0]
 */
function scoreFor(winner, color) {
	if (winner == "draw") { return 0.5; }
	return winner == color ? 1 : 0;
}

/* ---------------------------------------------------------------- */
// Is Rated
/* ---------------------------------------------------------------- */
/**
 * @description Whether a finished game changes ratings: friend games only, from the standard position, once both sides have moved
 * (a forfeit straight away, or a new invite replacing a game that had just started, isn't counted)
 * @param  {[object]} gameData [game item]
 * @return {[boolean]} rated
 */
function isRated(gameData) {
	if (gameData.white_player_id.S == "CHESS_AI" || gameData.black_player_id.S == "CHESS_AI") { return false; }
	if ((gameData.moves?.S?.length || 0) < 2) { return false; }
	return startFen(gameData) == DEFAULT_POSITION; // A SET POSITION CAN HAND ONE SIDE A WON GAME
}

/* ---------------------------------------------------------------- */
// Read Rating
/* ---------------------------------------------------------------- */
/**
 * @description A player's rating from their user_db row
 * @param  {[object]} userData [user item, rows from before ratings have none yet]
 * @return {[object]} rating [{ rating, rated_games }]
 */
function readRating(userData) {
	return {
		rating: Number(userData?.rating?.N) || START_RATING,
		rated_games: Number(userData?.rated_games?.N) || 0
	};
}

/**
 * @description What the client shows for a rating: "1520?" while it's provisional
 * @param  {[object]} rating [{ rating, rated_games }]
 * @return {[object]} summary [{ rating, provisional, rated_games }]
 */
function ratingSummary(rating) {
	return { rating: rating.rating, provisional: rating.rated_games < PROVISIONAL_GAMES, rated_games: rating.rated_games };
}


module.exports = { expectedScore, newRating, scoreFor, isRated, readRating, ratingSummary, START_RATING, PROVISIONAL_GAMES, K_PROVISIONAL, K_SETTLED, MIN_RATING };
