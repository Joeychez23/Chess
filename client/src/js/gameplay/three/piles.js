/* ---- Layout of the taken pieces: loose piles on the desk, outside two corners of the baize ---- */

export const PILE_AREA = { x0: -31, x1: -23, z0: -18.5, z1: -5.5 };
export const PILE_GAP = 2.0;

const COLUMNS = 3;
const COL_X = -24.3;
const COL_STEP = 2.65;
const ROW_Z = -17.2;
const ROW_STEP = 2.6;
const JITTER = 0.28;
const YAW_JITTER = Math.PI / 6;

/**
 * @description A repeatable pair of numbers in [-1, 1) for one slot of one pile; no Math.random, so a pile never reshuffles.
 * @param {number} pile 0 for the far pile, 1 for the near pile
 * @param {number} slot position in the pile
 * @returns {number[]} three values: x jitter, z jitter, yaw jitter
 */
function seeded(pile, slot) {
	let seed = (pile * 1000 + slot + 1) * 2654435761 % 4294967296;
	const out = [];
	for (let i = 0; i < 3; i++) {
		seed = (seed * 1664525 + 1013904223) % 4294967296; // A SMALL LINEAR GENERATOR, AS IN THE MONITOR STATIC
		out.push(seed / 2147483648 - 1);
	}
	return out;
}

/**
 * @description One spot on the desk for every taken piece, in capture order.
 * @param {{ type: string, color: string }[]} captures the taken pieces, `color` being the taken piece's colour
 * @param {string|null|undefined} playerColor "w", "b", or nothing (counts as White)
 * @returns {{ key: string, type: string, color: string, x: number, z: number, yaw: number }[]} one spot per capture
 */
export function pileSpots(captures, playerColor) {
	const player = playerColor || "w";
	const turn = player === "b" ? -1 : 1; // BLACK SEES THE ROOM TURNED 180 DEGREES
	const counts = { far: 0, near: 0 };
	return captures.map(function (piece) {
		const pile = piece.color === player ? "far" : "near";
		const slot = counts[pile]++;
		const [jx, jz, jyaw] = seeded(pile === "far" ? 0 : 1, slot);
		const col = slot % COLUMNS;
		const row = Math.floor(slot / COLUMNS);
		const side = (pile === "far" ? 1 : -1) * turn; // NEAR IS THE FAR PILE TURNED 180 DEGREES ABOUT THE BOARD
		const x = (COL_X - COL_STEP * col + jx * JITTER) * side;
		const z = (ROW_Z + ROW_STEP * row + jz * JITTER) * side;
		let base = player === "b" ? Math.PI : 0;
		if (piece.type === "n") { base = player === "b" ? Math.PI / 2 : -Math.PI / 2; } // A KNIGHT'S NOSE IS +x
		return { key: pile + slot, type: piece.type, color: piece.color, x, z, yaw: base + jyaw * YAW_JITTER };
	});
}
