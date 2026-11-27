/*
 *  mail.js  --  chess frontend
 *	The Terminal's Mail Screen
 *	The game's events come in as mail, the player's requests go out. Left, the last 6 mails newest first & the request buttons;
 *	right, the selected mail with Accept & Decline while its offer is still open. The Terms request opens the player's own terms as
 *	a mail first: Accept sends them, Decline drops them, & what came of them arrives as mail
 *	It lays itself out for its window's width: the right pane takes what the list leaves, & under NARROW only the mail shows (no list,
 *	no requests, no From, To & Re rows). Content pixels ((0, 0) is the window's inside, top left): the desktop frames, clips & scrolls it
 *	No DOM & no three.js here, so the tests load it in Node (client/test/monitor/screens-mail.test.js)
 *
 */

import { LINE, px, drawText, box, btn, boxW } from "../kit.js";
import { fitText } from "../../pixelFont.js";
import { tagOf } from "../events.js";

const SUBJECT = { check: "Check", lost: "Asset lost", terms: "Terms", reversal: "Reversal", guidance: "Guidance", fault: "Line fault", answer: "Terms" };
const LIST = 6; // MAILS LISTED
const SIZE = { w: 278, h: 180 }; // THE INSIDE OF THE PART A { 20, 20, 280, 194 } WINDOW BELOW ITS TITLE BAR
const ROW = { x: 5, y: 7, w: 74, h: 11, pitch: 13 }; // A LISTED MAIL
const REQUESTS = [["hint", "Guidance"], ["takeback", "Reversal"], ["draw", "Terms"]]; // ACTION ID, LABEL
const REQ = { x: 5, y: 127, w: 74, h: 12, pitch: 15 }; // EACH REQUEST KEEPS ITS OWN SLOT
const PANE = { x: 100, y: 21, w: 155 }; // THE SELECTED MAIL'S TEXT
const LETTERS = 26; // (PANE.w + 1) / 6, IN THE DEFAULT WINDOW
const NARROW = 200; // UNDER THIS WIDTH ONLY THE MAIL SHOWS
const DRAFT = { kind: "terms", draft: true, text: "Propose to end the session as a draw." }; // THE PLAYER'S OWN TERMS, BEFORE THEY ARE SENT
const BODY = 6; // BODY LINES
const OFFER = { terms: "draw", reversal: "takeback" }; // THE OFFER EACH MAIL ANSWERS

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */

const mails = (v) => (v.term && Array.isArray(v.term.mail) ? v.term.mail.filter(Boolean) : []); // A BROKEN ENTRY IS SKIPPED
const subjectOf = (mail) => SUBJECT[mail && mail.kind] || "Notice";
const action = (v, id) => (Array.isArray(v.actions) ? v.actions : []).find((a) => a && a.id === id);

/**
 * @description Where the mail's pane is for the window's width
 * @param  {[object]} v screen data
 * @return {[object]} { w (the content's), narrow, x, pw (the text's width), letters (per line), bar ({ x, w }, the subject bar) }
 */
function pane(v) {
	const w = boxW(v, SIZE.w), narrow = w < NARROW;
	const x = narrow ? 6 : PANE.x, pw = narrow ? w - 12 : w - 123;
	return { w, narrow, x, pw, letters: Math.floor((pw + 1) / 6), bar: narrow ? { x: 4, w: w - 8 } : { x: 95, w: w - 106 } };
}

/**
 * @description The player's own terms, opened by the Terms request & not yet sent; null when none are open or they can no longer be sent
 * @param  {[object]} v screen data
 * @return {[object|null]}
 */
function draftOf(v) {
	const a = action(v, "draw");
	return v.ui && v.ui.draft === "terms" && a && a.shown && a.enabled ? DRAFT : null;
}

// The mail the pane shows: the open draft, else the selected one
const shownMail = (v) => draftOf(v) || mails(v)[selectedOf(v)];

/**
 * @description The selected mail's index in term.mail
 * @param  {[object]} v screen data
 * @return {[number]} ui.selected when in range, else the newest; -1 with no mail
 */
function selectedOf(v) {
	const n = mails(v).length;
	const s = v.ui && v.ui.selected;
	return Number.isInteger(s) && s >= 0 && s < n ? s : n - 1;
}

/**
 * @description Who a mail is from
 * @param  {[object]} mail
 * @param  {[object]} v screen data
 * @return {[string]} the other side's tag for game mail, MERIDIAN for the terminal's own
 */
function fromOf(mail, v) {
	if (mail.draft) { return `[${v.who || "GUEST"}]`; }
	return mail.kind === "guidance" || mail.kind === "fault" ? "MERIDIAN" : tagOf(v);
}

