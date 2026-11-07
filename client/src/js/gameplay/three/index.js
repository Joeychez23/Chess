/*
 *  index.js  --  chess frontend
 *	3D Board
 *	The three.js board. Never imported statically: load.js pulls it in with import() when the player turns 3D on, so webpack
 *	puts it & three.js in their own "three" chunk & 2D players never download them. Named imports only, so the rest of
 *	three.js is tree-shaken out. The full API (syncFromBoard, squareUnder, highlight, animateMove) comes with the prototype
 *
 */

import { WebGLRenderer, Scene, PerspectiveCamera, Color } from "three";

let renderer = null, scene = null, camera = null;

/**
 * @description Creates the renderer, scene & camera inside container & draws one frame. Throws if WebGL is unavailable
 * @param  {[HTMLElement]} container [what the 3D canvas goes in]
 */
export function mount(container) {
	if (renderer) { return; }
	renderer = new WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(container.clientWidth, container.clientHeight);
	scene = new Scene();
	scene.background = new Color(0x1d1d1d);
	camera = new PerspectiveCamera(45, container.clientWidth / Math.max(container.clientHeight, 1), 0.1, 100);
	camera.position.set(0, 10, 10);
	camera.lookAt(0, 0, 0);
	container.appendChild(renderer.domElement);
	renderer.render(scene, camera);
}

/**
 * @description Removes the 3D canvas & frees the WebGL context
 */
export function unmount() {
	if (!renderer) { return; }
	renderer.domElement.remove();
	renderer.dispose();
	renderer.forceContextLoss();
	renderer = scene = camera = null;
}
