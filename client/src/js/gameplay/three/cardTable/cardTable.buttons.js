/* ---- Chess Cards table: the brass plaque buttons (their sizes, brass and engraving, how they are laid, hovered, focused and
pressed) and the desk the camera shows (createCardTable, index.js) ---- */

import { CanvasTexture, SRGBColorSpace, MeshStandardMaterial, Mesh, Vector3, Plane, Ray, Matrix4, Shape, ExtrudeGeometry } from "three";
import { CARD_SIZE, CARD_Y, FONT } from "../cardLayout.js";
import { frameGeometry, LIFT_MS } from "./promotionCards.js";
import { DESK_Y } from "../constants.js";
import { buttonLayout, BOARD_RECT, DESK_AVOID, PLAQUE_TEXT, PLAQUE_LINE } from "./tableLayout.js";

// A plaque button: a low brass bar lying on the baize or the desk
const PLAQUE_H = 0.25;
// build_library.py: the baize (±21.2, its top at Z0 + 0.13) on its leather edge (±22, its top at Z0 + 0.1) on the desk (Z0, DESK_Y)
const BAIZE_BOUNDS = { edge: 21.2, top: CARD_Y - 0.02 };
const MAT_BOUNDS = { edge: 22, top: DESK_Y + 0.1 };
// deskInView: the screen's edges this far in (NDC). 0.98 (FIT_NDC) leaves 0.03 too little desk under the hand for two rows of
// two-line plaques in the pinned opening view
const VIEW_EDGE = 0.99;
// Where a screen corner's ray that never meets the desk (it looks past the horizon) is taken instead: this far along it
const HORIZON_REACH = 1e4;

// The highest surface under a plaque's footprint: the plaque lies on that
function restOn(p) {
	function reach(e) {
		return Math.abs(p.x) - p.w / 2 < e && Math.abs(p.z) - p.d / 2 < e;
	}
	return reach(BAIZE_BOUNDS.edge) ? BAIZE_BOUNDS.top : reach(MAT_BOUNDS.edge) ? MAT_BOUNDS.top : DESK_Y;
}

// A press sinks the plaque about its own height, and it rises again
const PLAQUE_SINK = PLAQUE_H * 0.8;
const PRESS_MS = 2 * LIFT_MS;
// The plaque top's texture, pixels per unit
const PLAQUE_PX = 64;
// Its edges: a real bevel all round, so they catch the room's light
const PLAQUE_BEVEL = { size: 0.08, thickness: 0.06 };
// Its brass. The red deck's frame is build_library.py's plastic:brass, baked (diffuse, roughness 0.85) into the room's light map,
// and reads #B18133 in the bake's game render (bake-out/library/game-opening.png). A plaque moves, so it can't be baked: it's lit
// by the scene's hemisphere and key light as the pieces are (three/index.js), which give a top face about 0.95, so this albedo
// reads about the same
export const BRASS_MATERIAL = { color: 0xB58638, roughness: 0.85, metalness: 0 };
// A hovered plaque's top: this much brighter brass (as a hovered hand card's face goes from CARD_LIGHT to HOVER_LIGHT)
const PLAQUE_HOVER = 1.35;
// The keyboard's frame round a plaque: thin, white-gold
export const PLAQUE_FOCUS = { color: 0xFFF3C4, gap: 0.12, width: 0.12 };

/**
 * @description The part of the desk the camera shows, for the plaques (tableLayout.js buttonLayout's within): where the screen's
 * corners, VIEW_EDGE in from its edges, meet the desk and the top of a plaque on the baize, in the room's space (unturned); on each,
 * the rectangle inside that footprint (a trapezoid, narrowest at the screen's bottom), and the part both share. A corner looking
 * past the horizon reaches far off: buttonLayout clips the rectangle to the desk.
 * shortcut: each axis takes the footprint's two middle corners, exact while the camera looks along the room's z (the opening view,
 * either side); orbited toward a corner, the rectangle can poke past the screen's sides near its corners, and then createCardTable's
 * screen check lays no plaques. Take the footprint's true inscribed rectangle if those prompts should keep plaques
 * @param {PerspectiveCamera} camera
 * @param {Object3D} room the table's parent (turned with the player's side)
 * @returns {{ x0: number, x1: number, z0: number, z1: number }}
 */
