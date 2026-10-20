const router = require('express').Router()
const { getGame, newGame, moveGame, inviteGame, getUserGames } = require('../../controllers/chessController.js')


router.route('/game').post(newGame);                // /api/chess/game                  -> NEW GAME OR RESTART (OVERWRITES game_id)

router.route('/game/:gameId').get(getGame);         // /api/chess/game/:gameId?player_id -> BOARD + PLAYER COLOR

router.route('/game/:gameId').put(moveGame);        // /api/chess/game/:gameId          -> VALIDATE + SAVE A MOVE

router.route('/invite').post(inviteGame);           // /api/chess/invite                -> NEW GAME VS A FRIEND BY EMAIL

router.route('/user/:userId').get(getUserGames);    // /api/chess/user/:userId          -> OPEN GAMES FOR HOME


module.exports = router
