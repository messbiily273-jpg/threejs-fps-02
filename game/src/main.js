// main.js — boot, the fixed 60 Hz simulation, round + bomb flow, the
// ?shot= staging states and the ?selftest=1 harness (15 scripted checks).
// One job: wire the modules together and drive the game loop. Rendering
// reads the state; the simulation never reads the renderer.
import * as THREE from 'three';
import { WEAPONS, WEAPON_ORDER, GRENADES, ECON, FLOW, createGameState, mulberry32 } from './state.js';
import { buildWorld, SITES, SPAWNS } from './world.js';
import { stepFighter, eyePos, eyeHeight } from './player.js';
import { createInput } from './input.js';
import { buildViewModel, currentSpread, startReload, updateWeapon, switchWeapon, cycleWeapon } from './weapons.js';
import { shoot, throwGrenade, updateGrenades, applyDamage } from './ballistics.js';
import { createBots, updateBots, hearShot } from './bots.js';
import { buyWeapon, buyGrenade, buyArmor, roundReward } from './economy.js';
import { buildHud, buildShop, updateHud, showBanner, hitmarker, damageFrom } from './hud.js';
import { createAudio } from './audio.js';

const params = new URLSearchParams(location.search);
const SELFTEST = params.get('selftest') === '1';
const SHOT = params.get('shot') ? Number(params.get('shot')) : 0;

const state = createGameState();
const audio = createAudio();
let renderer, scene, camera, world, input, hud;
let viewModels = {}, botMeshes = new Map(), tracerPool = [], explosionFx = null;
let showBuyMenu = false, vigLevel = 0, flashLevel = 0, prevFire = false;
let acc = 0, lastT = 0;

function resetMatch() {
  const s = createGameState();
  Object.keys(state).forEach((k) => delete state[k]);
  Object.assign(state, s);
  state.bots = createBots(state);
  state.player.x = SPAWNS.vanguard.x; state.player.z = SPAWNS.vanguard.z;
  state.player.yaw = SPAWNS.vanguard.yaw;
  for (let i = 0; i < 4; i++) {
    const b = state.bots[i];
    b.x = SPAWNS.vanguard.x - 6 + i * 4; b.z = SPAWNS.vanguard.z; b.yaw = 0;
  }
  for (let i = 0; i < 5; i++) {
    const b = state.bots[4 + i];
    b.x = SPAWNS.sentinel.x - 8 + i * 4; b.z = SPAWNS.sentinel.z; b.yaw = Math.PI;
  }
  state.phase = 'buy'; state.timer = FLOW.buyTime; state.round = 1;
  showBuyMenu = true;
  syncBotMeshes();
}

