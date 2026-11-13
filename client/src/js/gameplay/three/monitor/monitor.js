/*
 *  monitor.js  --  chess frontend
 *	The CRT Monitor's State Machine
 *	The monitor as the game's menu: idle on the desk, zooming in, zoomed (the tab row & the channel's buttons) & leaving. It is fed pointer hits in grid pixels & keys by
 *	../index.js, & screen.js draws its view(). Also the pure helpers: the tab row, hit testing, focus movement, keys, zoom maths & the screen reader text.
 *	No DOM & no three.js here, so the tests load it in Node (client/test/monitor.test.js)
 *
 */

import { W, H, NAMES, SHORT, tabRow, sentence } from "./kit.js";
import { CHANNEL } from "./channels/index.js";
import { slots } from "./channels/actions.js";
import { CHANNELS, clean, loadPrefs as loadStored, savePrefs as saveStored } from "./prefs.js";
import { textWidth } from "../pixelFont.js";

const ORDER = [...CHANNELS]; // CHANNEL IDS, IN TAB ORDER; A COPY SO NOTHING HERE CAN CHANGE PREFS.JS'S LIST
const TAB = { pad: 2, gap: 0 }; // A TAB IS ITS LABEL PLUS A 1 px BORDER EACH SIDE, BORDERS SIDE BY SIDE: ALL SEVEN & ◀ FIT THE SAFE AREA'S 144 px
const BACK = "◀ BACK", BACK_SHORT = "◀";
const YOUR_MOVE = "▶ YOUR MOVE";
const KEYS = { w: "up", a: "left", s: "down", d: "right" };
const ARROWS = { ArrowUp: "up", ArrowLeft: "left", ArrowDown: "down", ArrowRight: "right" };
const AXES = { up: [1, -1], down: [1, 1], left: [0, -1], right: [0, 1] }; // [AXIS (0 X, 1 Y), SIGN]

/* ---------------------------------------------------------------- */
// Geometry
/* ---------------------------------------------------------------- */

/**
 * @description The grid pixel under a point on the glass
 * @param  {[number]} u [0 to 1, left to right]
 * @param  {[number]} v [0 to 1, top to bottom: the glass's UVs start at the top]
 * @return {[object]} { x, y } clamped to the grid
 */
export function uvToGrid(u, v) {
	const clamp = (n, max) => Math.min(max - 1, Math.max(0, Math.floor(n)));
	return { x: clamp(u * W, W), y: clamp(v * H, H) };
}

/**
 * @description The camera distance at which a glass fills part of the view in its tighter dimension
 * @param  {[number]} w [the glass's width]
 * @param  {[number]} h [the glass's height]
 * @param  {[number]} fovDeg [the camera's vertical field of view]
 * @param  {[number]} aspect [the view's width over its height]
 * @param  {[number]} fill [the part of the view to fill]
 * @return {[number]} distance
 */
export function zoomDistance(w, h, fovDeg, aspect, fill = 0.8) {
	const tan = Math.tan((fovDeg * Math.PI) / 360);
	return Math.max(h / (2 * tan * fill), w / (2 * tan * aspect * fill)); // THE FARTHER ONE KEEPS BOTH SIDES IN VIEW
}

/**
 * @description Whether a press & its release were a tap rather than a drag
 * @param  {[object]} press [{ x, y } in screen pixels]
 * @param  {[object]} release [{ x, y }]
 * @param  {[string]} type [the pointer type: mouse, pen or touch]
 * @return {[boolean]}
 */
export function isTap(press, release, type) {
	return Math.hypot(release.x - press.x, release.y - press.y) < (type === "touch" ? 10 : 4); // FINGERS WOBBLE MORE
}

/* ---------------------------------------------------------------- */
// Channels
/* ---------------------------------------------------------------- */

/**
 * @description The channels this game & these settings offer, in tab order
 * @param  {[object]} data [the game's data]
 * @param  {[object]} prefs [the settings]
 * @return {[string[]]} ids
 */
