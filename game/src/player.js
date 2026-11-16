// player.js — the AABB mover shared by the player and the bots.
// One job: acceleration, friction, gravity, jump/crouch/sprint and
// collision against the world's wall boxes. No rendering, no input.
import { WALLS } from './world.js';

export const EYE_STAND = 1.62, EYE_CROUCH = 1.05, RADIUS = 0.42;
const WALK = 4.25, SPRINT = 6.4, CROUCH_SPEED = 2.2, ACCEL = 60, AIR_ACCEL = 18;
const FRICTION = 11, GRAVITY = 22, JUMP_V = 7.2;

export function eyeHeight(f) { return f.crouch ? EYE_CROUCH : EYE_STAND; }
export function eyePos(f) { return { x: f.x, y: f.y + eyeHeight(f), z: f.z }; }

// move: {forward, back, left, right, sprint, crouch, jump} in [-1..1] each.
// yaw 0 faces -Z (toward the Sentinel spawn from the Vanguard side).
export function stepFighter(f, move, dt) {
  f.crouch = !!move.crouch;
  const speed = f.crouch ? CROUCH_SPEED : (move.sprint ? SPRINT : WALK);
  const sin = Math.sin(f.yaw), cos = Math.cos(f.yaw);
  // forward = (-sin, -cos), right = (cos, -sin) in XZ
  let mx = (-sin * (move.forward - move.back)) + (cos * (move.right - move.left));
  let mz = (-cos * (move.forward - move.back)) + (-sin * (move.right - move.left));
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const grounded = f.y <= 0.001;
  const acc = grounded ? ACCEL : AIR_ACCEL;
  f.vx = f.vx ?? 0; f.vz = f.vz ?? 0;
  // accelerate toward the target speed along the wish direction
  f.vx += mx * acc * dt * (speed / WALK);
  f.vz += mz * acc * dt * (speed / WALK);
  // clamp horizontal speed to the target speed
  const hs = Math.hypot(f.vx, f.vz);
  if (hs > speed && len > 0) { f.vx = (f.vx / hs) * speed; f.vz = (f.vz / hs) * speed; }
  // friction when no input: linear decay to a stop
  if (len === 0 && grounded && hs > 0) {
    const k = Math.max(0, hs - FRICTION * dt) / hs;
    f.vx *= k; f.vz *= k;
  }
  if (move.jump && grounded) { f.vy = JUMP_V; }
  f.vy -= GRAVITY * dt;
  f.y += f.vy * dt;
  if (f.y <= 0) { f.y = 0; f.vy = 0; }
  // integrate + collide per axis (circle vs expanded AABB)
  moveAxis(f, f.vx * dt, 0);
  moveAxis(f, 0, f.vz * dt);
  f.speed = Math.hypot(f.vx, f.vz);
  return f;
}

function moveAxis(f, dx, dz) {
  if (dx === 0 && dz === 0) return;
  const nx = f.x + dx, nz = f.z + dz;
  for (const w of WALLS) {
    if (w.h < 0.5) continue;
    const cx = Math.max(w.x0, Math.min(nx, w.x1));
    const cz = Math.max(w.z0, Math.min(nz, w.z1));
    const ddx = nx - cx, ddz = nz - cz;
    if (ddx * ddx + ddz * ddz < RADIUS * RADIUS) {
      // resolve: cancel the axis that penetrated
      if (dx !== 0) { f.vx = 0; return; }
      if (dz !== 0) { f.vz = 0; return; }
    }
  }
  f.x = nx; f.z = nz;
}
