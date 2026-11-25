// THE NAMES three/camera.js IMPORTS FROM three/index.js, pointer.js, room.js, monitor/monitor.js & lean.js, FOR client/test/openingCamera.test.js (ITS RESOLVE HOOK SWAPS ALL FIVE FOR THIS FILE):
// NO WebGL, NO ROOM, NO MONITOR. THE SCRATCH OBJECTS ARE REAL three.js ONES, AS IN three/index.js
import { PerspectiveCamera, Spherical, Vector3 } from "three";

export let view = null;
export function setView(v) { view = v; }
export function requestRender() {}
export function setLabels() {}
let relay = () => {};
export function relayPlaques() { relay(); } // index.js's: THE TEST SAYS WHAT A RELAY DOES
export function setRelay(f) { relay = f; }
export const spherical = new Spherical(), fitCamera = new PerspectiveCamera(), corner = new Vector3(), dealShift = new Vector3(), UP = new Vector3(0, 1, 0), offset = new Vector3();
export const glassCentre = new Vector3(), glassSize = new Vector3(), glassScale = new Vector3(), glassNormal = new Vector3();
let idle = true;
export const monitorIdle = () => idle;
export function setIdle(value) { idle = value; } // false: AT THE MONITOR

export function turnRoom(group, angle) { group.rotation.y = angle; }
export const zoomDistance = () => 10;
export function setLeanCamera() {}
export const leanSpot = () => null;
export function retryLean() {}