export function available(data, prefs) {
	return ORDER.filter(function (id) {
		if (id === "setup") { return true; } // ALWAYS A WAY BACK TO THE SETTINGS
		if (!prefs.enabled.includes(id)) { return false; }
		if (id === "face") { return !!data.ai; }
		if (id === "eval") { return !!(data.eval && data.eval.allowed); }
		return true;
	});
}

/**
 * @description The channel the monitor shows on the desk
 * @param  {[object]} data [the game's data]
 * @param  {[object]} prefs [the settings]
 * @return {[string]} id
 */
export function idleChannel(data, prefs) {
	const offered = available(data, prefs);
	if (prefs.defaultChannel && offered.includes(prefs.defaultChannel)) { return prefs.defaultChannel; }
	if (data.ai && offered.includes("face")) { return "face"; }
	if (!data.ai && offered.includes("waiting") && !data.yourTurn && !data.over) { return "waiting"; }
	return offered.includes("opponent") ? "opponent" : "setup";
}

/* ---------------------------------------------------------------- */
// Buttons
/* ---------------------------------------------------------------- */

/**
 * @description The tab row: BACK, then one tab per channel, centred in the safe area's top row (kit.js tabRow)
 * @param  {[string[]]} ids [the channels, in order]
 * @param  {[string]} [active] [the showing channel, whose tab is marked selected]
 * @return {[object[]]} buttons
 */
export function tabButtons(ids, active) {
	const tabW = (label) => textWidth(label) + TAB.pad;
	const row = (back) => tabW(back) + ids.reduce((sum, id) => sum + TAB.gap + tabW(SHORT[id]), 0);
	const area = tabRow();
	const back = row(BACK) <= area.w ? BACK : BACK_SHORT; // THE SHORT ARROW WHEN THE WORD WON'T FIT
	let x = area.x + Math.floor((area.w - row(back)) / 2);
	const list = [];
	for (const [id, label] of [["back", back], ...ids.map((c) => [`tab:${c}`, SHORT[c]])]) {
		const w = tabW(label);
		const button = { id, x, y: area.y, w, h: area.h, label, enabled: true };
		if (id === `tab:${active}`) { button.selected = true; }
		list.push(button);
		x += w + TAB.gap;
	}
	return list;
}

// HOW FAR A POINT IS FROM A BUTTON'S BOX, 0 INSIDE (CHEBYSHEV)
function distance(b, x, y) {
	return Math.max(b.x - x, 0, x - (b.x + b.w), b.y - y, y - (b.y + b.h));
}

/**
 * @description The button under a point, or the only one within reach of it
 * @param  {[object[]]} buttons
 * @param  {[number]} x [grid pixels]
 * @param  {[number]} y
 * @param  {[number]} slop [how far a near miss may be]
 * @return {[object|null]} the enabled button containing the point, else the single enabled one within slop, else null (two in reach is a miss)
 */
export function hit(buttons, x, y, slop = 4) {
	const live = buttons.filter((b) => b.enabled);
	const inside = live.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
	if (inside) { return inside; }
	const near = live.filter((b) => distance(b, x, y) <= slop);
	return near.length === 1 ? near[0] : null;
}

// A BUTTON'S CENTRE AS [X, Y]
function middle(b) {
	return [b.x + b.w / 2, b.y + b.h / 2];
}

/**
 * @description Where focus goes from a button in a direction, so it never sticks
 * @param  {[object[]]} buttons
 * @param  {[string]} fromId [the focused button]
 * @param  {[string]} dir [up, down, left or right]
 * @return {[string|null]} the nearest enabled button that way (primary distance plus twice the cross distance), else the farthest the other way (ties nearest on the cross axis),
 *                          else fromId; the first enabled button when fromId is unknown
 */