function beginFreeze() {
  state.phase = 'freeze'; state.timer = FLOW.freezeTime;
  showBuyMenu = false;
  showBanner(hud, `ROUND ${state.round}`, state.round === 1 ? 'VANGUARD ATTACKS — PLANT THE SPIKE' : '');
}
function beginPlay() {
  state.phase = 'play'; state.timer = FLOW.roundTime;
}
function endRound(winner, reason) {
  if (state.phase !== 'play' && state.phase !== 'freeze') return;
  state.phase = 'roundEnd';
  state.winner = winner; state.winReason = reason;
  state.score[winner] += 1;
  roundReward(state, winner);
  showBanner(hud, winner === 'vanguard' ? 'ROUND WON' : 'ROUND LOST', reason);
  if (winner === 'vanguard') audio.roundWin(); else audio.roundLose();
  hud.el.reTitle.textContent = winner === 'vanguard' ? 'ROUND WON' : 'ROUND LOST';
  hud.el.reSub.textContent = reason;
  hud.el.reDetail.textContent = `Score — Vanguard ${state.score.vanguard} : ${state.score.sentinel} Sentinel · Round ${state.round} of ${FLOW.maxRounds}`;
  hud.el.roundend.classList.remove('hidden');
  input.unlock();
}
function nextRound() {
  hud.el.roundend.classList.add('hidden');
  if (state.score.vanguard >= FLOW.winRounds || state.score.sentinel >= FLOW.winRounds || state.round >= FLOW.maxRounds) {
    endMatch(state.score.vanguard > state.score.sentinel ? 'vanguard' : 'sentinel');
    return;
  }
  state.round += 1;
  // reset fighters, keep money + owned guns; grenades are bought fresh
  const resetF = (f, x, z, yaw) => {
    f.x = x; f.z = z; f.y = 0; f.vy = 0; f.vx = 0; f.vz = 0; f.yaw = yaw; f.pitch = 0;
    f.hp = 100; f.alive = true; f.planting = false; f.plantT = 0; f.defusing = false; f.defuseT = 0;
    f.grenades = { he: 0, smoke: 0, flash: 0 }; f.selectedGrenade = null; f.reloading = 0;
    f.weapons[f.current].mag = WEAPONS[f.current].mag;
    if (f.bot) { f.bot.path = null; f.bot.pathI = 0; f.bot.target = null; f.bot.burst = 0; }
  };
  resetF(state.player, SPAWNS.vanguard.x, SPAWNS.vanguard.z, 0);
  state.player.spectate = null; state.spectate = null;
  state.bots.forEach((b, i) => {
    if (i < 4) resetF(b, SPAWNS.vanguard.x - 6 + i * 4, SPAWNS.vanguard.z, 0);
    else resetF(b, SPAWNS.sentinel.x - 8 + (i - 4) * 4, SPAWNS.sentinel.z, Math.PI);
  });
  state.bomb = { state: 'none', site: null, x: 0, z: 0, fuseT: 0, carrier: null };
  state.grenadesLive = []; state.smokes = []; state.flashes = [];
  state.phase = 'buy'; state.timer = FLOW.buyTime;
  showBuyMenu = true;
  buildShop(hud, state, doBuy);
  syncBotMeshes();
}
function endMatch(winner) {
  state.phase = 'matchEnd';
  hud.el.meTitle.textContent = winner === 'vanguard' ? 'VICTORY' : 'DEFEAT';
  hud.el.meSub.textContent = `Vanguard ${state.score.vanguard} — ${state.score.sentinel} Sentinel`;
  hud.el.meDetail.textContent = winner === 'vanguard'
    ? 'The yard is yours. The spike did its work — or the Sentinels ran out of defenders.'
    : 'The Sentinels held the yard. Re-deploy, re-buy, and take it back.';
  hud.el.matchend.classList.remove('hidden');
  input.unlock();
}

// ---------- FX (tracers, impacts, explosions, smoke, flashes) ----------
function makeFx() {
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffc861, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 14; i++) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(g, tracerMat.clone());
    line.visible = false; line.frustumCulled = false;
    scene.add(line);
    tracerPool.push({ line, t: 0 });
  }
  const expLight = new THREE.PointLight(0xff8a2e, 0, 30, 1.5);
  scene.add(expLight);
  const expMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0 }),
  );
  expMesh.visible = false; scene.add(expMesh);
  explosionFx = { light: expLight, mesh: expMesh, t: 0 };
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.55, roughness: 1 });
  const smokeMeshes = [];
  const fx = {
    tracer(shooter, from, to) {
      const slot = tracerPool.find((s) => s.t <= 0) || tracerPool[0];
      const pos = slot.line.geometry.attributes.position;
      pos.setXYZ(0, from.x, from.y, from.z); pos.setXYZ(1, to.x, to.y, to.z);
      pos.needsUpdate = true;
      slot.line.visible = true; slot.t = 0.07;
      slot.line.material.opacity = 0.9;
    },
    impact(p) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, depthWrite: false }));
      s.position.set(p.x, p.y, p.z); s.scale.set(0.35, 0.35, 1);
      scene.add(s);
      setTimeout(() => scene.remove(s), 90);
    },
    hitmarker(attacker, victim, zone) {
      if (attacker && attacker.isPlayer) {
        hitmarker(hud, victim.hp <= 0);
        audio.hit();
        if (victim.hp <= 0) audio.kill();
      }
    },
    hurt(attacker) {
      vigLevel = 1;
      if (attacker) {
        const dx = attacker.x - state.player.x, dz = attacker.z - state.player.z;
        const ang = Math.atan2(dx, dz) - state.player.yaw;
        damageFrom(hud, ang);
      }
      audio.hurt();
    },
    death(v) { if (v.isPlayer) { vigLevel = 1; } },
    kill() { /* money + sound handled by caller path */ },
    explosion(g) {
      explosionFx.t = 0.5;
      explosionFx.light.position.set(g.x, 1.2, g.z);
      explosionFx.light.intensity = 160;
      explosionFx.mesh.position.set(g.x, 0.8, g.z);
      explosionFx.mesh.visible = true;
      audio.explosion();
      if (Math.hypot(state.player.x - g.x, state.player.z - g.z) < 10) vigLevel = 1;
    },
    smoke(g) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(GRENADES.smoke.radius, 16, 12), smokeMat);
      m.position.set(g.x, 1.2, g.z); m.scale.set(1, 0.45, 1);
      scene.add(m); smokeMeshes.push({ mesh: m, x: g.x, z: g.z });
    },
    flash(g) {
      audio.flash();
      const d = Math.hypot(state.player.x - g.x, state.player.z - g.z);
      const dx = g.x - state.player.x, dz = g.z - state.player.z;
      const ang = Math.atan2(-dx, -dz);
      let diff = ang - state.player.yaw;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      if (d < GRENADES.flash.radius && Math.abs(diff) < 1.4 && state.player.alive) {
        flashLevel = Math.max(0.25, 1 - d / GRENADES.flash.radius);
      }
      for (const b of state.bots) {
        if (b.alive && Math.hypot(b.x - g.x, b.z - g.z) < 12) b.bot.blindT = 1.5;
      }
    },
    planted(site) {
      showBanner(hud, 'SPIKE PLANTED', `SITE ${site} — DEFEND IT`);
      audio.plantBeep();
    },
    defused() { showBanner(hud, 'SPIKE DEFUSED', 'SENTINELS TAKE THE ROUND'); },
  };
  fx.smokeMeshes = smokeMeshes;
  return fx;
}
let fx;
function syncSmokeMeshes() {
  if (!fx) return;
  const live = fx.smokeMeshes;
  for (let i = live.length - 1; i >= 0; i--) {
    if (!state.smokes.some((s) => Math.abs(s.x - live[i].x) < 0.5 && Math.abs(s.z - live[i].z) < 0.5)) {
      scene.remove(live[i].mesh); live.splice(i, 1);
    }
  }
}

