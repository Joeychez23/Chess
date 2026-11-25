// Square effect: Trapdoor (Task 22 S2, table UI doc "Trapdoor", ruling T22-1): a steel bear trap lying open on its square, teeth up, with a pressure plate & a short chain,
// half-transparent & still (only its owner sees it). Its burst snaps the jaws shut round the foot of the piece standing there (nothing is removed) & fades the shut trap out.
// There is no piece: everything goes in opts.squareRoot. With opts.sprung no open trap is drawn & the frame calls burst() at once. The contract & opts are statusFx/index.js's
import { Group, Mesh, TorusGeometry, ConeGeometry, CircleGeometry, CylinderGeometry, MeshStandardMaterial } from "three";
import { CELL_SIZE, PIECE_SIZE } from "../constants.js";

export const JAW = CELL_SIZE * 0.44; // A JAW'S RADIUS (WORLD UNITS): THE OPEN TRAP IS A RING JUST INSIDE ITS SQUARE, HINGED AT ITS TWO ENDS ON THE X AXIS
export const TOOTH = CELL_SIZE * 0.07; // A TOOTH'S HEIGHT
const CLEAR = PIECE_SIZE * 0.45; // HOW CLOSE A SHUT TOOTH TIP COMES TO THE SQUARE'S CENTRE: OUTSIDE THE WIDEST PIECE AT THE TIPS' HEIGHT (THE .glb KING'S 0.42 THERE; ITS FOOT, 0.48, IS BELOW THE TIPS)
// THE SHUT ANGLE: A TOOTH TIP AT A JAW'S MIDDLE (JAW cos a - TOOTH sin a FROM THE CENTRE) STOPS AT CLEAR, SO THE JAWS GRIP THE FOOT INSTEAD OF CLOSING THROUGH THE PIECE
export const SHUT = Math.acos(CLEAR / Math.hypot(JAW, TOOTH)) - Math.atan2(TOOTH, JAW);
export const OPEN_OPACITY = 0.5;
export const SNAP_MS = 120;
export const BURST_MS = 1000;
const HOLD_MS = 350; // THE SHUT TRAP STAYS SOLID THIS LONG, THEN FADES TO FADE_END
const FADE_END = BURST_MS - 100; // GONE A LITTLE EARLY: ITS CLOCK RUNS ON dt CAPPED AT 0.1 s, THE FRAME FREES IT ON THE WALL CLOCK, SO A HITCH WOULD CUT IT OFF STILL VISIBLE
const TUBE = CELL_SIZE * 0.018; // THE JAWS' THICKNESS (RADIUS)
const LIFT = 0.04; // OVER THE BOARD, ITS GRID (0.01), MARKED'S GLOW (0.02) & EVERY TILE HIGHLIGHT (0.02 + i * 0.002 UP TO 0.034, three/index.js): THEY ALL SKIP DEPTH, SO HEIGHT DECIDES
const STEEL = 0x9aa4ad, DARK = 0x4a5056;

/**
 * @description The trap at a burst time: the jaws' angle up from flat (eased in, a spring's snap) & the opacity (solid for the snap, then fading out)
 * @param  {[number]} ms [ms since the burst, null: no burst, the open trap]
 * @return {[object]} { angle (radians, 0 open, SHUT shut), opacity }
 */
export function trapLook(ms) {
	if (ms === null) { return { angle: 0, opacity: OPEN_OPACITY }; }
	const k = Math.min(1, ms / SNAP_MS);
	return { angle: SHUT * k * k, opacity: 1 - Math.min(1, Math.max(0, (ms - HOLD_MS) / (FADE_END - HOLD_MS))) };
}

/**
 * @description The trap on one square (statusFx/index.js calls it, never anything else)
 * @param  {[null]} pieceMesh [none: the trap is the square's]
 * @param  {[object]} opts [statusFx/index.js's, with squareRoot (the square's centre, y 0, world units), reduce & sprung (true: no open trap, a burst follows)]
 * @return {[object]} { update(dt), burst(), animating(), dispose() }
 */