export function nextFocus(buttons, fromId, dir) {
	const live = buttons.filter((b) => b.enabled);
	const from = buttons.find((b) => b.id === fromId);
	if (!from) { return live.length ? live[0].id : null; }
	const [axis, sign] = AXES[dir];
	const at = middle(from);
	const others = live.filter((b) => b !== from).map(function (b) {
		const c = middle(b);
		return { id: b.id, along: (c[axis] - at[axis]) * sign, across: Math.abs(c[1 - axis] - at[1 - axis]) };
	});
	const ahead = others.filter((o) => o.along > 0);
	if (ahead.length) { return ahead.reduce((best, o) => (o.along + 2 * o.across < best.along + 2 * best.across ? o : best)).id; }
	const behind = others.filter((o) => o.along < 0);
	if (behind.length) { return behind.reduce((best, o) => (o.along < best.along || (o.along === best.along && o.across < best.across) ? o : best)).id; } // WRAP
	return fromId;
}

/**
 * @description What a key does on the zoomed monitor
 * @param  {[string]} key [KeyboardEvent.key]
 * @param  {[boolean]} tv [whether the room is in TV mode, the only time the arrows are the monitor's]
 * @return {[string|null]} up, down, left, right, press, leave or null
 */
export function keyAction(key, tv) {
	if (typeof key !== "string") { return null; }
	if (KEYS[key.toLowerCase()] && key.length === 1) { return KEYS[key.toLowerCase()]; }
	if (ARROWS[key]) { return tv ? ARROWS[key] : null; } // OFF TV MODE THE ARROWS ARE THE BOARD'S
	if (key === "Enter" || key === " ") { return "press"; }
	if (key === "Escape") { return "leave"; }
	return null;
}

/**
 * @description What the screen reader says for a button
 * @param  {[object]} button
 * @param  {[object[]]} buttons [the tab row & the channel's buttons it is among]
 * @return {[string]} e.g. "Takeback, button, 2 of 4" or "Moves, tab, 3 of 6, selected", with ", unavailable" when disabled
 */
export function describe(button, buttons) {
	const isTab = button.id.startsWith("tab:");
	let text;
	if (button.id === "back") { text = "Back, button"; }
	else if (isTab) {
		const tabs = buttons.filter((b) => b.id.startsWith("tab:"));
		text = `${NAMES[button.id.slice(4)]}, tab, ${tabs.findIndex((b) => b.id === button.id) + 1} of ${tabs.length}`;
		if (button.selected) { text += ", selected"; }
	} else {
		const own = buttons.filter((b) => b.id !== "back" && !b.id.startsWith("tab:"));
		text = `${sentence(button.label)}, button, ${own.findIndex((b) => b.id === button.id) + 1} of ${own.length}`;
	}
	return button.enabled ? text : `${text}, unavailable`;
}

/* ---------------------------------------------------------------- */
// Monitor
/* ---------------------------------------------------------------- */

/**
 * @description Makes the monitor's state machine
 * @param  {[object]} deps [show() when view() changed, announce(text) for the screen reader (the channel, what it shows, the focused button & the banner), handlers (hint, takeback, draw, restart, pgn, watchEval(on)),
 *                          loadPrefs() & savePrefs(prefs) (prefs.js's by default), reduce() whether motion is reduced]
 * @return {[object]} monitor: state, channel, focus, handlers, update, enter, arrived, leave, left, reset, pointer, key, view
 */