/**
 * @description The offer a mail answers, if it is still open
 * @param  {[object]} mail
 * @param  {[object]} v screen data
 * @return {[boolean]}
 */
function openOffer(mail, v) {
	if (!mail || mail.draft) { return false; }
	const offer = OFFER[mail.kind];
	const list = mails(v), newest = list.filter((m) => m.kind === mail.kind).pop(); // AN OLDER MAIL OF THE KIND IS A PAST OFFER: ONLY THE NEWEST ONE CAN STILL BE ANSWERED
	return !!offer && (!newest || mail === newest) && (v.offers || {})[offer] === "incoming";
}

/**
 * @description Words wrapped to lines of `letters`; a word too long for a line is cut
 * @param  {[string]} text
 * @param  {[number]} letters
 * @return {[string[]]}
 */
function wrap(text, letters = LETTERS) {
	const lines = [];
	let line = "";
	for (const word of String(text || "").split(/\s+/).filter(Boolean)) {
		const next = line ? `${line} ${word}` : word;
		if ([...next].length <= letters) { line = next; continue; }
		if (line) { lines.push(line); }
		line = [...word].length > letters ? fitText(word, letters * 6 - 1) : word;
	}
	if (line) { lines.push(line); }
	return lines;
}

/**
 * @description A mail's body: its text, then one line of what follows from it
 * @param  {[object]} mail { kind, at, text, read }
 * @param  {[object]} v screen data
 * @param  {[number]} letters [per line, 26 in the default window]
 * @return {[string[]]} at most 6 lines of at most `letters` letters
 */
function bodyOf(mail, v, letters = LETTERS) {
	const kind = mail && mail.kind;
	const move = String((mail && mail.text) || "").match(/([a-h][1-8])\s*([a-h][1-8])/);
	const after = mail && mail.draft ? "Respond below." : {
		check: "Your king is attacked.",
		lost: "One of yours was taken.",
		terms: openOffer(mail, v) ? "Awaiting your answer." : "No longer open.",
		reversal: openOffer(mail, v) ? "Awaiting your answer." : "No longer open.",
		guidance: move ? `Move ${move[1]} to ${move[2]}.` : "No move on record.",
		fault: "The session was kept.",
	}[kind];
	const text = wrap(mail && mail.text, letters).slice(0, after ? BODY - 1 : BODY);
	return after ? [...text, after] : text;
}

/* ---------------------------------------------------------------- */
// Screen module
/* ---------------------------------------------------------------- */

/**
 * @description The mail's rows for the window's width: From, To & Re (not when narrow), a gap, then the body
 * @param  {[object]} mail
 * @param  {[object]} v screen data
 * @return {[Array]} [[text, tone]]
 */
function paneRows(mail, v) {
	const p = pane(v);
	const to = mail.draft ? tagOf(v) : `[${fitText(v.who || "GUEST", p.pw - 36)}]`; // "To: []" TAKES 6 LETTERS
	const head = p.narrow ? [] : [[`From: ${fromOf(mail, v)}`, "dim"], [`To: ${to}`, "dim"], [`Re: ${subjectOf(mail)}`, "dim"], ["", "ink"]];
	return [...head, ...bodyOf(mail, v, p.letters).map((l) => [l, "ink"])];
}

// Accept & Decline's y: under the mail's rows when narrow, where they always were otherwise
function answerY(v) {
	const mail = shownMail(v);
	return pane(v).narrow ? PANE.y + (mail ? paneRows(mail, v).length : 1) * LINE + 6 : 157;
}

/**
 * @description The content's size for the window's width; the desktop scrolls what a short window cuts off
 * @param  {[object]} v screen data
 * @return {[object]} { w, h } in grid pixels
 */
function size(v) {
	const p = pane(v || {});
	return { w: p.w, h: p.narrow ? answerY(v || {}) + 18 : SIZE.h };
}

/**
 * @description The screen's buttons in content pixels, in keyboard order: messages top to bottom, requests, accept, decline
 * (no messages & no requests when narrow)
 * @param  {[object]} v screen data
 * @return {[object[]]} [{ id, x, y, w, h, label, enabled }]
 */