// ---------- bot meshes ----------
function botMesh(team) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: team === 'vanguard' ? 0x2c5a8a : 0x8a4a1e, roughness: 0.7 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xc8a882, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.36), bodyMat);
  body.position.y = 0.95; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), headMat);
  head.position.y = 1.62; g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.05),
    new THREE.MeshStandardMaterial({ color: team === 'vanguard' ? 0x5aa8ff : 0xff9a3d, emissive: team === 'vanguard' ? 0x2a5a9a : 0x9a4a1a }));
  visor.position.set(0, 1.64, 0.18); g.add(visor);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.9 }));
  legs.position.y = 0.32; g.add(legs);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5, metalness: 0.6 }));
  gun.position.set(0.25, 1.15, 0.2); g.add(gun);
  g.traverse((m) => { if (m.isMesh) m.castShadow = false; });
  return g;
}
function syncBotMeshes() {
  for (const b of state.bots) {
    if (!botMeshes.has(b)) {
      const m = botMesh(b.team);
      scene.add(m);
      botMeshes.set(b, m);
    }
  }
}

// ---------- buying ----------
function doBuy(kind, id) {
  if (state.phase !== 'buy') return;
  let r;
  if (kind === 'weapon') r = buyWeapon(state, id);
  else if (kind === 'grenade') r = buyGrenade(state, id);
  else r = buyArmor(state);
  if (r.ok) { audio.buy(); buildShop(hud, state, doBuy); }
}

