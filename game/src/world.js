// world.js — FOUNDRY YARD: the 64 x 46 m dusk-industrial map.
// One job: geometry, colliders, line-of-sight and the waypoint graph + BFS
// that bots navigate with. All gameplay queries (LOS, path) live here.
import * as THREE from 'three';
import { PALETTE, makeConcreteTexture, makeGroundTexture, makeSteelTexture, makeHazardTexture, makeSignTexture, makeGlowTexture } from './palette.js';

// Wall = axis-aligned box {x0,z0,x1,z1,h}. y is always 0..h.
export const WALLS = [
  // perimeter
  { x0: -32, z0: -23, x1: 32, z1: -22, h: 6 }, { x0: -32, z0: 22, x1: 32, z1: 23, h: 6 },
  { x0: -32, z0: -23, x1: -31, z1: 23, h: 6 }, { x0: 31, z0: -23, x1: 32, z1: 23, h: 6 },
  // spawn walls with side gaps (block spawn-to-spawn sightlines)
  { x0: -14, z0: 17.4, x1: 14, z1: 18.2, h: 3.4 },
  { x0: -14, z0: -18.2, x1: 14, z1: -17.4, h: 3.4 },
  // mid-lane cover blocks
  { x0: -1.2, z0: 4, x1: 1.2, z1: 7, h: 1.4 },
  { x0: -1.2, z0: -7, x1: 1.2, z1: -4, h: 1.4 },
  { x0: -9, z0: -1.2, x1: -6, z1: 1.2, h: 1.2 },
  { x0: 6, z0: -1.2, x1: 9, z1: 1.2, h: 1.2 },
  // west lane (A side) structures
  { x0: -26, z0: -4, x1: -22, z1: -2, h: 2.6 },
  { x0: -26, z0: 6, x1: -23, z1: 8, h: 1.3 },
  { x0: -18, z0: -12, x1: -15, z1: -9, h: 2.2 },
  { x0: -29, z0: -18, x1: -27, z1: -8, h: 4.5 }, // crane bay back wall segment
  // east lane (B side) structures
  { x0: 22, z0: -4, x1: 26, z1: -2, h: 2.6 },
  { x0: 23, z0: 6, x1: 26, z1: 8, h: 1.3 },
  { x0: 15, z0: -12, x1: 18, z1: -9, h: 2.2 },
  { x0: 27, z0: -18, x1: 29, z1: -8, h: 4.5 }, // furnace hall back wall segment
  // cross-corridor blocks
  { x0: -12, z0: 11, x1: -9, z1: 13.5, h: 2.4 },
  { x0: 9, z0: 11, x1: 12, z1: 13.5, h: 2.4 },
  { x0: -12, z0: -13.5, x1: -9, z1: -11, h: 2.4 },
  { x0: 9, z0: -13.5, x1: 12, z1: -11, h: 2.4 },
  // site A crane base + furnace B body (tall, block sight)
  { x0: -28.5, z0: -17, x1: -25.5, z1: -14.5, h: 5 },
  { x0: 25.5, z0: -17, x1: 28.5, z1: -14.5, h: 5 },
];
export const SITES = {
  A: { name: 'CRANE BAY', x: -24, z: -14, r: 4.5, color: PALETTE.siteA },
  B: { name: 'FURNACE HALL', x: 24, z: -14, r: 4.5, color: PALETTE.siteB },
};
export const SPAWNS = {
  vanguard: { x: 0, z: 20, yaw: 0 },
  sentinel: { x: 0, z: -20, yaw: Math.PI },
};
// Waypoint graph: nodes + undirected edges, lanes + connectors.
const WP = [
  { x: 0, z: 20 },   // 0 vanguard spawn
  { x: -20, z: 16 }, // 1 west lane south
  { x: 20, z: 16 },  // 2 east lane south
  { x: 0, z: 10 },   // 3 mid south
  { x: -20, z: 2 },  // 4 west mid
  { x: 0, z: 0 },    // 5 mid
  { x: 20, z: 2 },   // 6 east mid
  { x: -20, z: -8 }, // 7 west north
  { x: 0, z: -10 },  // 8 mid north
  { x: 20, z: -8 },  // 9 east north
  { x: -24, z: -14 },// 10 site A
  { x: 24, z: -14 }, // 11 site B
  { x: 0, z: -20 },  // 12 sentinel spawn
  { x: -10, z: -14 },// 13 A connector
  { x: 10, z: -14 }, // 14 B connector
];
const EDGES = [
  [0, 1], [0, 3], [0, 2], [1, 4], [3, 5], [2, 6], [4, 7], [5, 8], [6, 9],
  [7, 10], [7, 13], [8, 13], [8, 14], [9, 14], [9, 11], [13, 10], [14, 11],
  [8, 12], [10, 12], [11, 12], [4, 5], [5, 6], [1, 3], [2, 3], [3, 4], [3, 6],
];

