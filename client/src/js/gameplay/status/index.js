/*
 *  index.js  --  chess frontend
 *	Status
 *	The message area on the play page (#gameStatus, role="status" so screen readers read it out): refused moves, a lost
 *	connection & the server or AI not answering. One message per kind, the newest shows, the one under it comes back when it goes
 *
 */

const statusArea = document.getElementById("gameStatus");
let messages = []; // [{ kind, text, timer }], THE LAST ONE SHOWS

export const MESSAGE_TIME = 6000; // A MESSAGE WITH NOTHING TO WAIT FOR GOES AWAY AFTER THIS (ms)

/**
 * @description Puts what should show in the message area. Only touches it when the text changes, so it isn't read out twice
 */
function showNewest() {
	const text = messages.length ? messages[messages.length - 1].text : "";
	if (statusArea.textContent != text) { statusArea.textContent = text; }
}

/**
 * @description Takes a kind of message out of the list & stops its timer
 * @param  {[string]} kind [same as showStatus]
 */
function removeMessage(kind) {
	messages = messages.filter(function (message) {
		if (message.kind == kind) { clearTimeout(message.timer); }
		return message.kind != kind;
	});
}

/**
 * @description Shows a message, replacing the last one of its kind
 * @param  {[string]} kind ["move", "server", "ai", "action" or "connection"]
 * @param  {[string]} text [what the player reads]
 * @param  {[number]} clearAfter [ms until it goes away, leave it out to keep it until clearStatus(kind)]
 */
export function showStatus(kind, text, clearAfter) {
	removeMessage(kind);
	const message = { kind, text };
	if (clearAfter) { message.timer = setTimeout(function () { clearStatus(kind); }, clearAfter); }
	messages.push(message);
	showNewest();
}

/**
 * @description Takes a kind of message away, things recovered
 * @param  {[string]} kind [same as showStatus]
 */
export function clearStatus(kind) {
	removeMessage(kind);
	showNewest();
}

/**
 * @description The request got no usable answer: the network failed or the server broke (validate/index.js returns nothing
 * when fetch or the JSON fails, serverError is an HTTP 5xx). Any other answer that isn't a 200 is the server saying no,
 * status in the body doesn't tell them apart, the chess routes refuse a move with status: 500
 * @param  {[object]} response [from validate/index.js]
 * @return {[boolean]}
 */
export function noAnswer(response) {
	return !response || !!response.serverError;
}