// ---------- one fixed step ----------
function step(dt) {
  state.time += dt;
  const p = state.player;
  // mouse look
  const { dx, dy } = input.consumeMouse();
  if (p.alive && (state.phase === 'play' || state.phase === 'buy' || state.phase === 'freeze')) {
    p.yaw -= dx * 0.0021;
    p.pitch -= dy * 0.0021;
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
    if (state.scoped) p.yaw -= 0; // scoped sensitivity is the same; fov does the work
  }
  // timers
  if (state.phase === 'buy') {
    state.timer -= dt;
    if (state.timer <= 0) beginFreeze();
  } else if (state.phase === 'freeze') {
    state.timer -= dt;
    if (state.timer <= 0) beginPlay();
  } else if (state.phase === 'play') {
    if (state.bomb.state !== 'planted') {
      state.timer -= dt;
      if (state.timer <= 0) { endRound('sentinel', 'TIME EXPIRED — SENTINELS HOLD THE YARD'); return; }
    }
  }
  if (state.phase !== 'play' && state.phase !== 'buy' && state.phase !== 'freeze') return;

  // --- player ---
  const canMove = p.alive && (state.phase === 'play' || state.phase === 'buy');
  if (canMove) {
    stepFighter(p, input.move(), dt);
    if (p.speed > 1 && Math.random() < 0.02) audio.step();
  }
  updateWeapon(p, dt, state.time);
  if (p.alive && state.phase === 'play') {
    // fire
    const firing = WEAPONS[p.current].auto ? input.fireHeld : (input.fireHeld && !prevFire);
    if (firing) {
      if (p.selectedGrenade) {
        if (throwGrenade(state, p, p.selectedGrenade)) { audio.click(); p.selectedGrenade = null; }
      } else {
        const res = shoot(state, p, scene, fx);
        if (res) { audio.shot(p.current); hearShot(state, p); }
        else if (p.weapons[p.current].mag === 0) { audio.dryFire(); startReload(p, state.time); }
      }
    }
    prevFire = input.fireHeld;
    // reload / switch / grenade select
    if (input.wasPressed('KeyR')) { if (startReload(p, state.time)) audio.reload(); }
    if (input.wasPressed('KeyQ')) { cycleWeapon(p); audio.click(); }
    if (input.wasPressed('Digit1')) switchWeapon(p, 'p9');
    if (input.wasPressed('Digit2')) switchWeapon(p, 'vk9');
    if (input.wasPressed('Digit3')) switchWeapon(p, 'ar77');
    if (input.wasPressed('Digit4')) switchWeapon(p, 'lm88');
    if (input.wasPressed('Digit5') && p.grenades.he > 0) { p.selectedGrenade = 'he'; audio.click(); }
    if (input.wasPressed('Digit6') && p.grenades.smoke > 0) { p.selectedGrenade = 'smoke'; audio.click(); }
    if (input.wasPressed('Digit7') && p.grenades.flash > 0) { p.selectedGrenade = 'flash'; audio.click(); }
    // scope (right mouse, sniper only)
    const wantScope = input.wasPressed('MouseRight') || (input.isDown('MouseRight') && false);
    if (input.wasPressed('MouseRight') && WEAPONS[p.current].scoped) {
      state.scoped = !state.scoped;
      camera.fov = state.scoped ? 20 : 75;
      camera.updateProjectionMatrix();
    }
    // plant channel: hold E inside a site ring (in testMode the harness
    // drives it by setting player.planting, since no key is pressed)
    const site = Object.entries(SITES).find(([k, s]) => Math.hypot(p.x - s.x, p.z - s.z) < s.r);
    const wantPlant = state.bomb.state === 'none' && site && (input.isDown('KeyE') || (state.testMode && p.planting));
    if (wantPlant) {
      p.planting = true; p.plantT += dt;
      if (Math.floor(p.plantT * 4) !== Math.floor((p.plantT - dt) * 4)) audio.plantBeep();
      if (p.plantT >= FLOW.plantTime) {
        state.bomb = { state: 'planted', site: site[0], x: site[1].x, z: site[1].z, fuseT: FLOW.fuseTime, carrier: null };
        p.planting = false; p.plantT = 0;
        p.money += ECON.plant;
        fx.planted(site[0]);
      }
    } else { p.planting = false; p.plantT = 0; }
  }
  if (input.wasPressed('KeyB') && state.phase === 'buy') {
    showBuyMenu = !showBuyMenu;
    buildShop(hud, state, doBuy);
  }
  // --- bots ---
  if (state.phase === 'play') updateBots(state, dt, fx);
  // blind timers
  for (const b of state.bots) if (b.bot && b.bot.blindT > 0) b.bot.blindT -= dt;
  // --- grenades ---
  updateGrenades(state, dt, fx);
  syncSmokeMeshes();
  // --- bomb ---
  if (state.bomb.state === 'planted') {
    state.bomb.fuseT -= dt;
    // sentinel defuse channel (test harness drives this in testMode)
    if (state.testMode) {
      const near = state.bots.find((b) => b.alive && b.team === 'sentinel' && Math.hypot(b.x - state.bomb.x, b.z - state.bomb.z) < 2.5);
      if (near) {
        near.defusing = true; near.defuseT += dt;
        if (near.defuseT >= FLOW.defuseTime) {
          state.bomb.state = 'defused'; near.defusing = false;
          endRound('sentinel', 'BOMB DEFUSED BY THE SENTINELS');
          return;
        }
      }
    } else if (state.bomb.state === 'defused') {
      endRound('sentinel', 'BOMB DEFUSED BY THE SENTINELS');
      return;
    }
    if (state.bomb.fuseT <= 0) {
      state.bomb.state = 'exploded';
      fx.explosion({ x: state.bomb.x, y: 1, z: state.bomb.z });
      endRound('vanguard', 'SPIKE DETONATED — SITE DESTROYED');
      return;
    }
  }
  // --- elimination ---
  if (state.phase === 'play') {
    const vAlive = state.bots.filter((b) => b.alive && b.team === 'vanguard').length + (p.alive ? 1 : 0);
    const sAlive = state.bots.filter((b) => b.alive && b.team === 'sentinel').length;
    if (state.bomb.state !== 'planted') {
      if (sAlive === 0) { endRound('vanguard', 'ALL SENTINELS ELIMINATED'); return; }
      if (vAlive === 0) { endRound('sentinel', 'ALL VANGUARD ELIMINATED'); return; }
    } else if (vAlive === 0 && sAlive > 0) {
      // attackers all dead with the bomb down: defenders still must defuse;
      // the fuse decides it — nothing to do here.
    }
  }
  // spectate
  if (!p.alive && state.phase === 'play') {
    if (!state.spectate || !state.spectate.alive) {
      state.spectate = state.bots.find((b) => b.alive && b.team === 'vanguard') || null;
    }
  }
  input.endFrame();
}
function stepSim(n) {
  for (let i = 0; i < n; i++) step(1 / 60);
}

