// bots.js — the 9-bot AI: push / hold / engage / plant / defuse.
// One job: make every non-player fighter move, see, hear and shoot back.
// Bots navigate with world.js BFS, see with LOS + FOV, hear gunfire, and
// fire in bursts whose accuracy falls with distance and movement.
import { WEAPONS, FLOW } from './state.js';
import { stepFighter } from './player.js';
import { findPath, hasLOS, SITES } from './world.js';
import { shoot, canSee, smokeBlocks } from './ballistics.js';
import { startReload, updateWeapon, switchWeapon } from './weapons.js';

const BOT_NAMES_V = ['Rook', 'Havoc', 'Juno', 'Moss'];
const BOT_NAMES_S = ['Bastion', 'Ferro', 'Kite', 'Sable', 'Wren'];
const HOLD_SPOTS_S = [
  { x: -20, z: -8 }, { x: 0, z: -10 }, { x: 20, z: -8 }, { x: -10, z: -14 }, { x: 10, z: -14 },
];
const FOV = 1.9; // ~109 degrees total

export function createBots(state) {
  const bots = [];
  BOT_NAMES_V.forEach((n, i) => {
    const b = botFighter(state, 'vanguard', n, -6 + i * 4, 20);
    b.bot = { role: i === 0 ? 'carrier' : 'push', site: i < 2 ? 'A' : 'B', path: null, pathI: 0, thinkT: i * 0.2, burst: 0, burstT: 0, target: null, hearX: 0, hearZ: 0, hearT: -99, holdX: 0, holdZ: 0 };
    bots.push(b);
  });
  BOT_NAMES_S.forEach((n, i) => {
    const b = botFighter(state, 'sentinel', n, -8 + i * 4, -20);
    b.bot = { role: 'hold', site: i < 3 ? 'A' : 'B', path: null, pathI: 0, thinkT: i * 0.2, burst: 0, burstT: 0, target: null, hearX: 0, hearZ: 0, hearT: -99, holdX: HOLD_SPOTS_S[i].x, holdZ: HOLD_SPOTS_S[i].z };
    bots.push(b);
  });
  return bots;
}
function botFighter(state, team, name, x, z) {
  const f = {
    team, name, isPlayer: false, x, z, y: 0, vy: 0, vx: 0, vz: 0,
    yaw: team === 'vanguard' ? 0 : Math.PI, pitch: 0,
    hp: 100, armor: 0, alive: true, crouch: false, speed: 0,
    money: 800,
    weapons: { p9: { mag: 15, reserve: 60 } }, current: 'p9',
    lastShot: -9, reloading: 0, reloadEnd: 0, spreadBloom: 0, recoil: 0,
    grenades: { he: 0, smoke: 0, flash: 0 }, selectedGrenade: null,
    planting: false, plantT: 0, defusing: false, defuseT: 0,
    kills: 0, deaths: 0, bot: null,
  };
  // buy a real gun with round money (bots start with the same $800 + win pay)
  const pick = team === 'vanguard' ? ['vk9', 'ar77', 'vk9', 'p9'][BOT_NAMES_V.indexOf(name)] : ['ar77', 'vk9', 'vk9', 'ar77', 'p9'][BOT_NAMES_S.indexOf(name)];
  giveBotGun(f, pick);
  return f;
}
export function giveBotGun(f, id) {
  const w = WEAPONS[id];
  f.weapons[id] = { mag: w.mag, reserve: w.reserve };
  f.current = id;
}

// Hearing: a shot tells nearby enemies roughly where it came from.
export function hearShot(state, shooter) {
  for (const b of state.bots) {
    if (!b.alive || b.team === shooter.team) continue;
    const d = Math.hypot(b.x - shooter.x, b.z - shooter.z);
    if (d < 30) { b.bot.hearX = shooter.x; b.bot.hearZ = shooter.z; b.bot.hearT = state.time; }
  }
}

function visibleEnemy(state, bot) {
  // nearest living enemy inside FOV + LOS (+ smoke) and 45 m
  let best = null, bd = Infinity;
  const foes = [state.player, ...state.bots].filter((f) => f.alive && f.team !== bot.team);
  for (const f of foes) {
    const dx = f.x - bot.x, dz = f.z - bot.z;
    const d = Math.hypot(dx, dz);
    if (d > 45 || d > bd) continue;
    const ang = Math.atan2(-dx, -dz); // yaw that faces the foe
    let diff = ang - bot.yaw;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    if (Math.abs(diff) > FOV / 2) continue;
    if (!canSee(bot, f, state)) continue;
    best = f; bd = d;
  }
  return best ? { foe: best, dist: bd } : null;
}

function aimAt(bot, tx, tz, ty = 1.2) {
  const dx = tx - bot.x, dz = tz - bot.z;
  bot.yaw = Math.atan2(-dx, -dz);
  const d = Math.hypot(dx, dz);
  bot.pitch = Math.atan2(ty - 1.62, Math.max(d, 0.5));
}

function followPath(bot, dt) {
  const b = bot.bot;
  if (!b.path || b.pathI >= b.path.length) return { forward: 0, back: 0, left: 0, right: 0, sprint: false, crouch: false, jump: false };
  const wp = b.path[b.pathI];
  const dx = wp.x - bot.x, dz = wp.z - bot.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.9) { b.pathI += 1; return { forward: 0, back: 0, left: 0, right: 0, sprint: false, crouch: false, jump: false }; }
  bot.yaw = Math.atan2(-dx, -dz);
  return { forward: 1, back: 0, left: 0, right: 0, sprint: d > 12, crouch: false, jump: false };
}

