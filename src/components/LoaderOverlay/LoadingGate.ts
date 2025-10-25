// loadingGate.ts
import * as THREE from "three";

type GateState = { total: number; loaded: number; done: boolean };
const gate: GateState = { total: 0, loaded: 0, done: false };
let wired = false;

export function wireLoadingGate() {
  if (wired) return gate;
  wired = true;
  const mgr = THREE.DefaultLoadingManager;

  mgr.onStart = (_url, loaded, total) => {
    gate.loaded = loaded;
    gate.total = total;
  };
  mgr.onProgress = (_url, loaded, total) => {
    gate.loaded = loaded;
    gate.total = total;
  };
  mgr.onLoad = () => {
    gate.done = true;
    window.dispatchEvent(new Event("assets:loaded"));
  };
  // mgr.onError = (url) => { /* optional logging */ };

  return gate;
}

export function getGateState() {
  return gate; // read-only view
}
