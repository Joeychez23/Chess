/*
 *  friends.js  --  data service
 *	Friend Requests (#40)
 *  What each action does to the two players' friend lists, & when it's refused. Both rows are saved together (changeFriends in dynamoDB.js)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const MAX_FRIENDS = 50; // WITH THE REQUESTS BELOW, AT MOST 100 NAMES TO LOOK UP: ONE BATCH GET
const MAX_REQUESTS = 25; // SENT & RECEIVED EACH, SO NOBODY'S ROW CAN BE FILLED WITH REQUESTS

const drop = (list, id) => { const at = list.indexOf(id); if (at >= 0) { list.splice(at, 1); } return at >= 0; };

/* ---------------------------------------------------------------- */
// Actions
/* ---------------------------------------------------------------- */
/**
 * @description Each action edits both players' lists, or answers why it can't. They can run more than once, on fresh lists (changeFriends)
 * @param  {[object]} mine [the requester's { friends, sent, received }, arrays of player ids]
 * @param  {[object]} theirs [the other player's]
 * @param  {[string]} me [the requester's id]
 * @param  {[string]} them [the other player's id]
 * @return {[object]} refused [{ status, message }, nothing when the lists were edited]
 */
const FRIEND_ACTIONS = {
	request(mine, theirs, me, them) {
		if (mine.friends.includes(them)) { return { status: 409, message: "You're already friends" }; }
		if (mine.sent.includes(them)) { return { status: 409, message: "You already sent them a request" }; }
		if (mine.received.includes(them)) { return { status: 409, message: "They already sent you a request, accept it in Friends" }; }
		if (mine.friends.length >= MAX_FRIENDS) { return { status: 409, message: "Your friends list is full" }; }
		if (mine.sent.length >= MAX_REQUESTS) { return { status: 409, message: "You have too many requests waiting" }; }
		if (theirs.received.length >= MAX_REQUESTS) { return { status: 409, message: "They have too many requests waiting" }; }
		mine.sent.push(them);
		theirs.received.push(me);
	},
	accept(mine, theirs, me, them) {
		if (!mine.received.includes(them)) { return { status: 404, message: "That request was cancelled" }; }
		if (mine.friends.length >= MAX_FRIENDS) { return { status: 409, message: "Your friends list is full" }; }
		if (theirs.friends.length >= MAX_FRIENDS) { return { status: 409, message: "Their friends list is full" }; }
		drop(mine.received, them);
		drop(theirs.sent, me);
		mine.friends.push(them);
		theirs.friends.push(me);
	},
	decline(mine, theirs, me, them) {
		if (!drop(mine.received, them)) { return { status: 404, message: "That request was cancelled" }; }
		drop(theirs.sent, me);
	},
	cancel(mine, theirs, me, them) {
		if (!drop(mine.sent, them)) { return { status: 404, message: "That request was already answered" }; }
		drop(theirs.received, me);
	},
	remove(mine, theirs, me, them) {
		if (!drop(mine.friends, them)) { return { status: 404, message: "You're not friends" }; }
		drop(theirs.friends, me);
	},
};

/**
 * @description Takes two players off each other's lists, whatever they are to each other (Delete my data)
 */
function unlinkFriends(mine, theirs, me, them) {
	for (const list of ["friends", "sent", "received"]) {
		drop(mine[list], them);
		drop(theirs[list], me);
	}
}


module.exports = { FRIEND_ACTIONS, unlinkFriends, MAX_FRIENDS, MAX_REQUESTS };