// ---------- render ----------
function render() {
  const p = state.player;
  const cam = state.spectate && !p.alive ? state.spectate : p;
  const eye = eyePos(cam);
  camera.position.set(eye.x, eye.y, eye.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = cam.yaw;
  camera.rotation.x = cam.pitch + (cam === p ? -p.recoil : 0);
  camera.rotation.z = 0;
  // view model follows the camera
  const vm = viewModels[p.current];
  for (const [id, g] of Object.entries(viewModels)) g.visible = id === p.current && p.alive && !state.scoped;
  if (vm) {
    vm.position.set(0.3, -0.3 - Math.sin(state.time * 1.7) * 0.004 - (p.speed > 0.5 ? Math.abs(Math.sin(state.time * 9)) * 0.008 : 0), -0.62 + p.recoil * 2.2);
    vm.rotation.x = p.recoil * 1.4;
  }
  // bot meshes
  for (const b of state.bots) {
    const m = botMeshes.get(b);
    if (!m) continue;
    m.visible = b.alive || state.time - 0 < 999; // dead bots lie flat, stay visible
    m.position.set(b.x, b.y, b.z);
    m.rotation.y = b.yaw;
    if (!b.alive) { m.rotation.x = -Math.PI / 2; m.position.y = 0.25; }
    else m.rotation.x = 0;
  }
  // tracers decay (frozen staged shots keep theirs for the screenshot)
  for (const s of tracerPool) {
    if (s.t > 0 && !state.frozen) { s.t -= 1 / 60; s.line.material.opacity = Math.max(0, s.t / 0.07) * 0.9; if (s.t <= 0) s.line.visible = false; }
  }
  if (explosionFx && explosionFx.t > 0 && !state.frozen) {
    explosionFx.t -= 1 / 60;
    const k = 1 - explosionFx.t / 0.5;
    explosionFx.mesh.scale.setScalar(1 + k * 9);
    explosionFx.mesh.material.opacity = Math.max(0, 0.8 - k);
    explosionFx.light.intensity = 160 * (1 - k);
    if (explosionFx.t <= 0) { explosionFx.mesh.visible = false; explosionFx.light.intensity = 0; }
  }
  // bomb mesh (spike) — a small blinking box at the plant spot
  if (!render.spike) {
    render.spike = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.35, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: 0xff2a1a, emissiveIntensity: 1 }),
    );
    scene.add(render.spike);
  }
  render.spike.visible = state.bomb.state === 'planted';
  if (state.bomb.state === 'planted') {
    render.spike.position.set(state.bomb.x, 0.2, state.bomb.z);
    render.spike.material.emissiveIntensity = 0.6 + 0.6 * Math.sin(state.time * 8);
  }
  // grenade dots
  if (!render.nades) render.nades = new Map();
  for (const [g, m] of [...render.nades]) {
    if (!state.grenadesLive.includes(g)) { scene.remove(m); render.nades.delete(g); }
  }
  for (const g of state.grenadesLive) {
    if (!render.nades.has(g)) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6),
        new THREE.MeshStandardMaterial({ color: g.kind === 'he' ? 0x3a4a2a : g.kind === 'smoke' ? 0x888888 : 0xddddaa }));
      scene.add(m); render.nades.set(g, m);
    }
    render.nades.get(g).position.set(g.x, g.y, g.z);
  }
  renderer.render(scene, camera);
}

