// hud.js — DOM HUD + minimap + all menus.
// One job: show the state. It never changes the state (except through
// button clicks the player makes: deploy, buy items, continue).
import { WEAPONS, WEAPON_ORDER, GRENADES, ECON, FLOW } from './state.js';
import { WALLS, SITES } from './world.js';

const $ = (id) => document.getElementById(id);

export function buildHud(callbacks) {
  const el = {
    scV: $('scV'), scS: $('scS'), roundlbl: $('roundlbl'), timer: $('timer'),
    bombstat: $('bombstat'), feed: $('feed'), hpfill: $('hpfill'), armorfill: $('armorfill'),
    hptxt: $('hptxt'), ammo: $('ammo'), wname: $('wname'), money: $('money'),
    map: $('map'), cross: $('cross'), hitmark: $('hitmark'), dmgdir: $('dmgdir'),
    vig: $('vig'), flash: $('flash'), plantbar: $('plantbar'), planttxt: $('planttxt'),
    plantfill: $('plantfill'), hint: $('hint'), banner: $('banner'), subbanner: $('subbanner'),
    buy: $('buy'), shop: $('shop'), buymoney: $('buymoney'),
    menu: $('menu'), roundend: $('roundend'), matchend: $('matchend'), pause: $('pause'),
    reTitle: $('reTitle'), reSub: $('reSub'), reDetail: $('reDetail'),
    meTitle: $('meTitle'), meSub: $('meSub'), meDetail: $('meDetail'),
  };
  const hud = { el, bannerT: 0, hitT: 0, hitKill: false, dmgT: 0, dmgAng: 0 };
  $('deploy').addEventListener('click', () => callbacks.deploy());
  $('reNext').addEventListener('click', () => callbacks.nextRound());
  $('meAgain').addEventListener('click', () => callbacks.restart());
  $('resume').addEventListener('click', () => callbacks.resume());
  el.buy.addEventListener('click', (e) => { if (e.target === el.buy) hud.showBuy(false); });
  return hud;
}

export function buildShop(hud, state, buy) {
  const shop = hud.el.shop;
  shop.innerHTML = '';
  const p = state.player;
  const item = (key, title, desc, price, owned, poor, fn) => {
    const d = document.createElement('div');
    d.className = 'item' + (owned ? ' owned' : '') + (poor ? ' poor' : '');
    d.innerHTML = `<span class="k">${key}</span> <b>${title}</b><span class="pr">${owned ? 'OWNED' : '$' + price}</span><br>${desc}`;
    d.addEventListener('click', () => { fn(); });
    shop.appendChild(d);
  };
  for (const id of WEAPON_ORDER) {
    const w = WEAPONS[id];
    item(id === 'p9' ? '1' : id === 'vk9' ? '2' : id === 'ar77' ? '3' : '4',
      w.name, `${w.damage} dmg · ${w.mag} mag · ${w.auto ? 'auto' : 'semi'}${w.scoped ? ' · scope' : ''}`,
      w.price, !!p.weapons[id], p.money < w.price && !p.weapons[id],
      () => buy('weapon', id));
  }
  for (const [kind, g] of Object.entries(GRENADES)) {
    item(kind === 'he' ? '5' : kind === 'smoke' ? '6' : '7',
      g.name, `carried: ${p.grenades[kind]} / 2`,
      g.price, false, p.money < g.price,
      () => buy('grenade', kind));
  }
  item('8', 'KEVLAR ARMOR', `armor: ${p.armor} / 100 — halves damage`, ECON.armorPrice,
    p.armor >= 100, p.money < ECON.armorPrice, () => buy('armor'));
}

export function showBanner(hud, text, sub = '') {
  hud.el.banner.textContent = text;
  hud.el.subbanner.textContent = sub;
  hud.el.banner.style.opacity = 1;
  hud.el.subbanner.style.opacity = sub ? 1 : 0;
  hud.bannerT = 2.6;
}
export function hitmarker(hud, kill) {
  hud.el.hitmark.style.opacity = 1;
  hud.el.hitmark.className = kill ? 'kill' : '';
  hud.hitT = 0.18;
}
export function damageFrom(hud, angleRad) {
  hud.el.dmgdir.style.transform = `rotate(${angleRad}rad)`;
  hud.el.dmgdir.style.opacity = 1;
  hud.dmgT = 0.9;
}

