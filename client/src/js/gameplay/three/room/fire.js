/*
 *  fire.js  --  chess frontend
 *	3D Library Fire
 *	The fireplace's fire: its flames (& the mantel's candle flames) sway, embers rise from it & its light on the room flickers.
 *	The flames are the "fire" mesh in library-room.glb, whose UVs say which flame a vertex is in & how far up it (build_library.py's
 *	flame()). The light is room.js's: it adds the fire's own baked light map times the glow set here.
 *	The scene only draws on demand, so a timer asks for FPS frames a second while the fire is up. Nothing while the tab is hidden or
 *	the context is lost (pauseFire), & a still fire with reduced motion. Phones have no room, so no fire
 *
 */

import { ShaderMaterial, AdditiveBlending, BufferGeometry, BufferAttribute, Points, Box3, Vector3 } from "three";

const FPS = 30; // THE FIRE'S FRAMES A SECOND. A MOVE OR THE CAMERA STILL DRAWS EVERY FRAME
const LOOP_S = 60; // THE SHADERS' TIME WRAPS HERE (A FLOAT LOSES ITS PRECISION OVER A LONG GAME). EVERY SPEED IN THEM IS A WHOLE NUMBER OF TURNS PER LOOP, SO IT DOESN'T SHOW
const EMBERS = 40;
const EMBER_RISE = 26; // UNITS AN EMBER CLIMBS BEFORE IT'S OUT, STILL INSIDE THE FIREBOX
const EMBER_SIZE = 0.6; // UNITS ACROSS, NEVER UNDER 2 PIXELS: THE FIREPLACE IS ACROSS THE ROOM FROM THE BOARD
const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");

let fire = null; // EVERYTHING ONE createFire() MADE, null WHEN THERE'S NO FIRE

/* ---------------------------------------------------------------- */
// Shaders
/* ---------------------------------------------------------------- */

