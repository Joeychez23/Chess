/*
 *  monitor.js  --  chess frontend
 *	The CRT Monitor's State Machine
 *	The monitor as the game's menu: idle on the desk, zooming in, zoomed (the tab row & the channel's buttons) & leaving. It is fed pointer hits in grid pixels & keys by
 *	../index.js, & screen.js draws its view(). The pure helpers (tab row, hit testing, focus, keys, zoom maths, screen reader text) are in controls.js.
 *	No DOM & no three.js here, so the tests load it in Node (client/test/monitor.test.js)
 *
 */

import { W, H, NAMES, sentence } from "./kit.js";
import { CHANNEL } from "./channels/index.js";
import { slots } from "./channels/actions.js";
import { clean, loadPrefs as loadStored, savePrefs as saveStored } from "./prefs.js";
import { tabButtons, available, describe, YOUR_MOVE, idleChannel, hit, keyAction, nextFocus } from "./controls.js";
export { ORDER, YOUR_MOVE, uvToGrid, zoomDistance, isTap, available, idleChannel, tabButtons, litTab, hit, nextFocus, keyAction, describe } from "./controls.js";

/* ---------------------------------------------------------------- */
// Monitor
/* ---------------------------------------------------------------- */

/**
 * @description Makes the monitor's state machine
 * @param  {[object]} deps [show() when view() changed, announce(text) for the screen reader (the channel, what it shows, the focused button & the banner), handlers (hint, takeback, draw, restart, pgn, watchEval(on)),
 *                          loadPrefs() & savePrefs(prefs) (prefs.js's by default), reduce() whether motion is reduced]
 * @return {[object]} monitor: state, channel, focus, handlers, update, enter, arrived, leave, left, reset, pointer, deskFocus, key, view
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
	let offlineZooming = false; // THE CONNECTION WAS LOST DURING THE ZOOM-IN, arrived() SHOWS THE OPPONENT CHANNEL
	let watching = false;
	let spokenBanner = null;
	let spokenChannel = null, spokenContent = null; // WHAT THE SCREEN READER WAS LAST TOLD THE SHOWING CHANNEL SHOWS
	let keyFocus = false; // THE KEYBOARD'S FOCUS IS ON THE SCREEN (deskFocus). THE PAGE'S FOCUS OWNS IT, SO IT OUTLIVES A ZOOM & A RESET

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

	// THE ONLY BANNER ACROSS THE ZOOMED SCREEN: YOUR MOVE. A FINISHED GAME HAS NONE, THE ACTIONS CHANNEL SHOWS THE RESULT. NONE WHILE THE CONNECTION IS LOST
	function banner() {
		if (monitor.state !== "zoomed" || !data || data.over || data.offline) { return null; }
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
		offlineZooming = false; // THE NEXT ZOOM-IN STARTS FROM THE DESK'S OPPONENT CHANNEL ANYWAY
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
			const lost = Boolean(next.offline && !next.over && !(data && data.offline)); // ONLY FROM THE UPDATE WHERE IT DROPS: THE PLAYER CAN CHANGE TABS AFTER
			data = next;
			if (monitor.state === "zoomed") {
				if (!next.yourTurn) { yourMove = false; }
				else if (!was) { yourMove = true; } // ONLY FROM THE UPDATE WHERE IT TURNS TRUE
				if (end) { ended(); }
				if (lost) { switchTo("opponent"); }
			} else if (monitor.state === "zooming") { // NOTHING TO SWITCH YET, THE CAMERA IS ON ITS WAY
				if (end) { endedZooming = true; }
				if (lost) { offlineZooming = true; }
			}
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
			if (offlineZooming) { // STILL ZOOMING: switchTo() ONLY CHANGES THE CHANNEL, THE LINES BELOW SAY IT
				offlineZooming = false;
				if (data.offline) { switchTo("opponent"); }
			}
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
		 * @description The keyboard's focus came to the screen or left it (the page's stop for the monitor). On the desk the glass shows it, view().deskFocus
		 * @param  {[boolean]} on
		 */
		deskFocus(on) {
			if (keyFocus === Boolean(on)) { return; }
			keyFocus = Boolean(on);
			deps.show();
		},

		/**
		 * @description A key while zoomed, or Escape while zooming in
		 * @param  {[string]} key [KeyboardEvent.key]
		 * @return {[boolean]} whether the monitor used it
		 */
		key(key) {
			if (!data || (monitor.state !== "zoomed" && monitor.state !== "zooming")) { return false; }
			const action = keyAction(key);
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
		 * @return {[object]} { channel, zoomed, tabs, buttons, focus, hover, deskFocus (the keyboard's focus is on the screen, on the desk), banner, burst (true once after a switch), data }
		 */
		view() {
			const { tabs, buttons } = rows();
			const once = burst;
			burst = false;
			return { channel: monitor.channel, zoomed: monitor.state === "zoomed", tabs, buttons, focus: monitor.focus, hover: monitor.hover, deskFocus: keyFocus && monitor.state === "idle", banner: banner(), burst: once, data: data ? channelData() : null };
		},
	});
}