function fmtTime(t) {
  t = Math.max(0, Math.ceil(t));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function updateHud(hud, state, view, dt) {
  const p = state.player, el = hud.el;
  el.scV.textContent = state.score.vanguard;
  el.scS.textContent = state.score.sentinel;
  el.roundlbl.textContent = `ROUND ${state.round} / ${FLOW.maxRounds} · FIRST TO ${FLOW.winRounds}`;
  el.timer.textContent = state.phase === 'play' && state.bomb.state === 'planted'
    ? fmtTime(state.bomb.fuseT) : fmtTime(state.timer);
  el.timer.style.color = state.timer <= 10 && state.phase !== 'menu' ? '#ff6a4d' : '#fff';
  const bomb = state.bomb;
  el.bombstat.textContent =
    bomb.state === 'planted' ? `💣 BOMB PLANTED — SITE ${bomb.site} · ${Math.ceil(bomb.fuseT)}s` :
    bomb.state === 'defused' ? 'BOMB DEFUSED' :
    bomb.state === 'exploded' ? 'BOMB DETONATED' :
    state.phase === 'play' ? 'SPIKE READY — PRESS E AT A SITE TO PLANT' : '';
  // health / armor / ammo / money
  const shown = p.alive ? p : (state.spectate || p);
  el.hpfill.style.width = Math.max(0, shown.hp) + '%';
  el.hpfill.style.background = shown.hp > 50 ? 'linear-gradient(90deg,#37c8a5,#7be3c3)' : shown.hp > 25 ? '#e8b73a' : '#ff5340';
  el.armorfill.style.width = (shown.armor || 0) + '%';
  el.hptxt.textContent = p.alive ? `${Math.ceil(p.hp)} HP` : `SPECTATING ${state.spectate ? state.spectate.name : '—'}`;
  const ws = p.weapons[p.current];
  el.ammo.innerHTML = ws ? `${ws.mag} <small>/ ${ws.reserve}</small>` : '—';
  el.wname.textContent = (p.selectedGrenade ? GRENADES[p.selectedGrenade].name + ' — CLICK TO THROW · ' : '') + WEAPONS[p.current].name + (p.reloading > 0 ? ' — RELOADING…' : '');
  el.money.textContent = '$' + p.money;
  el.buymoney.textContent = '$' + p.money;
  // killfeed
  el.feed.innerHTML = state.killfeed.map((k) =>
    `<div>${k.killer} ${k.head ? '◉' : '▸'} ${k.victim}</div>`).join('');
  // crosshair spread
  const gap = 4 + (view.spreadPx || 0);
  const set = (id, x, y, w, h) => { const n = $(id); n.style.left = x + 'px'; n.style.top = y + 'px'; n.style.width = w + 'px'; n.style.height = h + 'px'; };
  set('clT', -1, -gap - 8, 2, 8); set('clB', -1, gap, 2, 8);
  set('clL', -gap - 8, -1, 8, 2); set('clR', gap, -1, 8, 2);
  el.cross.style.display = (view.scoped || !p.alive) ? 'none' : 'block';
  // hitmarker / damage vignette / flash decay
  if (hud.hitT > 0) { hud.hitT -= dt; if (hud.hitT <= 0) el.hitmark.style.opacity = 0; }
  if (hud.dmgT > 0) { hud.dmgT -= dt; if (hud.dmgT <= 0) el.dmgdir.style.opacity = 0; }
  if (hud.bannerT > 0) { hud.bannerT -= dt; if (hud.bannerT <= 0) { el.banner.style.opacity = 0; el.subbanner.style.opacity = 0; } }
  el.vig.style.opacity = view.vig || 0;
  el.flash.style.opacity = view.flash || 0;
  // plant / defuse progress
  const planting = p.planting && p.plantT > 0;
  const defusingBot = state.bots.find((b) => b.alive && b.defusing);
  if (planting) {
    el.plantbar.classList.remove('hidden');
    el.planttxt.textContent = 'PLANTING SPIKE…';
    el.plantfill.style.width = Math.min(100, (p.plantT / FLOW.plantTime) * 100) + '%';
  } else if (defusingBot) {
    el.plantbar.classList.remove('hidden');
    el.planttxt.textContent = `⚠ ${defusingBot.name.toUpperCase()} IS DEFUSING!`;
    el.plantfill.style.width = Math.min(100, (defusingBot.defuseT / FLOW.defuseTime) * 100) + '%';
  } else el.plantbar.classList.add('hidden');
  // hint line
  el.hint.textContent = state.phase === 'buy' ? 'BUY PHASE — B opens the shop · deploy when ready' :
    state.phase === 'freeze' ? 'FREEZE TIME — round starts soon' :
    state.phase === 'play' && bomb.state === 'none' ? (p.alive ? 'E plants the spike inside a site ring' : 'You are down — spectating a teammate') :
    state.phase === 'play' && bomb.state === 'planted' && p.team === 'vanguard' ? 'Bomb planted — defend the site!' :
    state.phase === 'play' && bomb.state === 'planted' ? 'Bomb planted — find it and defuse!' : '';
  // buy menu visibility
  el.buy.classList.toggle('hidden', !(state.phase === 'buy' && view.showBuy));
  drawMinimap(hud, state);
}

function drawMinimap(hud, state) {
  const c = hud.el.map, ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  const sx = (x) => (x + 32) / 64 * W, sz = (z) => (z + 23) / 46 * H;
  ctx.fillStyle = '#0c0a12'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#3a3644';
  for (const w of WALLS) ctx.fillRect(sx(w.x0), sz(w.z0), Math.max(1, sx(w.x1) - sx(w.x0)), Math.max(1, sz(w.z1) - sz(w.z0)));
  for (const [k, s] of Object.entries(SITES)) {
    ctx.strokeStyle = k === 'A' ? '#37c8a5' : '#e8b73a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sx(s.x), sz(s.z), s.r / 64 * W, 0, 7); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
    ctx.fillText(k, sx(s.x), sz(s.z) + 4);
  }
  if (state.bomb.state === 'planted') {
    ctx.fillStyle = '#ff5340'; ctx.beginPath(); ctx.arc(sx(state.bomb.x), sz(state.bomb.z), 4, 0, 7); ctx.fill();
  }
  const dot = (x, z, col, r = 3) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx(x), sz(z), r, 0, 7); ctx.fill(); };
  for (const b of state.bots) {
    if (!b.alive) continue;
    dot(b.x, b.z, b.team === 'vanguard' ? '#5aa8ff' : '#ff9a3d', 2.5);
  }
  if (state.player.alive) {
    dot(state.player.x, state.player.z, '#fff', 3.5);
    // facing tick
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath();
    ctx.moveTo(sx(state.player.x), sz(state.player.z));
    ctx.lineTo(sx(state.player.x) - Math.sin(state.player.yaw) * 8, sz(state.player.z) - Math.cos(state.player.yaw) * 8);
    ctx.stroke();
  }
}
