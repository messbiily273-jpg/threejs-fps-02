// ballistics.js — hitscan fire, tracers, sparks, grenades.
// One job: decide what a shot (or a grenade) hits and what it does.
// Head x4 / body x1 / legs x0.75. Armor halves the damage that gets through.
import * as THREE from 'three';
import { WEAPONS, GRENADES } from './state.js';
import { rayWalls, hasLOS } from './world.js';
import { eyePos } from './player.js';
import { currentSpread, spendShot, canFire } from './weapons.js';

const HEAD_R = 0.21, BODY_R = 0.48, LEG_R = 0.4;
const HEAD_Y = 1.55, BODY_Y = 1.0, LEG_Y = 0.42;

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return -1;
  const thc = Math.sqrt(r * r - d2);
  return tca - thc;
}

// Direction from a fighter's eye with spread applied (rng-driven).
export function aimDir(f, rng) {
  const w = WEAPONS[f.current];
  const sp = currentSpread(f, w);
  const yaw = f.yaw + (rng() - 0.5) * 2 * sp;
  const pitch = f.pitch + (rng() - 0.5) * 2 * sp;
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

// Fire one hitscan shot. Returns {hit, victim, zone, damage} or null.
export function shoot(state, shooter, scene, fx) {
  const now = state.time;
  if (!canFire(shooter, now)) return null;
  spendShot(shooter, now);
  state.stats.shots += 1;
  const w = WEAPONS[shooter.current];
  const eye = eyePos(shooter);
  const dir = aimDir(shooter, state.rng);
  const wall = rayWalls(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, w.range);
  const wallT = wall ? wall.t : w.range;
  // find the nearest fighter sphere inside wall range
  let best = null;
  const targets = [state.player, ...state.bots];
  for (const t of targets) {
    if (t === shooter || !t.alive) continue;
    const zones = [
      { zone: 'head', t: raySphere(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, t.x, t.y + HEAD_Y, t.z, HEAD_R), mult: w.headMult },
      { zone: 'body', t: raySphere(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, t.x, t.y + BODY_Y, t.z, BODY_R), mult: 1 },
      { zone: 'legs', t: raySphere(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, t.x, t.y + LEG_Y, t.z, LEG_R), mult: 0.75 },
    ];
    for (const z of zones) {
      if (z.t > 0 && z.t < wallT && (best === null || z.t < best.t)) {
        best = { t: z.t, victim: t, zone: z.zone, mult: z.mult };
      }
    }
  }
  const endT = best ? best.t : wallT;
  const end = { x: eye.x + dir.x * endT, y: eye.y + dir.y * endT, z: eye.z + dir.z * endT };
  if (fx) fx.tracer(shooter, eye, end);
  if (!best) { if (fx) fx.impact(end, false); return { hit: false }; }
  let dmg = w.damage * best.mult;
  if (best.victim.armor > 0) dmg *= 0.5; // armor halves damage
  dmg = Math.round(dmg);
  applyDamage(state, best.victim, dmg, shooter, best.zone, fx);
  state.stats.hits += 1;
  return { hit: true, victim: best.victim, zone: best.zone, damage: dmg };
}

export function applyDamage(state, victim, dmg, attacker, zone, fx) {
  if (!victim.alive) return;
  if (victim.armor > 0) {
    const absorbed = Math.min(victim.armor, Math.ceil(dmg / 2));
    victim.armor -= absorbed;
  }
  victim.hp -= dmg;
  if (fx) fx.hitmarker(attacker, victim, zone);
  if (victim.hp <= 0) {
    victim.hp = 0; victim.alive = false; victim.deaths += 1;
    if (attacker) attacker.kills += 1;
    state.killfeed.unshift({ killer: attacker ? attacker.name : '—', victim: victim.name, zone, head: zone === 'head', t: state.time });
    state.killfeed = state.killfeed.slice(0, 5);
    if (attacker && attacker.isPlayer) {
      attacker.money += 300;
      if (fx) fx.kill(attacker);
    }
    if (fx) fx.death(victim);
  } else if (victim.isPlayer && fx) {
    fx.hurt(attacker);
  }
}

// ---- grenades ----
export function throwGrenade(state, thrower, kind) {
  const g = GRENADES[kind];
  if (!g || (thrower.grenades[kind] || 0) <= 0) return false;
  thrower.grenades[kind] -= 1;
  const eye = eyePos(thrower);
  const cp = Math.cos(thrower.pitch);
  const dir = { x: -Math.sin(thrower.yaw) * cp, y: Math.sin(thrower.pitch) + 0.35, z: -Math.cos(thrower.yaw) * cp };
  state.grenadesLive.push({
    kind, x: eye.x, y: eye.y - 0.1, z: eye.z,
    vx: dir.x * 13, vy: dir.y * 13 + 2.5, vz: dir.z * 13,
    t: 0, fuse: g.fuse, owner: thrower,
  });
  state.stats.grenadesThrown += 1;
  return true;
}

export function updateGrenades(state, dt, fx) {
  for (const g of state.grenadesLive) {
    g.t += dt;
    g.vy -= 16 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    if (g.y < 0.15) { g.y = 0.15; g.vy *= -0.35; g.vx *= 0.6; g.vz *= 0.6; }
    if (g.x < -31.5 || g.x > 31.5) g.vx *= -0.5;
    if (g.z < -22.5 || g.z > 22.5) g.vz *= -0.5;
    if (g.t >= g.fuse) {
      g.done = true;
      explode(state, g, fx);
    }
  }
  state.grenadesLive = state.grenadesLive.filter((g) => !g.done);
  // smoke lifetime
  for (const s of state.smokes) s.t += dt;
  state.smokes = state.smokes.filter((s) => s.t < GRENADES.smoke.life);
  for (const f of state.flashes) f.t += dt;
  state.flashes = state.flashes.filter((f) => f.t < GRENADES.flash.life);
}

function explode(state, g, fx) {
  state.stats.grenadesExploded += 1;
  const def = GRENADES[g.kind];
  if (g.kind === 'he') {
    if (fx) fx.explosion(g);
    for (const t of [state.player, ...state.bots]) {
      if (!t.alive || t === g.owner) continue;
      const d = Math.hypot(t.x - g.x, t.z - g.z);
      if (d < def.radius) {
        const dmg = Math.round(def.maxDmg * (1 - d / def.radius) + 10);
        applyDamage(state, t, dmg, g.owner, 'body', fx);
      }
    }
  } else if (g.kind === 'smoke') {
    state.smokes.push({ x: g.x, z: g.z, r: def.radius, t: 0 });
    if (fx) fx.smoke(g);
  } else if (g.kind === 'flash') {
    state.flashes.push({ x: g.x, y: g.y, z: g.z, t: 0, team: g.owner.team });
    if (fx) fx.flash(g);
  }
}

// Smoke blocks sight: any smoke disc between two points blocks LOS.
export function smokeBlocks(x0, z0, x1, z1, state) {
  for (const s of state.smokes) {
    const dx = x1 - x0, dz = z1 - z0;
    const len2 = dx * dx + dz * dz;
    if (len2 === 0) continue;
    let t = ((s.x - x0) * dx + (s.z - z0) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = x0 + dx * t, pz = z0 + dz * t;
    if (Math.hypot(px - s.x, pz - s.z) < s.r) return true;
  }
  return false;
}
export function canSee(a, b, state) {
  return hasLOS(a.x, a.z, b.x, b.z) && !smokeBlocks(a.x, a.z, b.x, b.z, state);
}
