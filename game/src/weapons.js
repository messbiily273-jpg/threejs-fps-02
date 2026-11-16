// weapons.js — weapon view models + the fire/reload/switch state machine.
// One job: everything about holding a gun. Damage resolution lives in
// ballistics.js; buying lives in economy.js.
import * as THREE from 'three';
import { WEAPONS } from './state.js';

const VIEW_COLORS = { p9: 0x2e3138, vk9: 0x37424e, ar77: 0x4a3f30, lm88: 0x1f2a33 };

// Build a simple first-person view model from boxes: receiver, barrel,
// grip, magazine, sight. Distinct silhouette + accent per weapon.
export function buildViewModel(id) {
  const w = WEAPONS[id];
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: VIEW_COLORS[id], roughness: 0.45, metalness: 0.75 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.6, metalness: 0.5 });
  const acc = new THREE.MeshStandardMaterial({ color: id === 'lm88' ? 0xd97b2f : 0x37c8a5, roughness: 0.4, metalness: 0.4 });
  const add = (sx, sy, sz, x, y, z, m = mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    mesh.position.set(x, y, z); g.add(mesh); return mesh;
  };
  if (id === 'p9') {
    add(0.07, 0.09, 0.30, 0, 0, -0.1);
    add(0.05, 0.06, 0.12, 0, -0.01, -0.28, dark);
    add(0.06, 0.16, 0.08, 0, -0.11, 0.02, dark);
    add(0.02, 0.03, 0.02, 0, 0.06, -0.24, acc);
  } else if (id === 'vk9') {
    add(0.08, 0.11, 0.42, 0, 0, -0.12);
    add(0.05, 0.05, 0.22, 0, 0.01, -0.4, dark);
    add(0.06, 0.2, 0.07, 0, -0.13, -0.05, dark);
    add(0.07, 0.09, 0.16, 0, -0.02, 0.12, dark);
    add(0.02, 0.04, 0.02, 0, 0.075, -0.3, acc);
  } else if (id === 'ar77') {
    add(0.08, 0.12, 0.55, 0, 0, -0.16);
    add(0.045, 0.045, 0.3, 0, 0.02, -0.55, dark);
    add(0.06, 0.22, 0.08, 0, -0.14, -0.08, dark);
    add(0.07, 0.1, 0.2, 0, -0.03, 0.14, dark);
    add(0.07, 0.05, 0.1, 0, 0.085, -0.1, acc);
  } else { // lm88 sniper: long barrel + big scope
    add(0.09, 0.13, 0.62, 0, 0, -0.2);
    add(0.04, 0.04, 0.42, 0, 0.02, -0.66, dark);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 12), dark);
    scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.1, -0.18); g.add(scope);
    add(0.06, 0.2, 0.08, 0, -0.13, -0.02, dark);
    add(0.08, 0.1, 0.22, 0, -0.03, 0.18, dark);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.035, 12),
      new THREE.MeshBasicMaterial({ color: 0x9fd8ff }));
    lens.position.set(0, 0.1, -0.295); g.add(lens);
  }
  // muzzle reference point for tracers
  g.userData.muzzle = new THREE.Object3D();
  g.userData.muzzle.position.set(0, 0.02, id === 'lm88' ? -0.9 : id === 'p9' ? -0.32 : -0.6);
  g.add(g.userData.muzzle);
  g.position.set(0.3, -0.3, -0.62);
  g.scale.setScalar(0.62);
  return g;
}

// Current spread (radians): base + bloom from firing + movement penalty.
// Stopping to aim pays: moving or airborne widens the cone sharply.
export function currentSpread(f, w) {
  const move = Math.min(1, (f.speed || 0) / 4.25);
  const air = f.y > 0.01 ? 1 : 0;
  const crouchBonus = f.crouch ? -0.25 : 0;
  return Math.max(0.002, w.spread * (1 + f.spreadBloom * 2.2 + move * 1.6 + air * 2.0 + crouchBonus));
}

export function canFire(f, now) {
  const w = WEAPONS[f.current];
  const ws = f.weapons[f.current];
  if (!ws || f.reloading > 0 || f.reloading === true) return false;
  if (now - f.lastShot < w.interval) return false;
  if (ws.mag <= 0) return false;
  return true;
}
export function spendShot(f, now) {
  const ws = f.weapons[f.current];
  ws.mag -= 1;
  f.lastShot = now;
  f.spreadBloom = Math.min(1, f.spreadBloom + 0.22);
  f.recoil = Math.min(0.09, f.recoil + WEAPONS[f.current].kick);
}
export function startReload(f, now) {
  const w = WEAPONS[f.current];
  const ws = f.weapons[f.current];
  if (!ws || f.reloading > 0 || ws.mag >= w.mag || ws.reserve <= 0) return false;
  f.reloading = w.reload; f.reloadEnd = now + w.reload;
  return true;
}
export function updateWeapon(f, dt, now) {
  // bloom + recoil decay
  f.spreadBloom = Math.max(0, f.spreadBloom - dt * 1.4);
  f.recoil = Math.max(0, f.recoil - dt * 0.25);
  if (f.reloading > 0) {
    f.reloading -= dt;
    if (f.reloading <= 0) {
      f.reloading = 0;
      const w = WEAPONS[f.current], ws = f.weapons[f.current];
      const need = w.mag - ws.mag, take = Math.min(need, ws.reserve);
      ws.mag += take; ws.reserve -= take;
    }
  }
}
export function switchWeapon(f, id) {
  if (!f.weapons[id] || f.current === id) return false;
  f.current = id; f.reloading = 0; f.selectedGrenade = null;
  return true;
}
export function cycleWeapon(f) {
  const owned = Object.keys(f.weapons);
  const i = owned.indexOf(f.current);
  return switchWeapon(f, owned[(i + 1) % owned.length]);
}
