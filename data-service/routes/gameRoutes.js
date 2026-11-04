/*
 *  gameRoutes.js  --  data service
 *	Game Routes
 *	/games/*: making, reading & playing games, one named action per route (controllers/gameController.js)
 *
 */

const router = require('express').Router()
const { requirePlayer } = require('../middleware/player.js')
const { onlyFields } = require('../middleware/fields.js')
const { getGame, moveGame, aiMoveGame, takebackGame, declineTakebackGame, openingGame, forfeitGame, drawGame, declineDrawGame, aiDrawGame, getRatings, newAiGame, newGuestGame, inviteGame, challengeGame, getChallenge, joinGame, acceptGame, declineGame, rematchGame, cancelRematchGame } = require('../controllers/gameController.js')
// EVERY ROUTE ACTS FOR req.player (middleware/player.js) & NAMES THE BODY FIELDS IT TAKES, A BODY WITH ANYTHING ELSE IS REFUSED (400)
router.route('/ai').post(requirePlayer, onlyFields(["color", "level", "start_fen"]), newAiGame);                     // POST /games/ai              -> A SIGNED IN PLAYER'S NEW GAME VS THE AI (A NEW ID ONLY)
router.route('/guest').post(onlyFields(["game_id", "color", "side", "level", "start_fen"]), newGuestGame);                               // POST /games/guest           -> A GUEST'S GAME VS THE AI, OVERWRITES ONLY THEIR OWN (NO PLAYER = A NEW GUEST)
router.route('/invite').post(requirePlayer, onlyFields(["opponent_id", "opponent_screenname", "color", "start_fen", "takebacks", "days_per_move"]), inviteGame); // POST /games/invite -> A PENDING FRIEND GAME, THE REQUESTER IS THE INVITER
router.route('/challenge').post(requirePlayer, onlyFields(["color", "start_fen", "takebacks", "days_per_move"]), challengeGame); // POST /games/challenge -> A CHALLENGE LINK'S PENDING GAME, THE OTHER SEAT IS EMPTY
router.route('/:gameId').get(onlyFields([]), getGame);                                   // GET /games/:gameId          -> THE GAME, ONLY FOR A PLAYER IN IT (A MISSING GAME SAYS SO TO ANYONE, ?consistent=true SEES A SAVE THAT JUST HAPPENED)
router.route('/:gameId/move').post(requirePlayer, onlyFields(["from", "to", "promotion"]), moveGame);     // POST /games/:gameId/move    -> THE REQUESTER'S MOVE ON THE STORED BOARD, CLOSES THE GAME ON MATE OR A DRAW
router.route('/:gameId/ai-move').post(requirePlayer, onlyFields(["from", "to", "promotion"]), aiMoveGame); // POST /games/:gameId/ai-move -> AI GAMES: THE AI'S MOVE (FROM THE ENGINE), ONLY ON ITS TURN
router.route('/:gameId/takeback').post(requirePlayer, onlyFields([]), takebackGame);                     // POST /games/:gameId/takeback -> AI GAMES: THE REQUESTER'S LAST MOVE & THE AI'S REPLY, IF IT MADE ONE
router.route('/:gameId/takeback/decline').post(requirePlayer, onlyFields([]), declineTakebackGame);      // POST /games/:gameId/takeback/decline -> FRIEND GAMES: THE ASKED PLAYER TURNS IT DOWN
router.route('/:gameId/opening').post(requirePlayer, onlyFields(["board", "eco", "name"]), openingGame); // POST /games/:gameId/opening -> THE OPENING THE CHESS SERVER FOUND FOR THE BOARD A MOVE SAVED, ONLY WHILE IT'S STILL THE GAME'S BOARD
router.route('/:gameId/forfeit').post(requirePlayer, onlyFields([]), forfeitGame);                       // POST /games/:gameId/forfeit -> THE REQUESTER GIVES UP AN OPEN GAME, THE OTHER SIDE WINS
router.route('/:gameId/draw').post(requirePlayer, onlyFields([]), drawGame);                             // POST /games/:gameId/draw    -> THE REQUESTER'S DRAW OFFER (ONE PER PLAYER PER MOVE), OR ACCEPTS THE OPPONENT'S
router.route('/:gameId/draw/decline').post(requirePlayer, onlyFields([]), declineDrawGame);              // POST /games/:gameId/draw/decline -> FRIEND GAMES: THE OFFERED PLAYER TURNS IT DOWN
router.route('/:gameId/draw/ai-answer').post(requirePlayer, onlyFields(["accept"]), aiDrawGame);         // POST /games/:gameId/draw/ai-answer -> AI GAMES: THE AI'S ANSWER (FROM THE ENGINE) TO THE REQUESTER'S OFFER
router.route('/:gameId/accept').post(requirePlayer, onlyFields(["replace_current"]), acceptGame);                         // POST /games/:gameId/accept  -> THE INVITED PLAYER STARTS THE GAME (replace_current FORFEITS THEIR OPEN ONE), NOT WHILE THE INVITER IS IN ANOTHER FRIEND GAME
router.route('/:gameId/challenge').get(requirePlayer, onlyFields([]), getChallenge);                     // GET /games/:gameId/challenge -> WHAT THE JOIN SCREEN SHOWS, FOR ANY SIGNED IN PLAYER WITH THE LINK
router.route('/:gameId/join').post(requirePlayer, onlyFields(["replace_current"]), joinGame);             // POST /games/:gameId/join    -> TAKES A CHALLENGE LINK'S EMPTY SEAT, ONLY ONE PLAYER WINS IT (replace_current FORFEITS THEIR OPEN GAME)
router.route('/:gameId/decline').post(requirePlayer, onlyFields([]), declineGame);                       // POST /games/:gameId/decline -> EITHER PLAYER DELETES A PENDING INVITE
router.route('/:gameId/rematch').post(requirePlayer, onlyFields([]), rematchGame);                       // POST /games/:gameId/rematch -> FRIEND GAMES THAT ARE OVER: FIRST PRESS WAITS, THE SECOND MAKES THE NEW GAME
router.route('/:gameId/rematch/cancel').post(requirePlayer, onlyFields([]), cancelRematchGame);          // POST /games/:gameId/rematch/cancel -> THE PLAYER WHO ASKED TAKES IT BACK, UNTIL THE OTHER PRESS CLAIMS IT
router.route('/:gameId/ratings').get(requirePlayer, onlyFields([]), getRatings);                        // GET /games/:gameId/ratings  -> BOTH PLAYERS' RATINGS FOR THE GAME MENU
module.exports = router
