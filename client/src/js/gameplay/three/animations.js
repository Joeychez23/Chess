/* ---- A tiny animation runner, stepped by the render loop ---- */

/**
 * @description Ease in-out (smoothstep) of a progress value.
 * @param {number} k progress 0 to 1
 * @returns {number} eased progress 0 to 1
 */
function ease(k) {
	return k * k * (3 - 2 * k);
}

/**
 * @description A set of running animations, stepped by the caller's clock.
 * @param {() => void} requestRender asks for a frame; called whenever an animation is added
 * @returns {{ add: Function, step: (now: number) => boolean, finish: () => void, active: () => boolean }} the runner
 */
export function createAnimations(requestRender) {
	let running = [];

	return {
		/**
		 * @description Starts an animation; its clock begins on the first step, plus its delay.
		 * @param {{ duration: number, delay?: number, update: (k: number) => void, onEnd?: () => void }} animation the animation
		 */
		add(animation) {
			running.push({ animation, start: null });
			requestRender();
		},
		/**
		 * @description Advances every animation to `now`, ending the ones that are done.
		 * @param {number} now clock time in milliseconds
		 * @returns {boolean} whether any animation is still running
		 */
		step(now) {
			const batch = running;
			running = [];
			const keep = [];
			batch.forEach(function (entry) {
				const t = entry.animation;
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
			running = keep.concat(running); // ANIMATIONS ADDED DURING AN UPDATE JOIN THE NEXT STEP
			return running.length > 0;
		},
		/**
		 * @description Lands every animation at once: `update(1)`, then `onEnd`.
		 */
		finish() {
			const batch = running;
			running = [];
			batch.forEach(function (entry) {
				entry.animation.update(1);
				if (entry.animation.onEnd) entry.animation.onEnd();
			});
		},
		/**
		 * @description Whether any animation is waiting or running.
		 * @returns {boolean} true while an animation is alive
		 */
		active() {
			return running.length > 0;
		},
	};
}
