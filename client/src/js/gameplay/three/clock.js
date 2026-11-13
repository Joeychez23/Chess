/*
 *  clock.js  --  chess frontend
 *	3D Library Clock
 *	The longcase clock on the room's south wall tells the viewer's local time like a real one: no second hand, the hour & minute hands
 *	step on each tick, once a second, & the pendulum swings, reaching the end of its swing on each tick. They're the "clockHour",
 *	"clockMinute" & "clockPendulum" meshes in library-room.glb, the hands built pointing at 12 & pivoted on the dial's centre, the pendulum
 *	hanging straight down from its pivot (build_library.py), so turning one about its own z turns it. All of it is read from Date on every
 *	draw, so the clock is right again the moment a hidden tab comes back.
 *	The scene only draws on demand, so a timer asks for FPS frames a second while the pendulum swings. With reduced motion the pendulum
 *	hangs still & the timer asks once a second, for the tick. Nothing while the tab is hidden or the context is lost (pauseClock). Phones
 *	have no room, so no clock
 *
 */

import { MeshBasicMaterial } from "three";

const PARTS = { hour: "clockHour", minute: "clockMinute", pendulum: "clockPendulum" }; // THEIR NAMES IN library-room.glb
const HAND_COLOUR = 0x100e0b; // NEAR BLACK, LIKE THE BAKED DIAL'S OLD HANDS. NONE OF THE PARTS IS IN THE LIGHT MAP: THEY MOVE, SO THEY'D LEAVE THEIR SHADOW BEHIND
const BRASS_COLOUR = 0x5c3f14; // THE PENDULUM: THE BAKED BRASS BEZEL'S COLOUR IN THE ROOM'S LIGHT
const SWING = 3 * Math.PI / 180; // EACH WAY. ITS BOB STAYS INSIDE THE TRUNK'S WINDOW
const FPS = 30; // THE SWING'S FRAMES A SECOND, LIKE THE FIRE'S
const TURN = Math.PI * 2;
const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");

let clock = null; // EVERYTHING ONE createClock() MADE, null WHEN THERE'S NO CLOCK

/**
 * @description Finds the clock's moving parts in the room
 * @param  {[Object3D]} group [the room, from createRoom]
 * @return {[object]} [{ hour, minute, pendulum } meshes, or null when the room has no clock (a phone's, or an older library-room.glb)]
 */
export function findClock(group) {
	const parts = {};
	for (const [key, name] of Object.entries(PARTS)) {
		parts[key] = group.getObjectByName(name);
		if (!parts[key]) { return null; }
	}
	return parts;
}

// THE MOVING PARTS' NAMES, FOR room.js: THEY GET THIS FILE'S MATERIALS, NOT A DETAIL TEXTURE & LIGHT MAP
export const CLOCK_NAMES = Object.values(PARTS);

/* ---------------------------------------------------------------- */
// Clock
/* ---------------------------------------------------------------- */

// THE TIMER THAT ASKS FOR THE CLOCK'S FRAMES: ON ONLY WHILE IT CAN BE SEEN MOVING. A TICK WAITS FOR THE NEXT WHOLE SECOND, SO IT LANDS ON IT
function schedule() {
	clearInterval(clock.timer);
	clearTimeout(clock.timer);
	clock.timer = null;
	if (!clock.paused) {
		if (clock.reduce) { clock.timer = setTimeout(tick, 1000 - (Date.now() % 1000)); }
		else { clock.timer = setInterval(clock.requestRender, 1000 / FPS); }
	}
	clock.requestRender();
}

function tick() {
	clock.requestRender();
	schedule();
}

function onReduce() {
	clock.reduce = REDUCE.matches;
	schedule();
}

/**
 * @description Starts the clock: its parts get their materials & the frames start
 * @param  {[object]} parts [findClock()'s { hour, minute, pendulum }]
 * @param  {[function]} requestRender [asks the board for a frame, the scene only draws on demand]
 */
export function createClock(parts, requestRender) {
	disposeClock();
	parts.hour.material = parts.minute.material = new MeshBasicMaterial({ color: HAND_COLOUR });
	parts.pendulum.material = new MeshBasicMaterial({ color: BRASS_COLOUR });
	clock = { parts, requestRender, timer: null, paused: false, reduce: REDUCE.matches };
	REDUCE.addEventListener("change", onReduce);
	schedule();
}

/**
 * @description Turns the hands & the pendulum to the time now. Called before every draw, whatever asked for it
 */
export function stepClock() {
	if (!clock) { return; }
	const now = new Date();
	const minutes = now.getMinutes() + now.getSeconds() / 60; // WHOLE SECONDS: THE HANDS STEP ON THE TICK
	const hours = (now.getHours() % 12) + minutes / 60;
	const { hour, minute, pendulum } = clock.parts;
	hour.rotation.z = TURN * hours / 12; // THE DIAL FACES THE ROOM'S -z, SO +z TURNS A HAND CLOCKWISE AS IT'S SEEN
	minute.rotation.z = TURN * minutes / 60;
	pendulum.rotation.z = clock.reduce ? 0 : SWING * Math.cos(Math.PI * (now.getTime() % 2000) / 1000); // A 2 SECOND SWING, AT ONE END OR THE OTHER ON EACH WHOLE SECOND. REDUCED MOTION: STILL
}

/**
 * @description Stops the clock's frames (the tab is hidden or the WebGL context is lost) or starts them again
 * @param  {[boolean]} paused
 */
export function pauseClock(paused) {
	if (!clock || clock.paused === paused) { return; }
	clock.paused = paused;
	schedule();
}

/**
 * @description Stops the clock's timer & forgets it. Its meshes & material are freed with the scene (three/index.js unmount)
 */
export function disposeClock() {
	if (!clock) { return; }
	clearInterval(clock.timer);
	clearTimeout(clock.timer);
	REDUCE.removeEventListener("change", onReduce);
	clock = null;
}
