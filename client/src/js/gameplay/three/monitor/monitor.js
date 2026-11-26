/*
 *  monitor.js  --  chess frontend
 *	The CRT Monitor's State Machine
 *	The monitor as the game's menu: idle on the desk, zooming in, zoomed (the tab row & the channel's buttons) & leaving.
 *	It is fed pointer hits in grid pixels & keys by ../index.js, & screen.js draws its view().
 *	The pure helpers (tab row, hit testing, focus, keys, zoom maths, screen reader text) are in controls.js.
 *	No DOM & no three.js here, so the tests load it in Node (client/test/monitor.test.js)
 *
 */

import { W, H, NAMES, sentence } from "./kit.js";
import { CHANNEL } from "./channels/index.js";
import { slots } from "./channels/actions.js";
import { clean, loadPrefs as loadStored, savePrefs as saveStored } from "./prefs.js";
import { tabButtons, available, describe, YOUR_MOVE, idleChannel, hit, keyAction, nextFocus } from "./controls.js";
export {
	ORDER, YOUR_MOVE, uvToGrid, zoomDistance, isTap, available, idleChannel, tabButtons, litTab, hit, nextFocus, keyAction, describe
} from "./controls.js";

/* ---------------------------------------------------------------- */
// Monitor
/* ---------------------------------------------------------------- */

/**
 * @description Makes the monitor's state machine
 * @param  {[object]} deps [show() when view() changed, announce(text) for the screen reader (the channel, what it shows,
 *                          the focused button & the banner), handlers (hint, takeback, draw, restart, pgn, watchEval(on)),
 *                          loadPrefs() & savePrefs(prefs) (prefs.js's by default), reduce() whether motion is reduced]
 * @return {[object]} monitor: state, channel, focus, handlers, update, enter, arrived, leave, left, reset, pointer, deskFocus, key, view
 */