export function deskInView(camera, room) {
	camera.updateMatrixWorld();
	room.updateWorldMatrix(true, false);
	const toRoom = new Matrix4().copy(room.matrixWorld).invert();
	const ray = new Ray();
	const at = new Vector3();
	const inside = [DESK_Y, BAIZE_BOUNDS.top + PLAQUE_H].map((y) => {
		const plane = new Plane(new Vector3(0, 1, 0), -y).applyMatrix4(room.matrixWorld);
		const xs = [];
		const zs = [];
		for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
			ray.origin.setFromMatrixPosition(camera.matrixWorld);
			ray.direction.set(nx * VIEW_EDGE, ny * VIEW_EDGE, 0.5).unproject(camera).sub(ray.origin).normalize();
			if (!ray.intersectPlane(plane, at)) { ray.at(HORIZON_REACH, at); }
			at.applyMatrix4(toRoom);
			xs.push(at.x);
			zs.push(at.z);
		}
		xs.sort((a, b) => a - b);
		zs.sort((a, b) => a - b);
		return { x0: xs[1], x1: xs[2], z0: zs[1], z1: zs[2] };
	});
	return {
		x0: Math.max(...inside.map((r) => r.x0)),
		x1: Math.min(...inside.map((r) => r.x1)),
		z0: Math.max(...inside.map((r) => r.z0)),
		z1: Math.min(...inside.map((r) => r.z1))
	};
}