function segBlocked(x0, z0, x1, z1) {
  // 2D segment vs wall AABBs (walls taller than eye block sight; low cover
  // blocks bullets at crouch height but sight is checked at eye 1.6 m).
  for (const w of WALLS) {
    if (w.h < 1.6) continue;
    if (segHitsBox(x0, z0, x1, z1, w)) return true;
  }
  return false;
}
function segHitsBox(x0, z0, x1, z1, b) {
  // slab test on the segment
  const dx = x1 - x0, dz = z1 - z0;
  let t0 = 0, t1 = 1;
  for (const [o, d, lo, hi] of [[x0, dx, b.x0, b.x1], [z0, dz, b.z0, b.z1]]) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; }
    else {
      let a = (lo - o) / d, c = (hi - o) / d;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      if (t0 > t1) return false;
    }
  }
  return true;
}

export function hasLOS(x0, z0, x1, z1) { return !segBlocked(x0, z0, x1, z1); }

export function nearestWaypoint(x, z) {
  let best = 0, bd = Infinity;
  WP.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}
export function findPath(ax, az, bx, bz) {
  const start = nearestWaypoint(ax, az), goal = nearestWaypoint(bx, bz);
  if (start === goal) return [{ x: bx, z: bz }];
  const prev = new Array(WP.length).fill(-1);
  const q = [start]; prev[start] = start;
  while (q.length) {
    const n = q.shift();
    if (n === goal) break;
    for (const [a, b] of EDGES) {
      const m = a === n ? b : b === n ? a : -1;
      if (m >= 0 && prev[m] === -1) { prev[m] = n; q.push(m); }
    }
  }
  if (prev[goal] === -1) return [{ x: bx, z: bz }];
  const nodes = [];
  for (let n = goal; n !== start; n = prev[n]) nodes.unshift(WP[n]);
  nodes.unshift(WP[start]);
  nodes.push({ x: bx, z: bz });
  return nodes;
}

// Ray (origin + t*dir) vs walls, 3D slab test. Returns {t, wall} or null.
export function rayWalls(ox, oy, oz, dx, dy, dz, maxT) {
  let best = null;
  for (const w of WALLS) {
    let t0 = 0, t1 = maxT;
    const axes = [[ox, dx, w.x0, w.x1], [oy, dy, 0, w.h], [oz, dz, w.z0, w.z1]];
    let ok = true;
    for (const [o, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { ok = false; break; } }
      else {
        let a = (lo - o) / d, c = (hi - o) / d;
        if (a > c) [a, c] = [c, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, c);
        if (t0 > t1) { ok = false; break; }
      }
    }
    if (ok && t0 >= 0 && (best === null || t0 < best.t)) best = { t: t0, wall: w };
  }
  return best;
}

