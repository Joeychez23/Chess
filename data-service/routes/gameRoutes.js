const router = require('express').Router()
const { requirePlayer } = require('../middleware/player.js')
const { onlyFields } = require('../middleware/fields.js')
const { getGame, moveGame, aiMoveGame, forfeitGame, getRatings, newAiGame, newGuestGame, inviteGame, acceptGame, declineGame, rematchGame } = require('../controllers/gameController.js')
// EVERY ROUTE ACTS FOR req.player (middleware/player.js) & NAMES THE BODY FIELDS IT TAKES, A BODY WITH ANYTHING ELSE IS REFUSED (400)
router.route('/ai').post(requirePlayer, onlyFields(["color", "level", "start_fen", "game_id"]), newAiGame);                     // POST /games/ai              -> A SIGNED IN PLAYER'S NEW GAME VS THE AI (A NEW ID ONLY)
router.route('/guest').post(onlyFields(["game_id", "color", "level", "start_fen"]), newGuestGame);                               // POST /games/guest           -> A GUEST'S GAME VS THE AI, OVERWRITES ONLY THEIR OWN (NO PLAYER = A NEW GUEST)
router.route('/invite').post(requirePlayer, onlyFields(["opponent_id", "opponent_screenname", "color", "start_fen", "game_id"]), inviteGame); // POST /games/invite -> A PENDING FRIEND GAME, THE REQUESTER IS THE INVITER
router.route('/:gameId').get(requirePlayer, onlyFields([]), getGame);                                   // GET /games/:gameId          -> THE GAME, ONLY FOR A PLAYER IN IT (?consistent=true SEES A SAVE THAT JUST HAPPENED)
router.route('/:gameId/move').post(requirePlayer, onlyFields(["from", "to", "promotion"]), moveGame);     // POST /games/:gameId/move    -> THE REQUESTER'S MOVE ON THE STORED BOARD, CLOSES THE GAME ON MATE OR A DRAW
router.route('/:gameId/ai-move').post(requirePlayer, onlyFields(["from", "to", "promotion"]), aiMoveGame); // POST /games/:gameId/ai-move -> AI GAMES: THE AI'S MOVE (FROM THE ENGINE), ONLY ON ITS TURN
router.route('/:gameId/forfeit').post(requirePlayer, onlyFields([]), forfeitGame);                       // POST /games/:gameId/forfeit -> THE REQUESTER GIVES UP AN OPEN GAME, THE OTHER SIDE WINS
router.route('/:gameId/accept').post(requirePlayer, onlyFields([]), acceptGame);                         // POST /games/:gameId/accept  -> THE INVITED PLAYER STARTS THE GAME, NOT WHILE THE INVITER IS IN ANOTHER FRIEND GAME
router.route('/:gameId/decline').post(requirePlayer, onlyFields([]), declineGame);                       // POST /games/:gameId/decline -> EITHER PLAYER DELETES A PENDING INVITE
router.route('/:gameId/rematch').post(requirePlayer, onlyFields([]), rematchGame);                       // POST /games/:gameId/rematch -> FRIEND GAMES THAT ARE OVER: FIRST PRESS WAITS, THE SECOND MAKES THE NEW GAME
router.route('/:gameId/ratings').get(requirePlayer, onlyFields([]), getRatings);                        // GET /games/:gameId/ratings  -> BOTH PLAYERS' RATINGS FOR THE GAME MENU
module.exports = router
