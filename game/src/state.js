// state.js — the single game state object plus every config table.
// One job: hold the truth. Every other module reads or mutates this state;
// nothing keeps a second copy of health, money, phase or the bomb.
export const WEAPONS = {
  p9:   { id: 'p9',   name: 'P9 SIDEARM',       price: 0,    damage: 26, headMult: 4, mag: 15, reserve: 60,  interval: 0.16, reload: 1.4, spread: 0.012, auto: false, scoped: false, range: 60,  kick: 0.011 },
  vk9:  { id: 'vk9',  name: 'VK-9 RIPPER',      price: 1500, damage: 22, headMult: 4, mag: 30, reserve: 120, interval: 0.085, reload: 2.0, spread: 0.021, auto: true,  scoped: false, range: 55,  kick: 0.014 },
  ar77: { id: 'ar77', name: 'AR-77 LONGSHOT',   price: 2700, damage: 33, headMult: 4, mag: 25, reserve: 75,  interval: 0.11, reload: 2.4, spread: 0.011, auto: true,  scoped: false, range: 80,  kick: 0.017 },
  lm88: { id: 'lm88', name: 'LM-88 HARPOON',   price: 4750, damage: 95, headMult: 4, mag: 5,  reserve: 15,  interval: 1.15, reload: 3.2, spread: 0.004, auto: false, scoped: true,  range: 120, kick: 0.045 },
};
export const WEAPON_ORDER = ['p9', 'vk9', 'ar77', 'lm88'];
export const GRENADES = {
  he:    { id: 'he',    name: 'HE CHARGE',   price: 300, fuse: 2.0, radius: 9,  maxDmg: 110 },
  smoke: { id: 'smoke', name: 'SMOKE CANISTER', price: 300, fuse: 1.2, radius: 7,  life: 14 },
  flash: { id: 'flash', name: 'FLASH BURST', price: 200, fuse: 1.4, radius: 16, life: 2.2 },
};
export const ECON = {
  startMoney: 800, winRound: 3000, loseRound: 1900, kill: 300, plant: 300,
  armorPrice: 650, armorValue: 100,
};
export const FLOW = {
  buyTime: 12, freezeTime: 3, roundTime: 100, plantTime: 3, fuseTime: 40,
  defuseTime: 5, winRounds: 5, maxRounds: 9,
};
// Deterministic PRNG (mulberry32) so bot behaviour and spread are stable
// for a given seed; rendering never depends on it.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeFighter(team, name, isPlayer, x, z) {
  return {
    team, name, isPlayer: !!isPlayer,
    x, z, y: 0, vy: 0, yaw: team === 'vanguard' ? 0 : Math.PI, pitch: 0,
    hp: 100, armor: 0, alive: true, crouch: false,
    speed: 0, // current horizontal speed, for spread + HUD
    money: ECON.startMoney,
    weapons: { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve } },
    current: 'p9', lastShot: -9, reloading: 0, reloadEnd: 0, spreadBloom: 0,
    recoil: 0, // accumulated pitch kick, recovers over time
    grenades: { he: 0, smoke: 0, flash: 0 },
    selectedGrenade: null,
    planting: false, plantT: 0, defusing: false, defuseT: 0,
    kills: 0, deaths: 0, // per-match tallies
    // bot-only fields, filled by bots.js
    bot: null,
  };
}

export function createGameState() {
  const s = {
    phase: 'menu', // menu | buy | freeze | play | roundEnd | matchEnd
    round: 1, timer: FLOW.buyTime,
    score: { vanguard: 0, sentinel: 0 },
    player: makeFighter('vanguard', 'YOU', true, 0, 20),
    bots: [], // 9 fighters, created by bots.js
    bomb: { state: 'none', site: null, x: 0, z: 0, fuseT: 0, carrier: null },
    killfeed: [],
    grenadesLive: [], // {kind,x,y,z,vx,vy,vz,t,owner}
    smokes: [], // {x,z,r,t}
    flashes: [], // {x,y,z,t,team}
    stats: { shots: 0, hits: 0, grenadesThrown: 0, grenadesExploded: 0 },
    rng: mulberry32(20261117),
    seed: 20261117,
    time: 0, // sim seconds since boot
    testMode: false,
    winner: null, winReason: '',
    scoped: false,
    spectate: null, // bot being spectated while dead
    log: [],
  };
  return s;
}
