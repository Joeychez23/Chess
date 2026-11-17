/*
 *  rng.js  --  chess cards engine
 *	Seeded random generator: ChaCha20 (RFC 8439) in counter mode. All engine randomness comes from state.rng = { key: 8 uint32, n: outputs used }.
 *
 */

const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]; // "expand 32-byte k"
const TWO_32 = 4294967296;

/**
 * @description One ChaCha20 block (RFC 8439 section 2.3): key = 8 uint32, counter = uint32, nonce = 3 uint32; returns 16 uint32 (little-endian words).
 */
function block(key, counter, nonce) {
	const init = [...SIGMA, ...key, counter, ...nonce], x = init.map((w) => w | 0);
	const rotl = (v, c) => (v << c) | (v >>> (32 - c));
	const qr = (a, b, c, d) => {
		x[a] = (x[a] + x[b]) | 0; x[d] = rotl(x[d] ^ x[a], 16);
		x[c] = (x[c] + x[d]) | 0; x[b] = rotl(x[b] ^ x[c], 12);
		x[a] = (x[a] + x[b]) | 0; x[d] = rotl(x[d] ^ x[a], 8);
		x[c] = (x[c] + x[d]) | 0; x[b] = rotl(x[b] ^ x[c], 7);
	};
	for (let i = 0; i < 10; i++) {
		qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15); // COLUMNS
		qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14); // DIAGONALS
	}
	return x.map((w, i) => (w + init[i]) >>> 0);
}

/**
 * @description A fresh state.rng { key, n: 0 } from a 64-character hex string (32 bytes, read as 8 little-endian words, as ChaCha20 reads key bytes) or an integer from 0 to 4294967295 (key [value, 0, ...]: tests only, as guessable as the integer itself). Anything else throws.
 */
function seed(value) {
	if (typeof value === "string" && /^[0-9a-f]{64}$/i.test(value)) {
		const key = Array.from({ length: 8 }, (_, i) => {
			const b = value.slice(i * 8, i * 8 + 8).match(/../g).reverse().join(""); // LITTLE-ENDIAN BYTES
			return parseInt(b, 16);
		});
		return { key, n: 0 };
	}
	if (Number.isInteger(value) && value >= 0 && value <= 0xffffffff) return { key: [value, 0, 0, 0, 0, 0, 0, 0], n: 0 }; // NO SILENT WRAP: 2**32 MUST NOT EQUAL 0
	throw new Error("seed needs a 64-character hex string or an integer from 0 to 4294967295");
}

/**
 * @description Next number in [0, 1): output n is word n % 16 of the block with counter floor(n / 16) (high bits in the first nonce word); advances state.rng.n.
 */
function next(state) {
	const r = state.rng;
	if (!r || !Array.isArray(r.key) || r.key.length !== 8 || !r.key.every((w) => w === w >>> 0) || !Number.isInteger(r.n) || r.n < 0) throw new Error("state.rng missing");
	const c = Math.floor(r.n / 16), w = block(r.key, c >>> 0, [Math.floor(c / TWO_32), 0, 0])[r.n % 16];
	r.n++;
	return w / TWO_32;
}

/**
 * @description Integer in 0..n-1; n must be a positive integer.
 */
function int(state, n) {
	if (!(Number.isInteger(n) && n >= 1)) throw new Error("int needs a positive integer");
	return Math.floor(next(state) * n);
}

/**
 * @description Fisher-Yates shuffle, in place; returns arr.
 */
function shuffle(state, arr) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = int(state, i + 1);
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

/**
 * @description A random element of arr; undefined (and no draw) for an empty array.
 */
function pick(state, arr) {
	if (!arr.length) return undefined;
	return arr[int(state, arr.length)];
}

module.exports = { block, seed, next, int, shuffle, pick };
