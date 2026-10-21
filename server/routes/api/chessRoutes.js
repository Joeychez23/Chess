const router = require('express').Router()
const { requireAuth, optionalAuth } = require('../../middleware/auth.js')
const { getGame, newGame, moveGame, inviteGame, getUserGames } = require('../../controllers/chessController.js')

// THE PLAYER IS WHOEVER IS SIGNED IN (req.user), GUESTS CAN ONLY PLAY THEIR AI GAME

router.route('/game').post(optionalAuth, newGame);                  // /api/chess/game                  -> NEW GAME OR RESTART (OVERWRITES game_id)

router.route('/game/:gameId').get(optionalAuth, getGame);           // /api/chess/game/:gameId          -> BOARD + PLAYER COLOR

router.route('/game/:gameId').put(optionalAuth, moveGame);          // /api/chess/game/:gameId          -> VALIDATE + SAVE A MOVE

router.route('/invite').post(requireAuth, inviteGame);              // /api/chess/invite                -> NEW GAME VS A FRIEND BY EMAIL

router.route('/user/:userId').get(requireAuth, getUserGames);       // /api/chess/user/:userId          -> OPEN GAMES FOR HOME


module.exports = router
