const router = require('express').Router()
const { requirePlayer } = require('../middleware/player.js')
const { onlyFields } = require('../middleware/fields.js')
const { getGame, moveGame, aiMoveGame, forfeitGame, getRatings } = require('../controllers/gameController.js')
// EVERY ROUTE ACTS FOR req.player (middleware/player.js) & NAMES THE BODY FIELDS IT TAKES, A BODY WITH ANYTHING ELSE IS REFUSED (400)
router.route('/:gameId').get(requirePlayer, onlyFields([]), getGame);                                   // GET /games/:gameId          -> THE GAME, ONLY FOR A PLAYER IN IT (?consistent=true SEES A SAVE THAT JUST HAPPENED)
router.route('/:gameId/move').post(requirePlayer, onlyFields(["from", "to", "promotion"]), moveGame);     // POST /games/:gameId/move    -> THE REQUESTER'S MOVE ON THE STORED BOARD, CLOSES THE GAME ON MATE OR A DRAW
router.route('/:gameId/ai-move').post(requirePlayer, onlyFields(["from", "to", "promotion"]), aiMoveGame); // POST /games/:gameId/ai-move -> AI GAMES: THE AI'S MOVE (FROM THE ENGINE), ONLY ON ITS TURN
router.route('/:gameId/forfeit').post(requirePlayer, onlyFields([]), forfeitGame);                       // POST /games/:gameId/forfeit -> THE REQUESTER GIVES UP AN OPEN GAME, THE OTHER SIDE WINS
router.route('/:gameId/ratings').get(requirePlayer, onlyFields([]), getRatings);                        // GET /games/:gameId/ratings  -> BOTH PLAYERS' RATINGS FOR THE GAME MENU
module.exports = router