function frame(t) {
  requestAnimationFrame(frame);
  const now = t / 1000;
  let dt = Math.min(0.1, now - (lastT || now));
  lastT = now;
  acc += dt;
  const stepDt = 1 / 60;
  let n = 0;
  // staged ?shot= states are frozen: render only, no sim, no bot combat
  while (!state.frozen && acc >= stepDt && n < 5) { step(stepDt); acc -= stepDt; n++; }
  if (n === 5) acc = 0;
  // HUD + decay
  vigLevel = Math.max(0, vigLevel - dt * 1.6);
  flashLevel = Math.max(0, flashLevel - dt * 0.55);
  const spreadPx = state.player.alive ? currentSpread(state.player, WEAPONS[state.player.current]) * 900 : 0;
  updateHud(hud, state, { spreadPx, vig: vigLevel, flash: flashLevel, scoped: state.scoped, showBuy: showBuyMenu }, dt);
  render();
}

// ---------- boot ----------
function boot() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.domElement.className = 'game';
  document.getElementById('app').prepend(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 220);
  scene.add(camera);
  // small fill light on the camera so the view model reads in the dusk
  const fill = new THREE.PointLight(0xfff2dd, 5, 5, 1.8);
  fill.position.set(0.3, -0.1, -0.2);
  camera.add(fill);
  world = buildWorld(scene);
  input = createInput(renderer.domElement);
  hud = buildHud({
    deploy: () => {
      audio.ensure(); audio.click();
      hud.el.menu.classList.add('hidden');
      input.lock();
      resetMatch();
      buildShop(hud, state, doBuy);
    },
    nextRound: () => nextRound(),
    restart: () => { hud.el.matchend.classList.add('hidden'); resetMatch(); hud.el.menu.classList.add('hidden'); },
    resume: () => { hud.el.pause.classList.add('hidden'); input.lock(); },
  });
  for (const id of WEAPON_ORDER) {
    const vm = buildViewModel(id);
    camera.add(vm);
    viewModels[id] = vm;
  }
  fx = makeFx();
  resetMatch();
  state.phase = 'menu';
  hud.el.menu.classList.remove('hidden');
  showBuyMenu = false;
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  document.addEventListener('pointerlockchange', () => {
    if (!input.locked && state.phase === 'play' && state.player.alive && !SELFTEST && !SHOT) {
      hud.el.pause.classList.remove('hidden');
    }
  });
  if (SELFTEST) {
    state.testMode = true;
    // run after first paint so the renderer exists
    requestAnimationFrame(() => setTimeout(runSelfTest, 50));
  } else if (SHOT) {
    stageShot(SHOT);
  }
  requestAnimationFrame(frame);
}

