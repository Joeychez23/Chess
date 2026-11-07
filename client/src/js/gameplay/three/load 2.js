/*
 *  load.js  --  chess frontend
 *	3D Board Loader
 *	The only way into the 3D board (three/index.js). Downloads the "three" chunk the first time 3D is turned on, shows
 *	"Loading 3D board..." meanwhile & on a failure says why, so the caller stays on 2D. This file stays in the play bundle
 *
 */

import { showStatus, clearStatus, MESSAGE_TIME } from "../status/index.js";

let loading = null; // THE PENDING OR FINISHED import(), SO TURNING 3D ON TWICE DOWNLOADS ONCE

/**
 * @description Can this browser draw WebGL? Checked before downloading, no point fetching three.js otherwise
 * @return {[boolean]}
 */
function hasWebGL() {
	try {
		const canvas = document.createElement("canvas");
		return !!(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
	} catch (e) {
		return false;
	}
}

/**
 * @description Loads the 3D board module
 * @return {[Promise<object|null>]} [the module (mount, unmount, ...), or null when it couldn't load: stay on 2D]
 */
export function load3D() {
	if (!hasWebGL()) {
		showStatus("view", "3D board unavailable: this browser can't use WebGL. Staying on 2D.", MESSAGE_TIME);
		return Promise.resolve(null);
	}
	if (!loading) {
		showStatus("view", "Loading 3D board...");
		loading = import(/* webpackChunkName: "three" */ "./index.js").then(function (board) {
			clearStatus("view");
			return board;
		}, function (error) {
			loading = null; // A LATER TRY DOWNLOADS AGAIN (BACK ONLINE)
			const why = navigator.onLine === false ? "you're offline" : "it didn't download";
			showStatus("view", `3D board couldn't load (${why}). Staying on 2D.`, MESSAGE_TIME);
			console.warn("3D board failed to load", error);
			return null;
		});
	}
	return loading;
}