function buttons(v) {
	const list = mails(v), p = pane(v);
	const out = [];
	if (!p.narrow) {
		for (let r = 0, i = list.length - 1; r < LIST && i >= 0; r++, i--) {
			out.push({ id: `msg:${i}`, x: ROW.x, y: ROW.y + r * ROW.pitch, w: ROW.w, h: ROW.h, label: subjectOf(list[i]), enabled: true });
		}
		REQUESTS.forEach(([id, label], slot) => {
			const a = action(v, id);
			if (a && a.shown) { out.push({ id: `req:${id}`, x: REQ.x, y: REQ.y + slot * REQ.pitch, w: REQ.w, h: REQ.h, label, enabled: !!a.enabled }); }
		});
	}
	if (draftOf(v) || openOffer(list[selectedOf(v)], v)) {
		const w = Math.min(70, Math.floor((p.pw - 6) / 2)), x = p.x + 3, y = answerY(v);
		out.push({ id: "accept", x, y, w, h: 12, label: "Accept", enabled: true });
		out.push({ id: "decline", x: x + w + 6, y, w, h: 12, label: "Decline", enabled: true });
	}
	return out;
}

/**
 * @description Draws the MAIL content at (0, 0); the desktop draws the window around it
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} v screen data
 */
function draw(ctx, v) {
	const { T } = v;
	const list = mails(v);
	const p = pane(v), draft = draftOf(v);
	const sel = draft ? -1 : selectedOf(v); // NO LISTED MAIL IS THE ONE SHOWN WHILE THE DRAFT IS
	const lit = (b) => b.id === v.focus || b.id === v.hover;
	const all = buttons(v);
	for (const b of all.filter((x) => x.id.startsWith("msg:"))) {
		const i = Number(b.id.slice(4));
		const on = i === sel;
		const unread = !list[i].read;
		px(ctx, b.x, b.y, b.w, b.h, on ? T.ink : T.faint);
		px(ctx, b.x + 3, b.y + 4, 6, 3, unread ? T.hot : on ? T.bg : T.dim);
		drawText(ctx, fitText(b.label, b.w - 14), b.x + 12, b.y + 2, on ? T.bg : unread ? T.ink : T.dim);
		if (lit(b)) { box(ctx, b.x, b.y, b.w, b.h, T.hot); }
	}
	if (!p.narrow) {
		drawText(ctx, "REQUEST", 6, 117, T.dim);
		px(ctx, 91, 4, 1, 174, T.dim);
	}
	for (const b of all.filter((x) => !x.id.startsWith("msg:"))) { btn(ctx, T, b, lit(b)); }
	px(ctx, p.bar.x, 5, p.bar.w, 11, T.ink);
	px(ctx, p.bar.x + 3, 8, 8, 5, T.bg);
	const mail = draft || list[sel];
	if (!mail) {
		drawText(ctx, "No mail.", p.x, PANE.y, T.dim);
		return;
	}
	drawText(ctx, fitText(subjectOf(mail).toUpperCase(), p.bar.w - 32), p.bar.x + p.bar.w / 2, 7, T.bg, 0);
	paneRows(mail, v).forEach(([text, tone], r) => drawText(ctx, fitText(text, p.pw), p.x, PANE.y + r * LINE, T[tone]));
}

/**
 * @description Runs a button; one that is not showing or not enabled does nothing
 * @param  {[string]} id
 * @param  {[object]} handlers
 * @param  {[object]} v screen data
 */
function press(id, handlers, v) {
	const b = buttons(v).find((x) => x.id === id);
	if (!b || !b.enabled) { return; }
	const call = (name, ...args) => typeof handlers[name] === "function" && handlers[name](...args);
	if (id.startsWith("msg:")) {
		const i = Number(id.slice(4));
		call("ui", { selected: i, draft: null });
		call("read", i);
		return;
	}
	if (id === "req:draw") { call("ui", { draft: "terms" }); return; } // THE TERMS OPEN AS A MAIL FIRST: ITS Accept SENDS THEM
	if (draftOf(v)) { // THE DRAFT CLOSES EITHER WAY; SENT, THE NEWEST MAIL (THE ANSWER) SHOWS
		call("ui", { draft: null, selected: null });
		if (id === "accept") { call("draw"); }
		return;
	}
	const kind = (mails(v)[selectedOf(v)] || {}).kind;
	if (id === "accept") { call(kind === "terms" ? "draw" : "takeback"); }
	else if (id === "decline") { call(kind === "terms" ? "declineDraw" : "declineTakeback"); }
	else { call(id.slice(4)); }
}

/**
 * @description What a screen reader says
 * @param  {[object]} v screen data
 * @return {[string]}
 */
function speak(v) {
	const list = mails(v);
	if (draftOf(v)) { return "Your terms: a draw. Accept sends them, Decline drops them."; }
	if (!list.length) { return "No mail."; }
	const unread = list.filter((x) => !x.read).length;
	return `${list.length} ${list.length === 1 ? "message" : "messages"}, ${unread} unread. ${subjectOf(list[selectedOf(v)])}.`;
}

export { SUBJECT, bodyOf, fromOf, size, draw, buttons, press, speak };