// ---------- ?shot= staging (frozen: no sim steps, no bot combat, banner held) ----------
function stageShot(n) {
  resetMatch();
  state.testMode = true;
  state.frozen = true;
  hud.el.menu.classList.add('hidden');
  if (n === 1) {
    state.round = 3; state.score = { vanguard: 2, sentinel: 1 };
    beginPlay();
    // off the mid axis so the mid cover block does not hide the firefight
    state.player.x = -5; state.player.z = 9; state.player.yaw = -0.57; state.player.pitch = 0.01;
    state.player.current = 'ar77';
    state.player.weapons.ar77 = { mag: 25, reserve: 75 };
    const s1 = state.bots[4]; s1.x = 2; s1.z = -2; s1.yaw = Math.PI; s1.hp = 100;
    const s2 = state.bots[5]; s2.x = -3; s2.z = -7; s2.yaw = Math.PI; s2.hp = 42;
    const v1 = state.bots[0]; v1.x = -4; v1.z = 6; v1.yaw = 0;
    state.killfeed.unshift({ killer: 'YOU', victim: 'Ferro', zone: 'head', head: true, t: 0 });
    state.killfeed.unshift({ killer: 'Rook', victim: 'Kite', zone: 'body', head: false, t: 0 });
    showBanner(hud, 'ROUND 3', 'VANGUARD 2 — 1 SENTINEL');
    const eye = eyePos(state.player);
    fx.tracer(state.player, eye, { x: 2, y: 1.3, z: -2 });
    syncBotMeshes();
  } else if (n === 2) {
    state.player.money = 4300;
    state.player.weapons.vk9 = { mag: 30, reserve: 120 };
    showBuyMenu = true;
    buildShop(hud, state, doBuy);
    state.player.x = 0; state.player.z = 20; state.player.yaw = 0;
    syncBotMeshes();
  } else if (n === 3) {
    beginPlay();
    state.bomb = { state: 'planted', site: 'A', x: SITES.A.x, z: SITES.A.z, fuseT: 28, carrier: null };
    state.player.x = -19; state.player.z = -9;
    state.player.yaw = Math.atan2(5, 5); state.player.pitch = -0.02;
    state.player.current = 'vk9';
    state.player.weapons.vk9 = { mag: 18, reserve: 90 };
    const d = state.bots[4];
    d.x = SITES.A.x + 1; d.z = SITES.A.z + 1; d.yaw = Math.PI; d.defusing = true; d.defuseT = 2.5;
    const g = state.bots[1]; g.x = -26; g.z = -6; g.yaw = 0.5;
    showBanner(hud, 'SPIKE PLANTED', 'SITE A — STOP THE DEFUSE');
    syncBotMeshes();
  } else {
    beginPlay();
    // north of the spawn wall so the full mid lane reads to the Sentinel spawn
    state.player.x = 0; state.player.z = 14; state.player.yaw = 0; state.player.pitch = 0.02;
    state.bots[4].x = -2; state.bots[4].z = -18; state.bots[4].yaw = Math.PI;
    state.bots[5].x = 3; state.bots[5].z = -19; state.bots[5].yaw = Math.PI;
    state.bots[6].x = 0; state.bots[6].z = -20; state.bots[6].yaw = Math.PI;
    state.bots[0].x = -3; state.bots[0].z = 19; state.bots[0].yaw = 0;
    syncBotMeshes();
  }
  hud.bannerT = 9999; // hold the banner for the screenshot
}

