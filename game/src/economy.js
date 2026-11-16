// economy.js — buy rules and round rewards.
// One job: money in, money out. No UI, no shooting.
import { WEAPONS, GRENADES, ECON } from './state.js';

export function buyWeapon(state, id) {
  const w = WEAPONS[id];
  const p = state.player;
  if (state.phase !== 'buy') return { ok: false, why: 'not buy phase' };
  if (!w) return { ok: false, why: 'unknown weapon' };
  if (p.weapons[id]) return { ok: false, why: 'already owned' };
  if (p.money < w.price) return { ok: false, why: 'not enough money' };
  p.money -= w.price;
  p.weapons[id] = { mag: w.mag, reserve: w.reserve };
  p.current = id;
  return { ok: true };
}
export function buyGrenade(state, kind) {
  const g = GRENADES[kind];
  const p = state.player;
  if (state.phase !== 'buy') return { ok: false, why: 'not buy phase' };
  if (!g) return { ok: false, why: 'unknown grenade' };
  if (p.grenades[kind] >= 2) return { ok: false, why: 'max 2 carried' };
  if (p.money < g.price) return { ok: false, why: 'not enough money' };
  p.money -= g.price;
  p.grenades[kind] += 1;
  return { ok: true };
}
export function buyArmor(state) {
  const p = state.player;
  if (state.phase !== 'buy') return { ok: false, why: 'not buy phase' };
  if (p.armor >= 100) return { ok: false, why: 'armor full' };
  if (p.money < ECON.armorPrice) return { ok: false, why: 'not enough money' };
  p.money -= ECON.armorPrice;
  p.armor = 100;
  return { ok: true };
}
// End-of-round payout: winners get the win bonus, losers the loss bonus.
export function roundReward(state, winnerTeam) {
  const pay = (f, amount) => { f.money += amount; };
  const all = [state.player, ...state.bots];
  for (const f of all) pay(f, f.team === winnerTeam ? ECON.winRound : ECON.loseRound);
  if (winnerTeam === 'vanguard' && state.bomb.state === 'planted') {
    // planter bonus is already folded into the kill reward path; keep simple
  }
}
