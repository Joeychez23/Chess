/*
 *  chessRoutes.js  --  chess server
 *	Chess Routes
 *	New games, moves, the AI's moves, hints and evaluations, takebacks, draw offers, invites, rematches and ratings
 *	(controllers/chess/), and the Chess Cards routes (cardsRoutes.js)
 *
 */

const router = require('express').Router();
const { requireAuth, optionalAuth } = require('../../middleware/auth.js');
const { limitNewGames, limitAiMoves, limitAnalysis } = require('../../middleware/rateLimit.js');
const {
	getGame,
	getPgn,
	newGame,
	moveGame,
	restartGame,
	aiMoveGame,
	analysisGame,
	takebackGame,
	declineTakebackGame,
	getLevels,
	forfeitGame,
	drawGame,
	declineDrawGame,
	rematchGame,
	cancelRematchGame,
	inviteGame,
	challengeGame,
	getChallenge,
	joinGame,
	acceptGame,
	declineGame,
	getUserGames,
	getRatings,
} = require('../../controllers/chess/index.js');

// The player is whoever is signed in (req.user). Guests can only play their AI game (the one in their guest_game
// cookie).
// limitNewGames: the routes that make a game answer 429 when a session, an IP or the site makes too many. On /invite
// it runs before the lookup, so a name that isn't found counts too.

// /api/chess/game: a new AI game at a level and color, or a guest's new game (overwrites game_id). One open game at a
// time: 409, or replace_current forfeits it
router.route('/game').post(optionalAuth, limitNewGames, newGame);

// /api/chess/game/:gameId: the board and the player's color
router.route('/game/:gameId').get(optionalAuth, getGame);

// /api/chess/game/:gameId/pgn: the game as a PGN file, the game menu's Download PGN
router.route('/game/:gameId/pgn').get(optionalAuth, getPgn);

// /api/chess/game/:gameId: validates and saves a move
router.route('/game/:gameId').put(optionalAuth, moveGame);

// /api/chess/game/:gameId/restart: AI games. Forfeits the game if it's still going, then starts a new one at the same
// level and color
router.route('/game/:gameId/restart').post(optionalAuth, limitNewGames, restartGame);

// /api/chess/game/:gameId/ai-move: AI games. The server picks and saves the AI's move at the game's level. One engine
// request at a time per game, 429 past the AI move limits
router.route('/game/:gameId/ai-move').post(optionalAuth, limitAiMoves, aiMoveGame);

// /api/chess/game/:gameId/analysis: AI and finished games. The engine's best move and evaluation of the saved board
// (the hint and the evaluation bar). Cached by FEN, one request at a time per game, 429 past the analysis limits
router.route('/game/:gameId/analysis').post(optionalAuth, limitAnalysis, analysisGame);

// /api/chess/game/:gameId/takeback: AI games take back the player's last move and the AI's reply (409 while the AI's
// move is being picked). Friend games ask the opponent, or accept their request
router.route('/game/:gameId/takeback').post(optionalAuth, takebackGame);

// /api/chess/game/:gameId/forfeit: closes the game, the other side wins
router.route('/game/:gameId/forfeit').post(optionalAuth, forfeitGame);

// /api/chess/game/:gameId/takeback/decline: friend games. Turns down the opponent's takeback request
router.route('/game/:gameId/takeback/decline').post(requireAuth, declineTakebackGame);

// /api/chess/game/:gameId/draw: offers a draw (one per player per move) or accepts the opponent's. In AI games the
// engine answers, so it's under the AI move limits
router.route('/game/:gameId/draw').post(optionalAuth, limitAiMoves, drawGame);

// /api/chess/game/:gameId/draw/decline: friend games. Turns down the opponent's draw offer
router.route('/game/:gameId/draw/decline').post(requireAuth, declineDrawGame);

// /api/chess/game/:gameId/rematch: friend games. A new game (same color pick) when both players press within
// 1 minute, 409 if either is in another friend game
router.route('/game/:gameId/rematch').post(requireAuth, rematchGame);

// /api/chess/game/:gameId/rematch/cancel: friend games. Takes back the player's rematch request
router.route('/game/:gameId/rematch/cancel').post(requireAuth, cancelRematchGame);

// /api/chess/game/:gameId/accept: friend invites, pending -> open. One open game at a time: 409, or replace_current
// forfeits it
router.route('/game/:gameId/accept').post(requireAuth, acceptGame);

// /api/chess/game/:gameId/decline: friend invites. Declined by the invited player or cancelled by the inviter; the
// pending game is deleted
router.route('/game/:gameId/decline').post(requireAuth, declineGame);

// /api/chess/game/:gameId/ratings: both players' ratings for the game menu (friend games), and this game's rating
// change once it's over
router.route('/game/:gameId/ratings').get(requireAuth, getRatings);

// /api/chess/levels: the AI levels and their approximate Elo for Home's dropdown
router.route('/levels').get(getLevels);

// /api/chess/invite: invites a friend by username, with your color (a pending game). One open game at a time: 409, or
// replace_current forfeits it
router.route('/invite').post(requireAuth, limitNewGames, inviteGame);

// /api/chess/challenge: a challenge link. A pending game with the other seat empty, your one sent invite. One open
// game at a time: 409, or replace_current forfeits it
router.route('/challenge').post(requireAuth, limitNewGames, challengeGame);

// /api/chess/game/:gameId/challenge: what the join screen shows
router.route('/game/:gameId/challenge').get(requireAuth, getChallenge);

// /api/chess/game/:gameId/join: takes a challenge link's empty seat; only one player wins it. One open game at a
// time: 409, or replace_current forfeits it
router.route('/game/:gameId/join').post(requireAuth, joinGame);

// /api/chess/cards/...: Chess Cards games against Card Guy (routes/api/cardsRoutes.js)
router.use('/cards', require('./cardsRoutes.js'));

// /api/chess/user/:userId: open games for Home (with their start settings), the open AI and friend games
// (ai_game_id, friend_game_id) and invites
router.route('/user/:userId').get(requireAuth, getUserGames);


module.exports = router;