// uv.x = 4 * THE FLAME'S NUMBER + ITS KIND (0 A FLAME, 1 ITS BRIGHT CORE, 2 A CANDLE'S), uv.y = 1 AT ITS BASE & 0 AT ITS TIP (glTF's V RUNS DOWN).
// THE TIP SWAYS MOST & THE BASE STAYS PUT, THE WAVES TRAVEL UP IT
const FLAME_VERTEX = /* glsl */`
uniform float time;
varying float vHeight;
varying float vKind;
const float W = 6.2831853 / ${LOOP_S.toFixed(1)};
void main() {
	float id = floor(uv.x / 4.0 + 0.125);
	float kind = floor(uv.x - 4.0 * id + 0.5);
	float h = clamp(1.0 - uv.y, 0.0, 1.0);
	float size = kind > 1.5 ? 0.09 : (kind > 0.5 ? 0.7 : 1.0);
	float phase = id * 2.399;
	float sway = size * h * h;
	vec3 p = position;
	p.x += sway * (1.1 * sin(W * 58.0 * time + phase - h * 3.0) + 0.6 * sin(W * 108.0 * time + phase * 1.7 - h * 5.0));
	p.z += sway * (1.1 * sin(W * 51.0 * time + phase * 2.1 - h * 2.6) + 0.6 * sin(W * 93.0 * time + phase * 0.6 - h * 4.4));
	p.y += size * h * (1.5 * sin(W * 41.0 * time + phase) + 0.8 * sin(W * 125.0 * time + phase * 3.0));
	vHeight = h;
	vKind = kind;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

// ADDED TO WHAT'S BEHIND: DEEP ORANGE AT THE TIPS, YELLOW AT THE BASE, THE CORES NEAR WHITE. glow IS THE SAME FLICKER THE ROOM'S LIGHT GETS
const FLAME_FRAGMENT = /* glsl */`
uniform float glow;
varying float vHeight;
varying float vKind;
void main() {
	vec3 colour = mix(vec3(1.0, 0.5, 0.1), vec3(0.85, 0.1, 0.015), smoothstep(0.1, 1.0, vHeight));
	if (vKind > 1.5) { colour = mix(vec3(1.0, 0.85, 0.5), vec3(1.0, 0.45, 0.1), vHeight); }
	else if (vKind > 0.5) { colour = mix(vec3(1.0, 0.9, 0.55), vec3(1.0, 0.55, 0.12), vHeight); }
	float alpha = 1.0 - smoothstep(0.5, 1.0, vHeight);
	gl_FragColor = vec4(colour * glow, alpha);
	#include <colorspace_fragment>
}`;

// AN EMBER'S WHOLE PATH COMES FROM ITS 4 RANDOM NUMBERS & THE TIME: IT LEAVES THE FLAMES, CLIMBS, DRIFTS & GOES OUT, THEN STARTS AGAIN SOMEWHERE ELSE
const EMBER_VERTEX = /* glsl */`
attribute vec4 seed;
uniform float time;
uniform float height;
uniform vec3 origin;
uniform vec3 spread;
varying float vAlpha;
const float W = 6.2831853 / ${LOOP_S.toFixed(1)};
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
	float turns = 11.0 + floor(seed.x * 12.0);
	float age = time * turns / ${LOOP_S.toFixed(1)} + seed.y;
	float life = fract(age);
	float trip = mod(floor(age), turns) + seed.z * 31.0;
	vec3 p = origin + vec3((hash(trip) - 0.5) * 2.0 * spread.x, life * ${EMBER_RISE.toFixed(1)} * (0.55 + 0.45 * hash(trip + 7.0)), (hash(trip + 3.0) - 0.5) * 2.0 * spread.z);
	p.x += 1.3 * life * sin(W * 19.0 * time + seed.w * 40.0);
	p.z += 1.3 * life * sin(W * 16.0 * time + seed.z * 40.0);
	vAlpha = smoothstep(0.0, 0.08, life) * pow(1.0 - life, 1.5) * (0.6 + 0.4 * sin(W * 170.0 * time + seed.w * 60.0));
	vec4 mv = modelViewMatrix * vec4(p, 1.0);
	gl_PointSize = max(2.0, ${EMBER_SIZE.toFixed(2)} * (0.6 + 0.8 * seed.w) * projectionMatrix[1][1] * 0.5 * height / -mv.z);
	gl_Position = projectionMatrix * mv;
}`;

const EMBER_FRAGMENT = /* glsl */`
uniform float glow;
varying float vAlpha;
void main() {
	float d = length(gl_PointCoord - 0.5);
	gl_FragColor = vec4(vec3(1.0, 0.5, 0.12) * glow, vAlpha * (1.0 - smoothstep(0.15, 0.5, d)));
	#include <colorspace_fragment>
}`;

/* ---------------------------------------------------------------- */
// Fire
/* ---------------------------------------------------------------- */

// THE EMBERS: POINTS THAT START AMONG THE FIREPLACE'S FLAMES (THE "fire" MESH'S KIND 0 VERTICES, NOT THE CANDLES ON THE MANTEL)
function makeEmbers(mesh, uniforms) {
	const { position, uv } = mesh.geometry.attributes;
	const box = new Box3(), point = new Vector3();
	for (let i = 0; i < position.count; i++) {
		if (Math.round(uv.getX(i)) % 4 === 0) { box.expandByPoint(point.fromBufferAttribute(position, i)); }
	}
	if (box.isEmpty()) { return null; }
	const size = box.getSize(new Vector3());
	const seeds = new Float32Array(EMBERS * 4).map(() => Math.random());
	const geometry = new BufferGeometry();
	geometry.setAttribute("position", new BufferAttribute(new Float32Array(EMBERS * 3), 3)); // UNUSED: THE SHADER PLACES THEM, THIS ONLY SAYS HOW MANY
	geometry.setAttribute("seed", new BufferAttribute(seeds, 4));
	const material = new ShaderMaterial({
		uniforms: { ...uniforms, height: { value: 1 }, origin: { value: new Vector3(box.min.x + size.x / 2, box.min.y + size.y * 0.3, box.min.z + size.z / 2) }, spread: { value: new Vector3(size.x * 0.35, 0, size.z * 0.4) } },
		vertexShader: EMBER_VERTEX, fragmentShader: EMBER_FRAGMENT, blending: AdditiveBlending, transparent: true, depthWrite: false,
	});
	const points = new Points(geometry, material);
	points.frustumCulled = false; // ITS POSITIONS ARE THE SHADER'S, THE GEOMETRY HAS NO BOUNDS TO CULL BY
	mesh.parent.add(points); // IN THE ROOM, SO IT TURNS WITH IT
	return points;
}

// THE FIRE'S BRIGHTNESS t SECONDS IN: AROUND 1 (WHAT THE ROOM WAS BAKED AT), A SLOW SWELL UNDER FASTER FLUTTERS
function glowAt(t) {
	return 1 + 0.07 * Math.sin(t * 2.9 + 0.7) + 0.1 * Math.sin(t * 7.3) + 0.07 * Math.sin(t * 12.7 + 1.3) + 0.05 * Math.sin(t * 21.1 + 4.1);
}

// THE TIMER THAT ASKS FOR THE FIRE'S FRAMES: ON ONLY WHILE IT CAN BE SEEN MOVING
function schedule() {
	clearInterval(fire.timer);
	fire.timer = null;
	if (fire.embers) { fire.embers.visible = !fire.reduce; }
	if (!fire.paused && !fire.reduce) { fire.timer = setInterval(fire.requestRender, 1000 / FPS); }
	fire.requestRender();
}

function onReduce() {
	fire.reduce = REDUCE.matches;
	schedule();
}

/**
 * @description Lights the fire: the flames get their moving material, the embers are added & the frames start
 * @param  {[object]} room [createRoom()'s fire: { mesh (the flames), glow (the uniform the room's firelight is multiplied by) }]
 * @param  {[function]} requestRender [asks the board for a frame, the scene only draws on demand]
 */
export function createFire({ mesh, glow }, requestRender) {
	disposeFire();
	const uniforms = { time: { value: 0 }, glow };
	mesh.material = new ShaderMaterial({ uniforms, vertexShader: FLAME_VERTEX, fragmentShader: FLAME_FRAGMENT, blending: AdditiveBlending, transparent: true, depthWrite: false });
	fire = { uniforms, requestRender, embers: null, started: null, timer: null, paused: false, reduce: REDUCE.matches };
	fire.embers = makeEmbers(mesh, uniforms);
	REDUCE.addEventListener("change", onReduce);
	schedule();
}

/**
 * @description Moves the fire on to this frame's time. Called before every draw, whatever asked for it
 * @param  {[number]} now [the frame's timestamp, ms]
 * @param  {[number]} height [the canvas's height in device pixels, the embers are sized by it]
 */
export function stepFire(now, height) {
	if (!fire) { return; }
	if (fire.started === null) { fire.started = now; }
	const t = fire.reduce ? 0 : (now - fire.started) / 1000; // REDUCED MOTION: A STILL FIRE AT ITS BAKED BRIGHTNESS
	fire.uniforms.time.value = t % LOOP_S;
	fire.uniforms.glow.value = glowAt(t);
	if (fire.embers) { fire.embers.material.uniforms.height.value = height; }
}

/**
 * @description Stops the fire's frames (the tab is hidden or the WebGL context is lost) or starts them again
 * @param  {[boolean]} paused
 */
export function pauseFire(paused) {
	if (!fire || fire.paused === paused) { return; }
	fire.paused = paused;
	schedule();
}

/**
 * @description Stops the fire's timer & forgets it. Its meshes & materials are freed with the scene (three/index.js unmount)
 */
export function disposeFire() {
	if (!fire) { return; }
	clearInterval(fire.timer);
	REDUCE.removeEventListener("change", onReduce);
	fire = null;
}