export function create(pieceMesh, opts) {
	// THE STEEL WRITES DEPTH: BOTH JAWS SORT AT THE SAME PIVOT, SO WITHOUT IT THE FAR JAW COULD DRAW OVER THE NEAR ONE WHILE SHUT & SOLID
	const steel = new MeshStandardMaterial({ color: STEEL, metalness: 0.3, roughness: 0.4, transparent: true, depthWrite: true });
	const dark = new MeshStandardMaterial({ color: DARK, metalness: 0.3, roughness: 0.6, transparent: true, depthWrite: false });
	const geometries = [
		new TorusGeometry(JAW, TUBE, 4, 10, Math.PI), // A JAW: HALF A RING
		new ConeGeometry(CELL_SIZE * 0.022, TOOTH, 4),
		new CircleGeometry(CELL_SIZE * 0.14, 10), // THE PRESSURE PLATE
		new CylinderGeometry(TUBE * 0.8, TUBE * 0.8, JAW * 2, 4), // THE SPRING BAR ACROSS THE HINGES
		new TorusGeometry(CELL_SIZE * 0.035, CELL_SIZE * 0.01, 3, 6), // A CHAIN LINK
	];
	const [jawGeometry, toothGeometry, plateGeometry, barGeometry, linkGeometry] = geometries;
	const trap = new Group();
	trap.position.y = LIFT;
	const plate = new Mesh(plateGeometry, dark);
	plate.rotation.x = -Math.PI / 2;
	const bar = new Mesh(barGeometry, dark);
	bar.rotation.z = Math.PI / 2;
	bar.position.y = TUBE;
	trap.add(plate, bar);
	// TWO JAWS, EACH TURNING ON THE X AXIS: side 1 IS THE +z HALF, -1 THE -z HALF. TEETH ARE THE PIVOT'S, POINTING UP WHILE OPEN & INWARD AS IT SHUTS
	const jaws = [1, -1].map(function (side) {
		const pivot = new Group(), jaw = new Mesh(jawGeometry, steel);
		pivot.position.y = TUBE;
		jaw.rotation.x = side * Math.PI / 2;
		pivot.add(jaw);
		for (let k = 0; k < 5; k++) {
			const a = Math.PI * (0.2 + 0.15 * k), tooth = new Mesh(toothGeometry, steel);
			tooth.position.set(JAW * Math.cos(a), TOOTH / 2, side * JAW * Math.sin(a));
			pivot.add(tooth);
		}
		trap.add(pivot);
		return pivot;
	});
	// THE CHAIN: THREE LINKS FROM THE RING TOWARD THE SQUARE'S +x +z CORNER, FLAT & STANDING IN TURN
	for (let i = 0; i < 3; i++) {
		const link = new Mesh(linkGeometry, steel), r = JAW + CELL_SIZE * (0.05 + 0.06 * i);
		link.position.set(r * Math.SQRT1_2, CELL_SIZE * (i % 2 ? 0.035 : 0.01), r * Math.SQRT1_2);
		link.rotation.set(i % 2 ? 0 : -Math.PI / 2, -Math.PI / 4, 0, "YXZ"); // A STANDING LINK'S PLANE ALONG THE CHAIN
		trap.add(link);
	}
	opts.squareRoot.add(trap);
	let t = 0, burstAt = null; // burstAt: t WHEN THE BURST STARTED
	const elapsed = () => (burstAt === null ? null : (t - burstAt) * 1000);
	function update(dt) {
		t += dt;
		const look = trapLook(elapsed());
		jaws.forEach((pivot, i) => { pivot.rotation.x = (i ? 1 : -1) * look.angle; });
		steel.opacity = dark.opacity = look.opacity;
		trap.visible = burstAt === null ? !opts.sprung : look.opacity > 0;
	}
	update(0);
	return {
		update,
		burst() {
			if (opts.reduce) { return 0; }
			burstAt = t;
			return BURST_MS;
		},
		animating: () => !opts.reduce && burstAt !== null && elapsed() < BURST_MS,
		dispose() {
			trap.removeFromParent();
			geometries.forEach((g) => g.dispose());
			steel.dispose();
			dark.dispose();
		},
	};
}
