// The "badges" status display (Task 21 S4): one round badge per status over the piece, its colour the status's, its number the turns left (none for a permanent one, ruling Q2).
// Same contract as an effect module (statusFx/index.js), made for each status when the mode is "badges"
import { Sprite, SpriteMaterial, CanvasTexture, SRGBColorSpace } from "three";
import { CELL_SIZE } from "../constants.js";

const COLORS = { warded: ["#e8c04a", "#7a5a10"], frozen: ["#bfe8ff", "#2b7fb8"], shaken: ["#b9cde4", "#2c5a94"], marked: ["#e04848", "#6e1010"], hexed: ["#7ee05a", "#2f6b1c"],
	"heavy-cavalry": ["#d78c3c", "#8c5014"], "heretical-subjection": ["#a56ee6", "#5a2896"], "opposing-finality": ["#46c8be", "#146e6e"] }; // [FILL, RING]: THE RINGS' BRONZE, VIOLET & TEAL (sigils.js PAL body & halo)
const PX = 64; // THE BADGE'S CANVAS SIDE
const BADGE = CELL_SIZE * 0.3; // ITS SIZE ON THE BOARD (WORLD UNITS)
const GAP = 1.15; // BADGES SIDE BY SIDE, IN BADGE WIDTHS FROM ONE'S MIDDLE TO THE NEXT'S
const OVER = 0.12; // HOW FAR OVER THE PIECE'S TOP (PIECE UNITS)

/**
 * @description What a badge prints: the turns left, nothing for a permanent status (left null)
 * @param  {[number|null]} left
 * @return {[string]}
 */
export const badgeText = (left) => (left === null || left === undefined ? "" : String(left));

function draw(ctx, s, text) {
	const [fill, ring] = COLORS[s] || ["#ffffff", "#333333"];
	ctx.clearRect(0, 0, PX, PX);
	ctx.beginPath();
	ctx.arc(PX / 2, PX / 2, PX / 2 - 4, 0, Math.PI * 2);
	ctx.fillStyle = fill;
	ctx.fill();
	ctx.lineWidth = 6;
	ctx.strokeStyle = ring;
	ctx.stroke();
	if (!text) { return; }
	ctx.fillStyle = ring;
	ctx.font = "bold 38px sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(text, PX / 2, PX / 2 + 2);
}

/**
 * @description One status's badge, a sprite in opts.root (over the piece, it follows it). Redrawn when opts.left changes, moved when opts.slot / opts.slots or the mesh do
 * @param  {[Mesh]} pieceMesh [unused: opts.mesh is the current one]
 * @param  {[object]} opts [statusFx/index.js's]
 * @return {[object]} { update(dt), burst(), animating(), dispose() }
 */
export function create(pieceMesh, opts) {
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = PX;
	const ctx = canvas.getContext("2d"), texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true })); // DEPTH TESTED: A CARD, THE DUEL OR THE MONITOR IN FRONT HIDES IT (OVER ITS OWN PIECE'S TOP, IT DOESN'T)
	opts.root.add(sprite);
	let text = null, at = null;
	function update() {
		const t = badgeText(opts.left);
		if (t !== text) { text = t; draw(ctx, opts.s, t); texture.needsUpdate = true; }
		const box = opts.mesh.geometry && opts.mesh.geometry.boundingBox, key = `${opts.slot}/${opts.slots}/${opts.mesh.id}`;
		if (key === at) { return; }
		at = key;
		const scale = opts.mesh.scale.y || 1; // THE ROOT IS IN PIECE UNITS
		sprite.scale.setScalar(BADGE / scale);
		sprite.position.set(0, (box ? box.max.y : 1) + OVER + BADGE / scale / 2, 0);
		sprite.center.set(0.5 - (opts.slot - (opts.slots - 1) / 2) * GAP, 0.5); // A SCREEN-SPACE SHIFT: THE ROW STAYS LEVEL HOWEVER THE PIECE IS TURNED
	}
	update();
	return {
		update,
		burst() { return 0; },
		animating: () => false,
		dispose() { sprite.removeFromParent(); sprite.material.dispose(); texture.dispose(); },
	};
}