export function createMonitor(deps) {
	const reduce = deps.reduce || (() => false);
	const outside = deps.handlers || {};
	const save = deps.savePrefs || saveStored;
	let prefs = (deps.loadPrefs || loadStored)();
	let data = null;
	let uis = {}; // EACH CHANNEL'S OWN STATE, CLEARED BACK ON THE DESK
	let burst = false;
	let yourMove = false; // THE YOUR MOVE BANNER IS UP
	let endedZooming = false; // THE GAME ENDED DURING THE ZOOM-IN, arrived() SHOWS IT
	let watching = false;
	let spokenBanner = null;
	let spokenChannel = null, spokenContent = null; // WHAT THE SCREEN READER WAS LAST TOLD THE SHOWING CHANNEL SHOWS

	const monitor = { state: "idle", channel: null, focus: null, hover: null };

	// THE DATA A CHANNEL SEES
	function channelData() {
		return { ...data, prefs, ui: uis[monitor.channel] || {}, zoomed: monitor.state === "zoomed" };
	}

	// THE TAB ROW & THE CHANNEL'S BUTTONS, EMPTY UNLESS ZOOMED
	function rows() {
		if (monitor.state !== "zoomed" || !data) { return { tabs: [], buttons: [] }; }
		return { tabs: tabButtons(available(data, prefs), monitor.channel), buttons: CHANNEL[monitor.channel].buttons(channelData()) };
	}

	// SAYS WHAT THE FOCUSED BUTTON IS
	function sayFocus() {
		const { tabs, buttons } = rows();
		const all = [...tabs, ...buttons];
		const button = all.find((b) => b.id === monitor.focus);
		if (button) { deps.announce(describe(button, all)); }
	}

	// THE ONLY BANNER ACROSS THE ZOOMED SCREEN: YOUR MOVE. A FINISHED GAME HAS NONE, THE ACTIONS CHANNEL SHOWS THE RESULT
	function banner() {
		if (monitor.state !== "zoomed" || !data || data.over) { return null; }
		return yourMove ? YOUR_MOVE : null;
	}

	// WHAT THE SHOWING CHANNEL SAYS IT SHOWS, "" WHEN IT SAYS NOTHING
	function speech() {
		const channel = CHANNEL[monitor.channel];
		return typeof channel.speak === "function" ? channel.speak(channelData()) : "";
	}

	// SAYS THE SHOWING CHANNEL'S NAME & WHAT IT SHOWS
	function sayChannel() {
		spokenChannel = monitor.channel;
		spokenContent = speech();
		deps.announce(spokenContent ? `${NAMES[monitor.channel]} channel. ${spokenContent}` : `${NAMES[monitor.channel]} channel`);
	}

	// SHOWS A CHANNEL WHILE ZOOMED, WITH FOCUS ON ITS TAB (OR ITS FIRST ENABLED BUTTON)
	function switchTo(id, intoButtons = false) {
		if (id === monitor.channel) { return; }
		monitor.channel = id;
		if (id === "actions") { uis.actions = { ...uis.actions, slots: slots(undefined, data.actions, data.over), confirm: null }; } // FRESH SLOTS ON ENTERING
		if (monitor.state === "zoomed") {
			const first = intoButtons ? rows().buttons.find((b) => b.enabled) : null;
			monitor.focus = first ? first.id : `tab:${id}`;
			burst = !reduce();
			sayChannel();
			sayFocus();
		}
	}

	// THE GAME ENDED WHILE ZOOMED: OVER TO THE ACTIONS CHANNEL (THE RESULT, RESTART & DOWNLOAD PGN) WITH FOCUS ON ITS FIRST BUTTON, ELSE JUST SAY THE RESULT
	function ended() {
		if (!available(data, prefs).includes("actions")) {
			if (data.result) { deps.announce(sentence(data.result)); }
			return;
		}
		if (monitor.channel !== "actions") { switchTo("actions", true); return; }
		const first = rows().buttons.find((b) => b.enabled); // ALREADY ON IT: THE RESULT IS NEW CONTENT, sync() SAYS IT
		if (first && first.id !== monitor.focus) {
			monitor.focus = first.id;
			sayFocus();
		}
	}

	// KEEPS EVERYTHING CONSISTENT AFTER A CHANGE, THEN REDRAWS
	function sync() {
		if (data) {
			if (monitor.state === "idle") { monitor.channel = idleChannel(data, prefs); }
			else if (!available(data, prefs).includes(monitor.channel)) { switchTo("setup"); } // THE SHOWING CHANNEL WENT AWAY
			if (monitor.state !== "idle" && monitor.channel === "actions") {
				const ui = uis.actions || {};
				const draw = data.actions.find((a) => a.id === "draw");
				uis.actions = { ...ui, slots: slots(ui.slots, data.actions, data.over), confirm: draw && draw.enabled ? ui.confirm : null }; // A GONE DRAW CANCELS ITS PROMPT
			}
			if (monitor.state === "zoomed") {
				const said = speech();
				if (monitor.channel === spokenChannel && said !== spokenContent) { // WHAT IT SHOWS CHANGED (A NEW MOVE, A NEW SCORE): ONE LINE
					spokenContent = said;
					if (said) { deps.announce(said); }
				}
				const { tabs, buttons } = rows();
				if (![...tabs, ...buttons].some((b) => b.id === monitor.focus)) { // THE FOCUSED BUTTON WENT AWAY
					const first = buttons.find((b) => b.enabled);
					monitor.focus = first ? first.id : `tab:${monitor.channel}`;
					sayFocus();
				}
			}
		}
		const on = monitor.channel === "eval";
		if (on !== watching) {
			watching = on;
			if (typeof outside.watchEval === "function") { outside.watchEval(on); }
		}
		const text = banner();
		if (text !== spokenBanner) {
			spokenBanner = text;
			if (text) { deps.announce(text === YOUR_MOVE ? "Your move" : text); }
		}
		deps.show();
	}

	// STRAIGHT BACK TO THE DESK
	function toIdle() {
		monitor.state = "idle";
		monitor.focus = null;
		monitor.hover = null;
		uis = {};
		burst = false;
		yourMove = false;
		endedZooming = false; // A ZOOM-IN THAT TURNED BACK: THE NEXT ONE FINDS THE GAME ALREADY OVER
		spokenChannel = spokenContent = null;
		sync();
	}

	// ON THE DESK THE HOVER IS THE CENTRE OF THE POINTER'S THIRD OF THE GRID: THE FACE'S EYES ONLY LOOK BY THIRDS, SO A MOVE INSIDE ONE NEEDS NO REDRAW
	function deskHover(x) {
		const third = Math.min(2, Math.max(0, Math.floor((x * 3) / W)));
		const at = { x: Math.round((W * (third * 2 + 1)) / 6), y: H / 2 };
		const was = monitor.hover;
		if (was && was.x === at.x && was.y === at.y) { return; }
		monitor.hover = at;
		deps.show();
	}

	// PRESSES A BUTTON BY ID
	function press(id) {
		if (id === "back") { monitor.leave(); return; }
		if (id.startsWith("tab:")) { handlers.tab(id.slice(4)); return; }
		CHANNEL[monitor.channel].press(id, handlers, channelData());
		sync();
	}

	const handlers = {
		...outside,
		ui(patch) {
			uis[monitor.channel] = { ...uis[monitor.channel], ...patch };
			sync();
		},
		prefs(patch) {
			prefs = clean({ ...prefs, ...patch });
			save(prefs);
			sync();
		},
		back() { monitor.leave(); },
		tab(id) {
			if (!data || monitor.state === "idle" || !available(data, prefs).includes(id)) { return; }
			switchTo(id);
			sync();
		},
	};

	return Object.assign(monitor, {
		handlers,

		/**
		 * @description Takes new game data
		 * @param  {[object]} next [the data, see common shapes]
		 */
		update(next) {
			const was = data ? data.yourTurn : false;
			const end = Boolean(data && !data.over && next.over); // ONLY FROM THE UPDATE WHERE IT ENDS
			data = next;
			if (monitor.state === "zoomed") {
				if (!next.yourTurn) { yourMove = false; }
				else if (!was) { yourMove = true; } // ONLY FROM THE UPDATE WHERE IT TURNS TRUE
				if (end) { ended(); }
			} else if (monitor.state === "zooming" && end) { endedZooming = true; } // NOTHING TO SWITCH YET, THE CAMERA IS ON ITS WAY
			sync();
		},

		/**
		 * @description Starts zooming in from the desk
		 */
		enter() {
			if (monitor.state !== "idle" || !data) { return; }
			monitor.state = "zooming";
			if (reduce()) { monitor.arrived(); return; }
			sync();
		},

		/**
		 * @description The camera reached the glass
		 */
		arrived() {
			if (monitor.state !== "zooming") { return; }
			monitor.state = "zoomed";
			monitor.focus = `tab:${monitor.channel}`;
			sayChannel();
			sync();
			sayFocus();
			if (endedZooming) { // THE SAME AS ENDING WHILE ZOOMED: THE RESULT, RESTART & DOWNLOAD PGN
				endedZooming = false;
				ended();
				sync();
			}
		},

		/**
		 * @description Starts going back to the desk; harmless when already leaving or idle
		 */
		leave() {
			if (monitor.state !== "zoomed" && monitor.state !== "zooming") { return; }
			if (reduce()) { toIdle(); return; }
			monitor.state = "leaving";
			monitor.focus = null;
			monitor.hover = null;
			yourMove = false;
			sync();
		},

		/**
		 * @description The camera is back at the desk
		 */
		left() {
			if (monitor.state === "leaving") { toIdle(); }
		},

		/**
		 * @description Straight to idle, e.g. when the GL context is lost
		 */
		reset() { toIdle(); },

		/**
		 * @description A pointer on the glass
		 * @param  {[string]} kind [move, press or out]
		 * @param  {[number]} x [grid pixels]
		 * @param  {[number]} y
		 * @return {[string|null]} zoom when ../index.js should zoom in (it calls enter()), leave when BACK was pressed (leave() already ran), else null
		 */
		pointer(kind, x, y) {
			if (kind === "out") {
				if (monitor.hover !== null) { monitor.hover = null; deps.show(); }
				return null;
			}
			if (monitor.state === "idle") {
				if (kind === "move") { deskHover(x); }
				return kind === "press" && data ? "zoom" : null;
			}
			if (monitor.state !== "zoomed") { return null; }
			const { tabs, buttons } = rows();
			const button = hit([...tabs, ...buttons], x, y); // TABS FIRST
			if (kind === "move") {
				const id = button ? button.id : null;
				if (id !== monitor.hover) { monitor.hover = id; deps.show(); }
				return null;
			}
			if (kind !== "press" || !button) { return null; }
			press(button.id);
			return button.id === "back" ? "leave" : null;
		},

		/**
		 * @description A key while zoomed, or Escape while zooming in
		 * @param  {[string]} key [KeyboardEvent.key]
		 * @return {[boolean]} whether the monitor used it
		 */
		key(key) {
			if (!data || (monitor.state !== "zoomed" && monitor.state !== "zooming")) { return false; }
			const action = keyAction(key, data.tv);
			if (!action) { return false; }
			if (action === "leave") { monitor.leave(); return true; }
			if (monitor.state !== "zoomed") { return false; } // ZOOMING IN: ONLY ESCAPE
			const { tabs, buttons } = rows();
			if (action === "press") {
				const button = [...tabs, ...buttons].find((b) => b.id === monitor.focus);
				if (button && button.enabled) { press(button.id); }
				return true;
			}
			const onTabs = tabs.some((b) => b.id === monitor.focus);
			const channel = CHANNEL[monitor.channel];
			if (!onTabs && typeof channel.keys === "function" && channel.keys(action, channelData(), handlers)) { return true; } // THE CHANNEL'S OWN USE (THE MOVES' W & S SCROLL)
			let to;
			if (action === "left" || action === "right") {
				to = nextFocus(onTabs ? tabs : buttons, monitor.focus, action);
				if (onTabs && to && to.startsWith("tab:") && to !== `tab:${monitor.channel}`) { handlers.tab(to.slice(4)); return true; } // A/D CHANGE TAB AT ONCE; THE SHOWING TAB IS ONLY FOCUSED BELOW
			} else {
				to = nextFocus([...tabs, ...buttons], monitor.focus, action);
				if (!onTabs && tabs.some((b) => b.id === to)) { to = `tab:${monitor.channel}`; } // UP FROM THE BUTTONS LANDS ON THE SHOWING TAB
			}
			if (to && to !== monitor.focus) {
				monitor.focus = to;
				sayFocus();
				deps.show();
			}
			return true;
		},

		/**
		 * @description What screen.js draws
		 * @return {[object]} { channel, zoomed, tabs, buttons, focus, hover, banner, burst (true once after a switch), data }
		 */
		view() {
			const { tabs, buttons } = rows();
			const once = burst;
			burst = false;
			return { channel: monitor.channel, zoomed: monitor.state === "zoomed", tabs, buttons, focus: monitor.focus, hover: monitor.hover, banner: banner(), burst: once, data: data ? channelData() : null };
		},
	});
}

export { ORDER, YOUR_MOVE };
