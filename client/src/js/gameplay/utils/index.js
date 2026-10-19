/* ---------------------------------------------------------------- */
// setTiles()
/* ---------------------------------------------------------------- */
/**
 * @description Sets tile object, which is set by chess.js (npm) on render
 */
export function setTiles() {
	let arr = []
	for (let i = 0; i < 64; i++) {
		arr[i] = { isSliding: null, xSlideTo: null, ySlideTo: null, xDiff: 0, yDiff: 0, isHovering: false, isClicked: false, originX: null, originY: null, isMousedown: null}
	}
	return arr;
}