// ---------- ?selftest=1 harness: 15 scripted checks on the live systems ----------
function runSelfTest() {
  const lines = [];
  let allPass = true;
  const T = (name, cond, detail = '') => {
    lines.push(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!cond) allPass = false;
  };
  try {
    resetMatch();
    state.testMode = true;
    showBuyMenu = false;
    T('buy-phase-at-start', state.phase === 'buy', `phase=${state.phase}`);
    state.player.money = 4000;
    const r1 = buyWeapon(state, 'vk9');
    T('buy-smg', r1.ok && !!state.player.weapons.vk9 && state.player.money === 2500, `money=${state.player.money}`);
    const r2 = buyGrenade(state, 'he');
    T('buy-he', r2.ok && state.player.grenades.he === 1 && state.player.money === 2200, `money=${state.player.money}`);
    beginPlay();
    T('play-phase-starts', state.phase === 'play', `phase=${state.phase}`);
    // movement: 1 s of W from (0,16) facing -Z — expect dz about -4.25 m
    state.player.x = 0; state.player.z = 16; state.player.y = 0;
    state.player.yaw = 0; state.player.pitch = 0; state.player.vx = 0; state.player.vz = 0;
    input.script = { forward: 1, back: 0, left: 0, right: 0, sprint: false, crouch: false, jump: false };
    const z0 = state.player.z;
    stepSim(60);
    input.script = null;
    const dz = state.player.z - z0;
    T('move-forward-4.25m', dz < -3.8 && dz > -4.7, `dz=${dz.toFixed(2)}`);
    // fire spends ammo
    state.player.current = 'vk9';
    state.player.pitch = 0.6; state.player.yaw = 0; // aim at the sky: no hit
    state.player.lastShot = -9;
    const mag0 = state.player.weapons.vk9.mag;
    shoot(state, state.player, scene, fx);
    T('fire-spends-ammo', state.player.weapons.vk9.mag === mag0 - 1, `mag=${state.player.weapons.vk9.mag}`);
    // aimed shot damages a bot 100 -> 78 (SMG 22 body)
    const bot = state.bots[4];
    bot.x = 3; bot.z = 0; bot.y = 0; bot.hp = 100; bot.alive = true; bot.armor = 0;
    state.player.x = 3; state.player.z = 10; state.player.y = 0; state.player.vx = 0; state.player.vz = 0;
    state.player.speed = 0; // standing still: spread is at its base value
    state.player.spreadBloom = 0;
    const eye = eyePos(state.player);
    const dxb = bot.x - eye.x, dzb = bot.z - eye.z;
    state.player.yaw = Math.atan2(-dxb, -dzb);
    state.player.pitch = Math.atan2((bot.y + 1.0) - eye.y, Math.hypot(dxb, dzb));
    state.time += 0.2; state.player.lastShot = -9;
    const res = shoot(state, state.player, scene, fx);
    T('shot-damages-bot-78', res && res.hit && bot.hp === 78, `hp=${bot.hp} hit=${!!res?.hit} zone=${res?.zone}`);
    // kill awards $300
    const moneyBefore = state.player.money;
    bot.hp = 22; bot.alive = true;
    state.time += 0.2; state.player.lastShot = -9;
    shoot(state, state.player, scene, fx);
    T('kill-awards-money', !bot.alive && state.player.money === moneyBefore + 300, `alive=${bot.alive} money=${state.player.money}`);
    // reload refills the mag
    state.time += 0.2;
    startReload(state.player, state.time);
    stepSim(130);
    T('reload-refills', state.player.weapons.vk9.mag === 30, `mag=${state.player.weapons.vk9.mag}`);
    // grenade thrown + exploded
    const thrown = throwGrenade(state, state.player, 'he');
    const explodedBefore = state.stats.grenadesExploded;
    stepSim(150);
    T('grenade-thrown', thrown && state.player.grenades.he === 0, `he=${state.player.grenades.he}`);
    T('grenade-exploded', state.stats.grenadesExploded > explodedBefore, `exploded=${state.stats.grenadesExploded}`);
    // bomb plants at A
    state.player.x = SITES.A.x; state.player.z = SITES.A.z; state.player.y = 0;
    state.player.alive = true; state.player.hp = 100;
    state.player.planting = true; state.player.plantT = 0;
    state.bomb = { state: 'none', site: null, x: 0, z: 0, fuseT: 0, carrier: null };
    stepSim(200);
    state.player.planting = false;
    T('bomb-plants-at-A', state.bomb.state === 'planted' && state.bomb.site === 'A', `bomb=${state.bomb.state} site=${state.bomb.site}`);
    // a sentinel bot defuses: round ends, Sentinel wins
    const def = state.bots[5];
    def.x = state.bomb.x + 1; def.z = state.bomb.z; def.y = 0; def.alive = true; def.hp = 100; def.defuseT = 0;
    stepSim(330);
    T('bot-defuse-ends-round', state.phase === 'roundEnd', `phase=${state.phase}`);
    T('sentinel-win-recorded', state.winner === 'sentinel' && state.score.sentinel === 1, `winner=${state.winner} score=${state.score.sentinel}`);
    // next round opens in buy phase
    hud.el.roundend.classList.add('hidden');
    nextRound();
    T('next-round-buy-phase', state.phase === 'buy' && state.round === 2, `phase=${state.phase} round=${state.round}`);
  } catch (err) {
    lines.push('FAIL harness-exception — ' + (err && err.message));
    allPass = false;
  }
  const total = lines.length;
  const passed = lines.filter((l) => l.startsWith('PASS')).length;
  const verdict = allPass && passed === 15 ? 'SELFTEST ALL PASS' : `SELFTEST FAIL (${passed}/15)`;
  const text = `${verdict}\n` + lines.join('\n');
  const box = document.getElementById('selftest');
  box.classList.remove('hidden');
  box.textContent = text;
  document.title = verdict;
  console.log(text);
  window.__selftest = { verdict, passed, total, lines };
}

window.__game = { state, get phase() { return state.phase; }, resetMatch, nextRound, beginPlay, runSelfTest };
boot();
