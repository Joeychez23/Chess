/*
 *  index.js  --  data service
 *	Game Routes
 *  Each route is one action a player takes on a game. It loads the stored game, checks the player in the request can take that
 *  action on it now, then saves through db/. Nothing in a body is saved as sent: a move is played on the stored board.
 *  The one exception is an opening's name, the data set is on the chess server. It's checked for its shape & can't change anything else
 *
 *  game.play.js     reading a game, moves, openings, ratings, a card game's saves
 *  game.offers.js   takebacks, forfeits, draws & rematches
 *  game.new.js      new games vs the AI (signed in, guest, Chess Cards)
 *  game.invites.js  invites & challenge links
 *  game.shared.js   steps more than one of them takes
 *
 */

const gamePlay = require("./game.play.js");
const gameOffers = require("./game.offers.js");
const gameNew = require("./game.new.js");
const gameInvites = require("./game.invites.js");
const gameShared = require("./game.shared.js");


module.exports = {
	getGame: gamePlay.getGame,
	moveGame: gamePlay.moveGame,
	newCardsGame: gameNew.newCardsGame,
	saveCardsGame: gamePlay.saveCardsGame,
	aiMoveGame: gamePlay.aiMoveGame,
	takebackGame: gameOffers.takebackGame,
	declineTakebackGame: gameOffers.declineTakebackGame,
	openingGame: gamePlay.openingGame,
	forfeitGame: gameOffers.forfeitGame,
	drawGame: gameOffers.drawGame,
	declineDrawGame: gameOffers.declineDrawGame,
	aiDrawGame: gameOffers.aiDrawGame,
	getRatings: gamePlay.getRatings,
	newAiGame: gameNew.newAiGame,
	newGuestGame: gameNew.newGuestGame,
	inviteGame: gameInvites.inviteGame,
	challengeGame: gameInvites.challengeGame,
	getChallenge: gameInvites.getChallenge,
	joinGame: gameInvites.joinGame,
	acceptGame: gameInvites.acceptGame,
	declineGame: gameInvites.declineGame,
	rematchGame: gameOffers.rematchGame,
	cancelRematchGame: gameOffers.cancelRematchGame,
	currentGame: gameShared.currentGame,
};