export function createMonitor(deps) {
	const reduce = deps.reduce || (() => false);
	const outside = deps.handlers || {};
	const save = deps.savePrefs || saveStored;
	let prefs = (deps.loadPrefs || loadStored)();
	let data = null;
	// Each channel's own state, cleared when the monitor is back on the desk.
	let uis = {};
	let burst = false;
	// The "your move" banner is up.
	let yourMove = false;
	// The game ended during the zoom-in; arrived() shows it.
	let endedZooming = false;
	// The connection was lost during the zoom-in; arrived() shows the opponent channel.
	let offlineZooming = false;
	let watching = false;
	let spokenBanner = null;
	// What the screen reader was last told the showing channel shows.
	let spokenChannel = null, spokenContent = null;
	// The keyboard's focus is on the screen (deskFocus). The page's focus owns this, so it outlives a zoom and a reset.
	let keyFocus = false;

	const monitor = { state: "idle", channel: null, focus: null, hover: null };

	// The data a channel sees.
	function channelData() {
		return { ...data, prefs, ui: uis[monitor.channel] || {}, zoomed: monitor.state === "zoomed" };
	}

	// The tab row and the channel's buttons, empty unless zoomed.
	function rows() {
		if (monitor.state !== "zoomed" || !data) { return { tabs: [], buttons: [] }; }
		return {
			tabs: tabButtons(available(data, prefs), monitor.channel),
			buttons: CHANNEL[monitor.channel].buttons(channelData())
		};
	}

	// Tells the screen reader which button has the focus.
	function sayFocus() {
		const { tabs, buttons } = rows();
		const all = [...tabs, ...buttons];
		const button = all.find((b) => b.id === monitor.focus);
		if (button) { deps.announce(describe(button, all)); }
	}

	// The only banner across the zoomed screen is "your move". A finished game has none (the actions channel shows the result),
	// and there is none while the connection is lost.
	function banner() {
		if (monitor.state !== "zoomed" || !data || data.over || data.offline) { return null; }
		return yourMove ? YOUR_MOVE : null;
	}

	// What the showing channel says it shows, or "" when it says nothing.
	function speech() {
		const channel = CHANNEL[monitor.channel];
		return typeof channel.speak === "function" ? channel.speak(channelData()) : "";
	}

	// Tells the screen reader the showing channel's name and what it shows.
	function sayChannel() {
		spokenChannel = monitor.channel;
		spokenContent = speech();
		deps.announce(spokenContent ? `${NAMES[monitor.channel]} channel. ${spokenContent}` : `${NAMES[monitor.channel]} channel`);
	}

	// Shows a channel while zoomed, with the focus on its tab (or on its first enabled button).
	function switchTo(id, intoButtons = false) {
		if (id === monitor.channel) { return; }
		monitor.channel = id;
		// Fresh slots each time the actions channel is entered.
		if (id === "actions") { uis.actions = { ...uis.actions, slots: slots(undefined, data.actions, data.over), confirm: null }; }
		if (monitor.state === "zoomed") {
			const first = intoButtons ? rows().buttons.find((b) => b.enabled) : null;
			monitor.focus = first ? first.id : `tab:${id}`;
			burst = !reduce();
			sayChannel();
			sayFocus();
		}
	}

	// The game ended while zoomed: switch to the actions channel (the result, restart and download PGN) with the focus on its
	// first button. Without an actions channel, just say the result.
	function ended() {
		if (!available(data, prefs).includes("actions")) {
			if (data.result) { deps.announce(sentence(data.result)); }
			return;
		}
		if (monitor.channel !== "actions") { switchTo("actions", true); return; }
		// Already on it: the result is new content, and sync() says it.
		const first = rows().buttons.find((b) => b.enabled);
		if (first && first.id !== monitor.focus) {
			monitor.focus = first.id;
			sayFocus();
		}
	}

	// Keeps everything consistent after a change, then redraws.
	function sync() {
		if (data) {
			// On the desk with no default channel set, the monitor keeps the last tab. It takes the game's own default at the start,
			// or when that tab goes away.
			if (monitor.state === "idle") {
				const keep = !prefs.defaultChannel && !(data.offline && !data.over) && available(data, prefs).includes(monitor.channel);
				if (!keep) { monitor.channel = idleChannel(data, prefs); }
			}
			// The showing channel went away.
			else if (!available(data, prefs).includes(monitor.channel)) { switchTo("setup"); }
			if (monitor.state !== "idle" && monitor.channel === "actions") {
				const ui = uis.actions || {};
				const draw = data.actions.find((a) => a.id === "draw");
				// A draw offer that is no longer available cancels its confirmation prompt.
				uis.actions = { ...ui, slots: slots(ui.slots, data.actions, data.over), confirm: draw && draw.enabled ? ui.confirm : null };
			}
			if (monitor.state === "zoomed") {
				const said = speech();
				// What it shows changed (a new move, a new score): one line for the screen reader.
				if (monitor.channel === spokenChannel && said !== spokenContent) {
					spokenContent = said;
					if (said) { deps.announce(said); }
				}
				const { tabs, buttons } = rows();
				// The focused button went away.
				if (![...tabs, ...buttons].some((b) => b.id === monitor.focus)) {
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

	// Straight back to the desk.
	function toIdle() {
		monitor.state = "idle";
		monitor.focus = null;
		monitor.hover = null;
		uis = {};
		burst = false;
		yourMove = false;
		// A zoom-in that turned back: the next one finds the game already over.
		endedZooming = false;
		// The next zoom-in starts from the desk's opponent channel anyway.
		offlineZooming = false;
		spokenChannel = spokenContent = null;
		sync();
	}

	// On the desk, the hover is the centre of the third of the grid the pointer is in. The face's eyes only look by thirds,
	// so a move inside one third needs no redraw.
	function deskHover(x) {
		const third = Math.min(2, Math.max(0, Math.floor((x * 3) / W)));
		const at = { x: Math.round((W * (third * 2 + 1)) / 6), y: H / 2 };
		const was = monitor.hover;
		if (was && was.x === at.x && was.y === at.y) { return; }
		monitor.hover = at;
		deps.show();
	}

	// Presses a button by its id.
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
			// Only on the update where the game ends.
			const end = Boolean(data && !data.over && next.over);
			// Only on the update where the connection drops, so the player can change tabs after it.
			const lost = Boolean(next.offline && !next.over && !(data && data.offline));
			data = next;
			if (monitor.state === "zoomed") {
				if (!next.yourTurn) { yourMove = false; }
				// Only on the update where it becomes the player's turn.
				else if (!was) { yourMove = true; }
				if (end) { ended(); }
				if (lost) { switchTo("opponent"); }
			} else if (monitor.state === "zooming") {
				// Nothing to switch yet, the camera is on its way: arrived() acts on these.
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
			// Still zooming here, so switchTo() only changes the channel; the lines below announce it.
			if (offlineZooming) {
				offlineZooming = false;
				if (data.offline) { switchTo("opponent"); }
			}
			monitor.state = "zoomed";
			monitor.focus = `tab:${monitor.channel}`;
			sayChannel();
			sync();
			sayFocus();
			// The same as the game ending while zoomed: the result, restart and download PGN.
			if (endedZooming) {
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
		 * @return {[string|null]} zoom when ../index.js should zoom in (it calls enter()), leave when BACK was pressed
		 * (leave() already ran), else null
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
			// Tabs first.
			const button = hit([...tabs, ...buttons], x, y);
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
		 * @description The keyboard's focus came to the screen or left it (the page's stop for the monitor).
		 * On the desk the glass shows it, view().deskFocus
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
			// While zooming in, only Escape does anything.
			if (monitor.state !== "zoomed") { return false; }
			const { tabs, buttons } = rows();
			if (action === "press") {
				const button = [...tabs, ...buttons].find((b) => b.id === monitor.focus);
				if (button && button.enabled) { press(button.id); }
				return true;
			}
			const onTabs = tabs.some((b) => b.id === monitor.focus);
			const channel = CHANNEL[monitor.channel];
			// The channel may use the key itself (W and S scroll the moves channel).
			if (!onTabs && typeof channel.keys === "function" && channel.keys(action, channelData(), handlers)) { return true; }
			let to;
			if (action === "left" || action === "right") {
				to = nextFocus(onTabs ? tabs : buttons, monitor.focus, action);
				// A and D change the tab at once; landing on the showing tab only moves the focus (below).
				if (onTabs && to && to.startsWith("tab:") && to !== `tab:${monitor.channel}`) { handlers.tab(to.slice(4)); return true; }
			} else {
				to = nextFocus([...tabs, ...buttons], monitor.focus, action);
				// Up from the buttons lands on the showing tab, whichever tab was nearest.
				if (!onTabs && tabs.some((b) => b.id === to)) { to = `tab:${monitor.channel}`; }
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
		 * @return {[object]} { channel, zoomed, tabs, buttons, focus, hover, deskFocus (the keyboard's focus is on the screen, on the desk),
		 * banner, burst (true once after a switch), data }
		 */
		view() {
			const { tabs, buttons } = rows();
			const once = burst;
			burst = false;
			return {
				channel: monitor.channel,
				zoomed: monitor.state === "zoomed",
				tabs,
				buttons,
				focus: monitor.focus,
				hover: monitor.hover,
				deskFocus: keyFocus && monitor.state === "idle",
				banner: banner(),
				burst: once,
				data: data ? channelData() : null
			};
		},
	});
}