export function updateBots(state, dt, fx) {
  if (state.testMode) return; // scripted harness drives bots directly
  const bomb = state.bomb;
  for (const bot of state.bots) {
    if (!bot.alive) continue;
    const b = bot.bot;
    b.thinkT -= dt;
    // --- think (4 Hz): pick a destination / role target ---
    if (b.thinkT <= 0) {
      b.thinkT = 0.25;
      const seen = visibleEnemy(state, bot);
      b.target = seen ? seen.foe : null;
      if (bomb.state === 'planted' && bot.team === 'sentinel') {
        b.role = 'defuse';
        b.path = findPath(bot.x, bot.z, bomb.x, bomb.z); b.pathI = 0;
      } else if (bomb.state === 'planted' && bot.team === 'vanguard') {
        b.role = 'guard';
        const site = SITES[bomb.site];
        b.path = findPath(bot.x, bot.z, site.x + (state.rng() - 0.5) * 6, site.z + (state.rng() - 0.5) * 6); b.pathI = 0;
      } else if (bot.team === 'vanguard') {
        if (b.role === 'carrier' && state.player.alive && state.player !== bot) { /* player carries */ }
        const site = SITES[b.site];
        const gx = site.x + (state.rng() - 0.5) * 4, gz = site.z + (state.rng() - 0.5) * 4;
        if (!b.path || b.pathI >= b.path.length) { b.path = findPath(bot.x, bot.z, gx, gz); b.pathI = 0; }
      } else {
        // sentinel hold: return to hold spot unless recently heard shots
        if (state.time - b.hearT < 6 && !b.target) {
          if (!b.path || b.pathI >= b.path.length) { b.path = findPath(bot.x, bot.z, b.hearX, b.hearZ); b.pathI = 0; }
        } else if (Math.hypot(bot.x - b.holdX, bot.z - b.holdZ) > 2) {
          if (!b.path || b.pathI >= b.path.length) { b.path = findPath(bot.x, bot.z, b.holdX, b.holdZ); b.pathI = 0; }
        }
      }
    }
    // --- plant / defuse channels ---
    if (b.role === 'carrier' && bomb.state === 'none' && bot.team === 'vanguard' && !state.player.alive) {
      const site = SITES[b.site];
      if (Math.hypot(bot.x - site.x, bot.z - site.z) < site.r && !b.target) {
        bot.planting = true; bot.plantT += dt;
        if (bot.plantT >= FLOW.plantTime) {
          bomb.state = 'planted'; bomb.site = b.site; bomb.x = site.x; bomb.z = site.z; bomb.fuseT = FLOW.fuseTime;
          bot.planting = false; bot.plantT = 0;
          if (fx) fx.planted(bomb.site);
        }
      } else { bot.planting = false; bot.plantT = 0; }
    }
    if (b.role === 'defuse' && bomb.state === 'planted') {
      if (Math.hypot(bot.x - bomb.x, bot.z - bomb.z) < 2.5 && !b.target) {
        bot.defusing = true; bot.defuseT += dt;
        if (bot.defuseT >= FLOW.defuseTime) {
          bomb.state = 'defused'; bot.defusing = false; bot.defuseT = 0;
          if (fx) fx.defused();
        }
      } else { bot.defusing = false; bot.defuseT = 0; }
    }
    // --- combat: aim + burst fire at a visible enemy ---
    let move = { forward: 0, back: 0, left: 0, right: 0, sprint: false, crouch: false, jump: false };
    const seen = b.target ? visibleEnemy(state, bot) : null;
    if (seen) {
      const { foe, dist } = seen;
      aimAt(bot, foe.x, foe.z, foe.y + 1.1);
      // burst fire: 3-5 shots, then a pause; accuracy falls with distance
      b.burstT -= dt;
      if (b.burst <= 0 && b.burstT <= 0) { b.burst = 3 + Math.floor(state.rng() * 3); b.burstT = 0.5 + state.rng() * 0.9; }
      if (b.burst > 0 && state.time - bot.lastShot > WEAPONS[bot.current].interval) {
        // bot-vs-bot accuracy halved so rounds last; moving target harder
        const moving = (foe.speed || 0) > 2;
        let hitP = Math.max(0.12, 0.62 - dist * 0.011 - (moving ? 0.18 : 0));
        if (foe.team === 'vanguard' && !foe.isPlayer) hitP *= 0.55;
        if (foe.isPlayer) hitP *= 0.8;
        bot.spreadBloom = 0;
        // aim error: miss by steering the shot off-target
        const saveYaw = bot.yaw, savePitch = bot.pitch;
        if (state.rng() > hitP) {
          bot.yaw += (state.rng() - 0.5) * 0.3;
          bot.pitch += (state.rng() - 0.5) * 0.12;
        }
        const res = shoot(state, bot, null, fx);
        bot.yaw = saveYaw; bot.pitch = savePitch;
        b.burst -= 1;
        if (res && res.hit) hearShot(state, bot);
        if (bot.weapons[bot.current].mag === 0) startReload(bot, state.time);
      }
      // strafe a little while fighting, hold ground otherwise
      if (dist > 14) move.forward = 1;
      else if (dist < 6) move.back = 1;
      else move = { forward: 0, back: 0, left: state.rng() > 0.5 ? 1 : 0, right: 0, sprint: false, crouch: false, jump: false };
    } else {
      move = followPath(bot, dt);
      // scan: slow yaw sweep while holding
      if (!b.path || b.pathI >= b.path.length) bot.yaw += dt * 0.35;
    }
    if (bot.reloading === 0 && bot.weapons[bot.current].mag === 0) startReload(bot, state.time);
    updateWeapon(bot, dt, state.time);
    stepFighter(bot, move, dt);
  }
}