// The focus frame: on the surface round its plaque
const RING_Y = 0.01 - PLAQUE_H / 2;
function drawPlaque(canvas, lines) {
	const ctx = canvas.getContext("2d");
	const w = canvas.width;
	const h = canvas.height;
	// The map is multiplied by the brass: white is plain brass
	ctx.fillStyle = "#FFFFFF";
	ctx.fillRect(0, 0, w, h);
	// Every plaque's text is the same height: a long label takes two lines (buttonLayout)
	ctx.font = `bold ${Math.round(PLAQUE_TEXT * PLAQUE_PX)}px ${FONT}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	lines.forEach(function (line, i) {
		// Engraved: multiplied by the brass, a dark brown cut
		ctx.fillStyle = "#3C3C3C";
		ctx.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * PLAQUE_LINE * PLAQUE_PX);
	});
}

/**
 * @description The brass plaque buttons on the table: what createCardTable's table (index.js) gets from this part
 * @param {object} table createCardTable's shared fields
 * @returns {object} the part's functions
 */
export function buttonsPart(table) {
	// The ids and labels of the list laid, so a rebuild of the same list keeps its hover
	let buttonsLabels = "[]";
	// The hovered plaque's id (hoverButton), kept over a rebuild of the same list
	let hoveredButton = null;
	function makePlaque(p) {
		// Its flat top; the bevel reaches out to p.w x p.d
		const w = p.w - 2 * PLAQUE_BEVEL.size;
		const d = p.d - 2 * PLAQUE_BEVEL.size;
		const depth = PLAQUE_H - 2 * PLAQUE_BEVEL.thickness;
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(w * PLAQUE_PX);
		canvas.height = Math.round(d * PLAQUE_PX);
		drawPlaque(canvas, p.lines);
		const texture = new CanvasTexture(canvas);
		texture.colorSpace = SRGBColorSpace;
		// The top's UVs are the shape's x and y (ExtrudeGeometry), mapped onto 0 .. 1. flipY stays the default: the canvas's top lies
		// away from the player
		texture.repeat.set(1 / w, 1 / d);
		texture.offset.set(0.5, 0.5);
		const top = new MeshStandardMaterial({ ...BRASS_MATERIAL, map: texture });
		const shape = new Shape().moveTo(-w / 2, -d / 2).lineTo(w / 2, -d / 2).lineTo(w / 2, d / 2).lineTo(-w / 2, d / 2);
		// Lying flat, the shape's y away from the player
		const geometry = new ExtrudeGeometry(shape, {
			depth, bevelEnabled: true, bevelThickness: PLAQUE_BEVEL.thickness, bevelSize: PLAQUE_BEVEL.size, bevelSegments: 2
		}).translate(0, 0, -depth / 2).rotateX(-Math.PI / 2);
		// ExtrudeGeometry's groups: the top and bottom faces, then the sides and bevel
		const mesh = new Mesh(geometry, [top, table.plaqueBrass]);
		// Its centre
		const y = restOn(p) + PLAQUE_H / 2;
		mesh.position.set(p.x, y, p.z);
		mesh.userData.button = p.id;
		const ring = new Mesh(frameGeometry(p.w + PLAQUE_FOCUS.gap * 2, p.d + PLAQUE_FOCUS.gap * 2, PLAQUE_FOCUS.width), table.plaqueFocus);
		ring.position.y = RING_Y;
		ring.visible = false;
		mesh.add(ring);
		table.room.add(mesh);
		return { id: p.id, mesh, top, texture, ring, y, token: 0 };
	}
	function freeButtons() {
		for (const b of table.buttons) {
			b.token++;
			table.room.remove(b.mesh);
			b.mesh.geometry.dispose();
			b.ring.geometry.dispose();
			b.texture.dispose();
			b.top.dispose();
		}
		table.buttons = [];
	}
	// Every corner of every plaque (makePlaque: its bevel reaches p.w x p.d, from restOn(p) up to PLAQUE_H) projects inside the
	// screen, in front of the camera.
	// shortcut: not its focus frame, which can poke about 4 px past the screen's edge. Counting it here would take the plaques from
	// about 9% of opening-view prompts (every two-pair one at 1920x1080). Add PLAQUE_FOCUS's reach if the owner asks for it
	function onScreen(laid) {
		table.camera.updateMatrixWorld();
		table.room.updateWorldMatrix(true, false);
		const at = new Vector3();
		return laid.every((p) => [-1, 1].every((sx) => [-1, 1].every((sz) => [0, PLAQUE_H].every((dy) => {
			at.set(p.x + sx * p.w / 2, restOn(p) + dy, p.z + sz * p.d / 2).applyMatrix4(table.room.matrixWorld).project(table.camera);
			return Math.abs(at.x) <= 1 && Math.abs(at.y) <= 1 && Math.abs(at.z) <= 1;
		}))));
	}
	function layButtons(list, anchor) {
		const under = [...table.cards.values(), ...table.duelCards.values()].map((c) => ({
			x0: c.spot.x - CARD_SIZE.w / 2, x1: c.spot.x + CARD_SIZE.w / 2, z0: c.spot.z - CARD_SIZE.h / 2, z1: c.spot.z + CARD_SIZE.h / 2
		}));
		// A prompt: its list at its anchor
		const labels = JSON.stringify([list.map((b) => [b.id, b.label]), list.length ? [anchor.x, anchor.z, anchor.side] : null]);
		table.buttonsArgs = [list, anchor];
		// A new prompt takes the view as it is now
		if (labels !== table.withinFor) {
			table.withinFor = labels;
			table.buttonsWithin = list.length ? table.inView() : null;
		}
		const asked = JSON.stringify([list, list.length ? anchor : null, under, table.buttonsWithin]);
		// The same ask: no search (a blocked desk's takes tens of ms)
		if (asked === table.buttonsAsked) { return; }
		table.buttonsAsked = asked;
		let laid = list.length ? buttonLayout(list, anchor, [BOARD_RECT, ...DESK_AVOID, ...under], table.buttonsWithin) : [];
		// Whatever the camera (deskInView's shortcut, an orbited view), never a plaque off screen
		const off = table.camera !== null && !laid.blocked && !onScreen(laid);
		const blocked = Boolean(laid.blocked) || off;
		const hidden = off || (blocked && Boolean(table.buttonsWithin));
		// No clear place in the view: no plaques, and the prompt keeps its 2D buttons
		if (hidden) { laid = []; }
		// Keyed by what's laid, not by what was asked, so a card moving elsewhere rebuilds nothing
		const key = JSON.stringify(laid.map((p) => [p.id, p.lines, p.x, p.z, p.w, p.d])) + (blocked ? " blocked" : "");
		if (key === table.buttonsKey) { return; }
		// Warned once a rebuild, not once a call
		if (blocked) {
			console.warn(`Chess Cards: no clear place ${off ? "on screen" : "on the desk"} for the buttons by (${anchor.x}, ${anchor.z}); ${hidden ? "the prompt keeps its 2D buttons" : "they cover something"}`);
		}
		// Another prompt comes up unfocused, so a held Enter can't press its first plaque
		const focused = labels === buttonsLabels ? table.buttons.find((b) => b.ring.visible)?.id : undefined;
		table.buttonsKey = key;
		freeButtons();
		// Another list or anchor (or none) comes up unlit, whatever its ids; the same one laid again keeps its hover
		if (labels !== buttonsLabels) { hoveredButton = null; }
		buttonsLabels = labels;
		table.buttons = laid.map(makePlaque);
		// The same ids keep their focus and hover
		for (const b of table.buttons) {
			b.ring.visible = b.id === focused;
			b.top.color.multiplyScalar(b.id === hoveredButton ? PLAQUE_HOVER : 1);
		}
		table.requestRender();
	}

	return {
		freeButtons,
		/**
		 * @description Lays brass plaque buttons on the baize beside a desk point, clear of every card and the board and inside the desk
		 * the camera showed when this prompt came up (tableLayout.js buttonLayout, inView), or takes them away. When they'd lie as they
		 * do, nothing changes; another list, anchor, or cards coming under them replace them (the old ones freed), with the focused and
		 * hovered ids still focused and hovered
		 * @param {{ id: string, label: string }[]} list in order (the last usually Cancel); the label as the 2D button's, drawn in
		 * capitals; [] takes them away
		 * @param {{ x: number, z: number, side: "left"|"right"|"below" }} anchor a desk point (room space, unturned) and the side the
		 * plaques go on; any value with []
		 * @returns {boolean} plaques are up: false with [] and when they'd cover something inside the view, so the prompt keeps its 2D buttons
		 */
		showButtons(list, anchor) {
			layButtons(list, anchor);
			return table.buttons.length > 0;
		},
		/**
		 * @description Lays the plaques out again inside the desk the camera shows now (inView): the window was resized. Otherwise they
		 * keep the view their prompt came up in
		 * @returns {boolean} plaques are up (showButtons)
		 */
		relayButtons() {
			table.withinFor = null;
			if (table.buttonsArgs) { layButtons(...table.buttonsArgs); }
			return table.buttons.length > 0;
		},
		/**
		 * @description How many plaque buttons are up (showButtons)
		 * @returns {number}
		 */
		buttonCount() {
			return table.buttons.length;
		},
		/**
		 * @description The thin white-gold frame round one plaque, the keyboard's
		 * @param {number|null} index in showButtons' list, null for none
		 */
		focusButton(index) {
			table.buttons.forEach((b, i) => { b.ring.visible = i === index; });
			table.requestRender();
		},
		/**
		 * @description Brightens the brass of the plaque under the pointer, as a hovered hand card's face (hover)
		 * @param {string|null} id the button's id, null for none
		 */
		hoverButton(id) {
			hoveredButton = id;
			for (const b of table.buttons) { b.top.color.setHex(BRASS_MATERIAL.color).multiplyScalar(b.id === id ? PLAQUE_HOVER : 1); }
			table.requestRender();
		},
		/**
		 * @description A plaque pressed: it sinks about its own height and rises again (not under reduced motion)
		 * @param {string} id the button's id
		 */
		pressButton(id) {
			const b = table.buttons.find((x) => x.id === id);
			if (!b || table.still()) { return; }
			const token = ++b.token;
			table.animations.add({
				duration: PRESS_MS,
				update(k) {
					if (token === b.token) {
						const sink = PLAQUE_SINK * Math.sin(Math.PI * k);
						b.mesh.position.y = b.y - sink;
						// Its frame stays on the surface
						b.ring.position.y = RING_Y + sink;
					}
				},
				onEnd() {
					if (token === b.token) {
						b.mesh.position.y = b.y;
						b.ring.position.y = RING_Y;
					}
					table.requestRender();
				},
			});
		},
	};
}
