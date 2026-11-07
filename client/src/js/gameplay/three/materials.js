/*
 *  materials.js  --  chess frontend
 *	3D Board Materials
 *	Theme materials & textures, made once & shared by every mesh that uses them. Textures are DataTextures (no image
 *	downloads). Wood tones sit outside the 2D board's square colors (light ≈ #9c784d, dark ≈ #61432a) so pieces show on both
 *
 */

import { DataTexture, RepeatWrapping, LinearFilter, Color, MeshStandardMaterial } from "three";

/**
 * @description Tileable grayscale wood grain (wobbly vertical stripes), multiplied into each wood's color
 * @return {[DataTexture]}
 */
function grainTexture(size = 128) {
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const wobble = 4 * Math.sin((y / size) * 2 * Math.PI * 2); // WHOLE PERIODS ACROSS THE TILE KEEP THE EDGES SEAMLESS
			const ring = Math.sin(((x + wobble) / size) * 2 * Math.PI * 6);
			const v = 255 * (0.86 + 0.1 * ring + 0.04 * Math.random());
			data.set([v, v, v, 255], (y * size + x) * 4);
		}
	}
	const texture = new DataTexture(data, size, size);
	texture.wrapS = texture.wrapT = RepeatWrapping;
	texture.magFilter = LinearFilter;
	texture.needsUpdate = true;
	return texture;
}

const grain = grainTexture();

/**
 * @description Fresnel rim glow: adds rim color where the surface turns away from the camera, so an outline reads on any square
 * @return {[MeshStandardMaterial]}
 */
function withRim(material, rim) {
	material.userData.rim = { value: new Color(rim) };
	material.onBeforeCompile = (shader) => {
		shader.uniforms.rimColor = material.userData.rim;
		shader.fragmentShader = shader.fragmentShader
			.replace("void main() {", "uniform vec3 rimColor;\nvoid main() {")
			.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
				totalEmissiveRadiance += rimColor * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);`);
	};
	return material;
}

const wood = (color, rim) => withRim(new MeshStandardMaterial({ color, map: grain, roughness: 0.55, metalness: 0 }), rim);

export const maple = wood(0xF3E7CF, 0x000000); // WHITE'S PIECES: LIGHT ENOUGH ON BOTH SQUARES, NO RIM
export const walnut = wood(0x3A2416, 0x5A4430); // BLACK'S PIECES: A WARM RIM KEEPS THEM READABLE ON DARK SQUARES
export const gold = new MeshStandardMaterial({ color: 0xD4A63A, metalness: 0.8, roughness: 0.3 }); // CROWNS, COLLARS, FRAME INLAY
export const frameWood = wood(0x2E1B10, 0x000000); // DARKER THAN BLACK'S PIECES SO THEY STAND OUT AGAINST IT

/**
 * @description Blob shadow: black with a soft radial alpha falloff, shared by every piece's shadow
 * @return {[DataTexture]}
 */
function blobTexture(size = 64) {
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2); // 0 CENTER .. 1 EDGE
			data.set([0, 0, 0, 255 * Math.max(0, 1 - d) ** 1.5], (y * size + x) * 4);
		}
	}
	const texture = new DataTexture(data, size, size);
	texture.magFilter = LinearFilter;
	texture.needsUpdate = true;
	return texture;
}

export const blob = blobTexture();

/**
 * @description Speckled felt for the green baize table, tiled small so it reads as cloth up close
 * @return {[DataTexture]}
 */
function feltTexture(size = 64) {
	const data = new Uint8Array(size * size * 4);
	for (let i = 0; i < size * size; i++) {
		const v = 255 * (0.88 + 0.12 * Math.random());
		data.set([v, v, v, 255], i * 4);
	}
	const texture = new DataTexture(data, size, size);
	texture.wrapS = texture.wrapT = RepeatWrapping;
	texture.repeat.set(60, 60);
	texture.magFilter = LinearFilter;
	texture.needsUpdate = true;
	return texture;
}

export const baize = new MeshStandardMaterial({ color: 0x1F5A32, map: feltTexture(), roughness: 1, metalness: 0 });
export const BAIZE_FOG = 0x0E2A17; // THE TABLE'S FAR EDGE FADES INTO THIS, WHICH IS ALSO THE BACKGROUND
