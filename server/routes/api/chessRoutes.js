const router = require('express').Router()
const { requireAuth, optionalAuth } = require('../../middleware/auth.js')
const { getGame, newGame, moveGame, restartGame, aiMoveGame, getLevels, forfeitGame, rematchGame, inviteGame, getUserGames } = require('../../controllers/chessController.js')

// THE PLAYER IS WHOEVER IS SIGNED IN (req.user), GUESTS CAN ONLY PLAY THEIR AI GAME

router.route('/game').post(optionalAuth, newGame);                  // /api/chess/game                  -> NEW AI GAME AT A LEVEL, OR A GUEST'S RESTART (OVERWRITES game_id)

router.route('/game/:gameId').get(optionalAuth, getGame);           // /api/chess/game/:gameId          -> BOARD + PLAYER COLOR

router.route('/game/:gameId').put(optionalAuth, moveGame);          // /api/chess/game/:gameId          -> VALIDATE + SAVE A MOVE

router.route('/game/:gameId/restart').post(optionalAuth, restartGame);  // /api/chess/game/:gameId/restart  -> AI GAMES: FORFEITS IF STILL GOING, THEN A NEW GAME AT THE SAME LEVEL

router.route('/game/:gameId/ai-move').post(optionalAuth, aiMoveGame);   // /api/chess/game/:gameId/ai-move  -> AI GAMES: THE SERVER PICKS & SAVES THE AI'S MOVE AT THE GAME'S LEVEL

router.route('/game/:gameId/forfeit').post(requireAuth, forfeitGame);   // /api/chess/game/:gameId/forfeit  -> FRIEND GAMES: CLOSES THE GAME, THE OTHER SIDE WINS

router.route('/game/:gameId/rematch').post(requireAuth, rematchGame);   // /api/chess/game/:gameId/rematch  -> FRIEND GAMES: NEW GAME WHEN BOTH PLAYERS PRESS WITHIN 1 MINUTE

router.route('/levels').get(getLevels);                             // /api/chess/levels                -> AI LEVELS + APPROX ELO FOR HOME'S DROPDOWN

router.route('/invite').post(requireAuth, inviteGame);              // /api/chess/invite                -> NEW GAME VS A FRIEND BY EMAIL

router.route('/user/:userId').get(requireAuth, getUserGames);       // /api/chess/user/:userId          -> OPEN GAMES FOR HOME


module.exports = router
