/*
 *  index.js  --  chess server
 *	Chess Routes (was the chess lambda, chess-validation/lambdas/functions/chess/index.js)
 *  Each branch of the lambda's handler is its own route now. Responses keep the lambda's body ({ status, ..., message })
 *  so the client checks them the same way. The HTTP status is the real one & the body's status
 *  is the same. The games & players are read & saved through the data service (dataClient.js),
 *  which checks every action again
 *
 *  chess.games.js    loading a game, its PGN & ratings, new & restarted AI games, the levels, Home's lists, leaving every game
 *  chess.play.js     moves, the AI's moves & the engine's analysis (the one aiTurns & runningAnalyses)
 *  chess.offers.js   takebacks, forfeits, draw offers & rematches
 *  chess.invites.js  invites & challenge links
 *  chess.shapers.js  the bodies sent back & the read* helpers
 *  chess.guards.js   reading a game, who the requester is, loadMyGame & answering with the real HTTP status
 *
 */

const chessGames = require("./chess.games.js");
const chessPlay = require("./chess.play.js");
const chessOffers = require("./chess.offers.js");
const chessInvites = require("./chess.invites.js");
const chessShapers = require("./chess.shapers.js");
const chessGuards = require("./chess.guards.js");


module.exports = {
	getGame: chessGames.getGame,
	getPgn: chessGames.getPgn,
	newGame: chessGames.newGame,
	moveGame: chessPlay.moveGame,
	restartGame: chessGames.restartGame,
	aiMoveGame: chessPlay.aiMoveGame,
	analysisGame: chessPlay.analysisGame,
	takebackGame: chessOffers.takebackGame,
	declineTakebackGame: chessOffers.declineTakebackGame,
	getLevels: chessGames.getLevels,
	forfeitGame: chessOffers.forfeitGame,
	drawGame: chessOffers.drawGame,
	declineDrawGame: chessOffers.declineDrawGame,
	rematchGame: chessOffers.rematchGame,
	cancelRematchGame: chessOffers.cancelRematchGame,
	inviteGame: chessInvites.inviteGame,
	challengeGame: chessInvites.challengeGame,
	getChallenge: chessInvites.getChallenge,
	joinGame: chessInvites.joinGame,
	acceptGame: chessInvites.acceptGame,
	declineGame: chessInvites.declineGame,
	getUserGames: chessGames.getUserGames,
	getRatings: chessGames.getRatings,
	leaveAllGames: chessGames.leaveAllGames,
	readSettings: chessShapers.readSettings,
	isStatusDisplay: chessShapers.isStatusDisplay,
	userPlayerId: chessGuards.userPlayerId,
	httpStatus: chessGuards.httpStatus,
	retrieveGame: chessGuards.retrieveGame,
	currentGame: chessGames.currentGame,
	playerInGame: chessGuards.playerInGame,
	notYours: chessGuards.notYours,
	notInGame: chessGuards.notInGame,
	reply: chessGuards.reply,
	aiLevel: chessShapers.aiLevel,
};
