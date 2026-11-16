/* ---- A tiny tween runner, stepped by the render loop ---- */

/**
 * @description Ease in-out (smoothstep) of a progress value.
 * @param {number} k progress 0 to 1
 * @returns {number} eased progress 0 to 1
 */
function ease(k) {
	return k * k * (3 - 2 * k);
}

/**
 * @description A set of running tweens, stepped by the caller's clock.
 * @param {() => void} requestRender asks for a frame; called whenever a tween is added
 * @returns {{ add: Function, step: (now: number) => boolean, finish: () => void, active: () => boolean }} the runner
 */
export function createTweens(requestRender) {
	let running = [];

	return {
		/**
		 * @description Starts a tween; its clock begins on the first step, plus its delay.
		 * @param {{ duration: number, delay?: number, update: (k: number) => void, onEnd?: () => void }} tween the tween
		 */
		add(tween) {
			running.push({ tween, start: null });
			requestRender();
		},
		/**
		 * @description Advances every tween to `now`, ending the ones that are done.
		 * @param {number} now clock time in milliseconds
		 * @returns {boolean} whether any tween is still running
		 */
		step(now) {
			const batch = running;
			running = [];
			const keep = [];
			batch.forEach(function (entry) {
				const t = entry.tween;
				if (entry.start === null) entry.start = now + (t.delay || 0); // CLOCK STARTS ON THE FIRST STEP
				const raw = t.duration > 0 ? (now - entry.start) / t.duration : (now >= entry.start ? 1 : 0);
				const k = Math.min(1, Math.max(0, raw));
				t.update(k >= 1 ? 1 : ease(k));
				if (k >= 1) {
					if (t.onEnd) t.onEnd();
				} else {
					keep.push(entry);
				}
			});
			running = keep.concat(running); // TWEENS ADDED DURING AN UPDATE JOIN THE NEXT STEP
			return running.length > 0;
		},
		/**
		 * @description Lands every tween at once: `update(1)`, then `onEnd`.
		 */
		finish() {
			const batch = running;
			running = [];
			batch.forEach(function (entry) {
				entry.tween.update(1);
				if (entry.tween.onEnd) entry.tween.onEnd();
			});
		},
		/**
		 * @description Whether any tween is waiting or running.
		 * @returns {boolean} true while a tween is alive
		 */
		active() {
			return running.length > 0;
		},
	};
}