export function buildWorld(scene) {
  const concrete = makeConcreteTexture(), ground = makeGroundTexture();
  const steel = makeSteelTexture(), hazard = makeHazardTexture();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 30, 95);

  const hemi = new THREE.HemisphereLight(0x8a7bb8, 0x2a2118, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xff9a5e, 1.5);
  sun.position.set(-30, 38, 12); scene.add(sun);
  const lampA = new THREE.PointLight(0x37c8a5, 30, 26, 1.6);
  lampA.position.set(SITES.A.x, 5, SITES.A.z); scene.add(lampA);
  const lampB = new THREE.PointLight(0xffb45e, 34, 26, 1.6);
  lampB.position.set(SITES.B.x, 5, SITES.B.z); scene.add(lampB);
  const lampMid = new THREE.PointLight(0xffc861, 22, 24, 1.6);
  lampMid.position.set(0, 6, 0); scene.add(lampMid);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 46),
    new THREE.MeshStandardMaterial({ map: ground, roughness: 0.92, metalness: 0.08 }),
  );
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  scene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.9 });
  const steelMat = new THREE.MeshStandardMaterial({ map: steel, roughness: 0.55, metalness: 0.6 });
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.8 });
  const crateMat = new THREE.MeshStandardMaterial({ color: PALETTE.crate, roughness: 0.85 });
  const group = new THREE.Group();
  const box = (x0, z0, x1, z1, h, mat, y0 = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, h, z1 - z0), mat);
    m.position.set((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
    m.castShadow = false; m.receiveShadow = true;
    group.add(m); return m;
  };
  for (const w of WALLS) {
    const tall = w.h >= 4.5;
    box(w.x0, w.z0, w.x1, w.z1, w.h, tall ? steelMat : wallMat);
    if (w.h <= 1.4) box(w.x0, w.z0, w.x1, w.z1, 0.12, hazardMat, w.h); // hazard cap on low cover
  }
  // crates scattered for cover + readability
  const crates = [[-6, 13, 1.6], [7, 14, 1.2], [-13, -2, 1.4], [13, -3, 1.8], [-4, -15, 1.2], [4, -15, 1.2], [-27, 4, 1.5], [27, 4, 1.5]];
  for (const [x, z, s] of crates) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
    c.position.set(x, s / 2, z); c.rotation.y = (x * 7 + z * 3) % 1.2;
    group.add(c);
  }
  // Site A crane: mast + jib arm over the bay
  const craneMat = new THREE.MeshStandardMaterial({ color: 0xc8a03a, roughness: 0.5, metalness: 0.7 });
  const mast = new THREE.Mesh(new THREE.BoxGeometry(1.2, 11, 1.2), craneMat);
  mast.position.set(-27, 5.5, -16); group.add(mast);
  const jib = new THREE.Mesh(new THREE.BoxGeometry(10, 0.7, 0.7), craneMat);
  jib.position.set(-22, 10.4, -16); group.add(jib);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 0.5), steelMat);
  hook.position.set(-18.5, 9, -16); group.add(hook);
  // Site B furnace: glowing mouth + chimney
  const furnMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.5 });
  const furn = new THREE.Mesh(new THREE.BoxGeometry(3, 5, 3), furnMat);
  furn.position.set(27, 2.5, -16); group.add(furn);
  const mouth = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 1.6),
    new THREE.MeshBasicMaterial({ color: 0xff7a1e }),
  );
  mouth.position.set(27, 1.4, -14.45); group.add(mouth);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 9, 10), steelMat);
  chimney.position.set(28.5, 4.5, -18); group.add(chimney);
  // Site floor decals + signs
  const decal = (site, letter, sub) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.35, site.r, 40),
      new THREE.MeshBasicMaterial({ color: site.color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2; ring.position.set(site.x, 0.03, site.z);
    group.add(ring);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 3.4),
      new THREE.MeshBasicMaterial({ map: makeSignTexture(letter, sub, letter === 'A' ? '#37c8a5' : '#e8b73a'), transparent: true }),
    );
    sign.position.set(site.x, 3.6, -21.9); group.add(sign);
  };
  decal(SITES.A, 'A', 'CRANE BAY');
  decal(SITES.B, 'B', 'FURNACE HALL');
  // dusk skyline silhouettes outside the walls
  const glow = makeGlowTexture();
  const silMat = new THREE.MeshStandardMaterial({ color: 0x1c1626, roughness: 1 });
  for (let i = 0; i < 14; i++) {
    const w = 4 + ((i * 37) % 7), h = 8 + ((i * 53) % 16);
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), silMat);
    const ang = (i / 14) * Math.PI * 2;
    b.position.set(Math.cos(ang) * 48, h / 2 - 1, Math.sin(ang) * 42);
    group.add(b);
  }
  // lamp glow sprites
  for (const [x, y, z, col] of [[SITES.A.x, 5, SITES.A.z, 0x37c8a5], [SITES.B.x, 5, SITES.B.z, 0xffb45e], [0, 6, 0, 0xffc861]]) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: col, transparent: true, opacity: 0.5, depthWrite: false }));
    sp.position.set(x, y, z); sp.scale.set(6, 6, 1); group.add(sp);
  }
  scene.add(group);
  return { walls: WALLS, sites: SITES, spawns: SPAWNS, group };
}
