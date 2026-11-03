/*
 *  confirm.js  --  chess frontend
 *	Two Press Confirm
 *	Every menu action that ends something (Forfeit & Logout): the first press asks "Are you sure?", the second press acts.
 *	One button waits at a time. The question goes away after 5 seconds & whenever the menu closes
 *
 */

const CONFIRM_TIME = 5000; // HOW LONG THE QUESTION STAYS (ms)
let armed = null; // THE BUTTON ASKING "Are you sure?"
let armedLabel; // ITS TEXT BEFORE IT ASKED
let armedTimer; // PUTS IT BACK AFTER CONFIRM_TIME

/**
 * @description A press of a button that needs confirming. The caller only acts on true
 * @param  {[object]} btn [the button pressed]
 * @return {[boolean]} confirmed [true: this is the second press & the button has its text back. false: it's now asking]
 */
export function confirmPress(btn) {
	if (armed == btn) {
		disarmConfirm();
		return true;
	}
	disarmConfirm(); // ANOTHER BUTTON WAS ASKING
	armed = btn;
	armedLabel = btn.textContent;
	btn.textContent = "Are you sure?";
	armedTimer = setTimeout(disarmConfirm, CONFIRM_TIME);
	return false;
}

/**
 * @description Puts the waiting button back, the next press only asks again. Call it when the menu closes or the game ends
 */
export function disarmConfirm() {
	if (!armed) { return; }
	clearTimeout(armedTimer);
	armed.textContent = armedLabel;
	armed = null;
}
