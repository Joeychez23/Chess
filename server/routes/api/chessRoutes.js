/*
 *  chessRoutes.js  --  chess server
 *	Chess Routes
 *	New games, moves, the AI's moves, invites, rematches & ratings (controllers/chessController.js)
 *
 */

const router = require('express').Router()
const { requireAuth, optionalAuth } = require('../../middleware/auth.js')
const { limitNewGames, limitAiMoves } = require('../../middleware/rateLimit.js')
const { getGame, newGame, moveGame, restartGame, aiMoveGame, getLevels, forfeitGame, rematchGame, inviteGame, acceptGame, declineGame, getUserGames, getRatings } = require('../../controllers/chessController.js')

// THE PLAYER IS WHOEVER IS SIGNED IN (req.user), GUESTS CAN ONLY PLAY THEIR AI GAME (THE ONE IN THEIR guest_game COOKIE)
// limitNewGames: THE ROUTES THAT MAKE A GAME ANSWER 429 WHEN A SESSION, AN IP OR THE SITE MAKES TOO MANY

router.route('/game').post(optionalAuth, limitNewGames, newGame);   // /api/chess/game                  -> NEW AI GAME AT A LEVEL & COLOR, OR A GUEST'S NEW GAME (OVERWRITES game_id). ONE OPEN AT A TIME: 409, OR replace_current FORFEITS IT

router.route('/game/:gameId').get(optionalAuth, getGame);           // /api/chess/game/:gameId          -> BOARD + PLAYER COLOR

router.route('/game/:gameId').put(optionalAuth, moveGame);          // /api/chess/game/:gameId          -> VALIDATE + SAVE A MOVE

router.route('/game/:gameId/restart').post(optionalAuth, limitNewGames, restartGame); // /api/chess/game/:gameId/restart  -> AI GAMES: FORFEITS IF STILL GOING, THEN A NEW GAME AT THE SAME LEVEL & COLOR

router.route('/game/:gameId/ai-move').post(optionalAuth, limitAiMoves, aiMoveGame);   // /api/chess/game/:gameId/ai-move  -> AI GAMES: THE SERVER PICKS & SAVES THE AI'S MOVE AT THE GAME'S LEVEL. ONE ENGINE REQUEST AT A TIME PER GAME, 429 PAST THE AI MOVE LIMITS

router.route('/game/:gameId/forfeit').post(requireAuth, forfeitGame);   // /api/chess/game/:gameId/forfeit  -> FRIEND GAMES: CLOSES THE GAME, THE OTHER SIDE WINS

router.route('/game/:gameId/rematch').post(requireAuth, rematchGame);   // /api/chess/game/:gameId/rematch  -> FRIEND GAMES: NEW GAME (SAME COLOR PICK) WHEN BOTH PLAYERS PRESS WITHIN 1 MINUTE, 409 IF EITHER IS IN ANOTHER FRIEND GAME

router.route('/game/:gameId/accept').post(requireAuth, acceptGame);     // /api/chess/game/:gameId/accept   -> FRIEND INVITES: PENDING -> OPEN. ONE OPEN AT A TIME: 409, OR replace_current FORFEITS IT

router.route('/game/:gameId/decline').post(requireAuth, declineGame);   // /api/chess/game/:gameId/decline  -> FRIEND INVITES: DECLINE (INVITED PLAYER) OR CANCEL (INVITER), THE PENDING GAME IS DELETED

router.route('/game/:gameId/ratings').get(requireAuth, getRatings);   // /api/chess/game/:gameId/ratings  -> BOTH PLAYERS' RATINGS FOR THE GAME MENU (FRIEND GAMES), & THIS GAME'S RATING CHANGE ONCE IT'S OVER

router.route('/levels').get(getLevels);                             // /api/chess/levels                -> AI LEVELS + APPROX ELO FOR HOME'S DROPDOWN

router.route('/invite').post(requireAuth, limitNewGames, inviteGame); // /api/chess/invite                -> INVITE A FRIEND BY EMAIL WITH YOUR COLOR (PENDING GAME). ONE OPEN AT A TIME: 409, OR replace_current FORFEITS IT

router.route('/user/:userId').get(requireAuth, getUserGames);       // /api/chess/user/:userId          -> OPEN GAMES FOR HOME (WITH THEIR START SETTINGS), THE OPEN AI & FRIEND GAMES (ai_game_id, friend_game_id) & INVITES


module.exports = router
