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

// THE 2D PIECES' shade() (images/_ideas/generator/glsl-common.js), SO THE MODELS MATCH THE SPRITES: ITS OWN LAMP & SKY, THE SCENE'S LIGHTS ONLY TOUCH THE BOARD.
// ITS DIRECTIONS ARE THE SPRITE CAMERA'S, SO THEY TURN WITH THE CAMERA AROUND THE BOARD (toSprite): THE LAMP STAYS OVER THE PLAYER'S RIGHT SHOULDER FROM EITHER SIDE
const SPRITE_LIGHTING = `
	uniform sampler2D spriteLight;
	varying vec2 vPieceFront;
	const vec3 SPRITE_LAMP = normalize(vec3(0.59, 1.8, 0.71));
	vec3 toSprite(vec3 v, vec2 cam) { return vec3(v.x * cam.y - v.z * cam.x, v.y, v.x * cam.x + v.z * cam.y); } // TURNS A WORLD DIRECTION BY THE CAMERA'S ANGLE AROUND THE BOARD (cam: ITS SIN & COS)
	vec3 spriteSky(vec3 R) {
		vec3 c = mix(vec3(0.05, 0.032, 0.02), vec3(0.24, 0.20, 0.17), smoothstep(-0.3, 0.9, R.y));
		c += vec3(1.0, 0.78, 0.5) * pow(saturate(dot(R, SPRITE_LAMP)), 40.0) * 6.0;
		return c + vec3(0.5, 0.55, 0.65) * pow(saturate(dot(R, normalize(vec3(-0.8, 0.5, -0.3)))), 6.0) * 0.6;
	}
	vec3 spriteShade(vec3 alb, vec3 nor, vec3 eye, float rough, float metal, float occ, float sha, float sss) {
		float dif = saturate(dot(nor, SPRITE_LAMP));
		float ndv = saturate(dot(nor, eye));
		float shin = mix(8.0, 220.0, 1.0 - rough);
		float spe = pow(saturate(dot(nor, normalize(SPRITE_LAMP + eye))), shin) * (shin + 8.0) / 40.0;
		float fre = pow(1.0 - ndv, 5.0);
		vec3 env = spriteSky(reflect(-eye, nor));
		vec3 key = vec3(1.0, 0.82, 0.6) * 2.0;
		vec3 skyLight = vec3(0.30, 0.32, 0.38) * 0.38 * (0.5 + 0.5 * nor.y);
		vec3 F = alb + (1.0 - alb) * fre;
		vec3 shiny = env * F * occ * 1.3 + key * F * spe * dif * sha * 0.7 + alb * dif * sha * key * 0.18 + alb * skyLight * occ * 0.3;
		vec3 col = alb * (dif * sha * key + skyLight * occ + saturate(0.4 - nor.y) * vec3(0.42, 0.24, 0.12) * 0.4 * occ);
		col += alb * vec3(1.0, 0.62, 0.42) * sss * 0.22 * saturate(dot(nor, SPRITE_LAMP) * 0.5 + 0.5) * occ;
		col += key * spe * sha * mix(0.06, 0.02, rough) + env * (0.04 + 0.96 * fre) * occ * mix(0.7, 0.2, rough);
		col = mix(col, shiny, smoothstep(0.25, 0.75, metal)); // BLENDED, A HARD SWITCH SPECKLES WHERE FINE GOLD (THE ROOK'S PORTCULLIS) IS ONLY A TEXEL WIDE
		col += vec3(1.0, 0.8, 0.6) * pow(saturate(1.0 - ndv), 3.0) * saturate(dot(nor, normalize(vec3(-0.6, 0.4, -0.7))) + 0.3) * 0.22 * occ;
		col = max(col, 0.0);
		col = pow(saturate((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14)), vec3(1.0 / 2.2)); // THE SPRITES' TONE CURVE, ENDS IN DISPLAY VALUES
		return mix(col / 12.92, pow((col + 0.055) / 1.055, vec3(2.4)), step(0.04045, col)); // BACK TO LINEAR, three.js ENCODES IT AGAIN
	}
`;

/**
 * @description A piece side's material for the baked models: the sprites' lighting over its atlases
 * @param  {[object]} maps { color, roughMetal (R subsurface, G roughness, B metalness), normal, light (R occlusion, G the lamp's shadow, B its shadow with the lamp behind) }
 * @return {[MeshStandardMaterial]}
 */
export function atlasMaterial({ color, roughMetal, normal, light }) {
	const material = new MeshStandardMaterial({ map: color, normalMap: normal, roughnessMap: roughMetal, metalnessMap: roughMetal, roughness: 1, metalness: 1 });
	material.userData.light = { value: light };
	material.onBeforeCompile = (shader) => {
		shader.uniforms.spriteLight = material.userData.light;
		shader.vertexShader = shader.vertexShader
			.replace("void main() {", "varying vec2 vPieceFront;\nvoid main() {")
			.replace("#include <project_vertex>", "#include <project_vertex>\n\tvPieceFront = (modelMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xz; // WHERE THE MODEL'S FRONT (+Z) POINTS ON THE BOARD");
		shader.fragmentShader = shader.fragmentShader
			.replace("void main() {", `${SPRITE_LIGHTING}\nvoid main() {`)
			.replace("#include <opaque_fragment>", `{
				vec3 baked = texture2D(spriteLight, vMapUv).rgb;
				vec3 back = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]); // THE CAMERA'S +Z ON THE BOARD: FROM WHAT IT LOOKS AT TOWARD IT
				vec2 cam = dot(back.xz, back.xz) > 1e-6 ? normalize(back.xz) : vec2(0.0, 1.0);
				// THE SHADOWS ARE BAKED WITH THE LAMP IN FRONT OF THE MODEL (G) & BEHIND IT (B). THE LAMP FOLLOWS THE CAMERA, SO A PIECE FACING THE PLAYER
				// TAKES G LIKE ITS SPRITE, ONE FACING AWAY TAKES B, & ONE TURNED SIDEWAYS FADES TO NO BAKED SHADOW RATHER THAN ONE ON THE WRONG SIDE
				float facing = dot(normalize(vPieceFront), cam);
				float shadow = baked.g * saturate(facing) + baked.b * saturate(-facing) + 1.0 - abs(facing);
				outgoingLight = spriteShade(diffuseColor.rgb, toSprite(inverseTransformDirection(normal, viewMatrix), cam), toSprite(inverseTransformDirection(geometryViewDir, viewMatrix), cam),
					roughnessFactor, metalnessFactor, baked.r, shadow, texture2D(roughnessMap, vRoughnessMapUv).r);
			}
			#include <opaque_fragment>`);
	};
	return material;
}

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
