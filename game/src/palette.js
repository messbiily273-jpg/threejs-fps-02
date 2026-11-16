// palette.js — the dusk-industrial look, made only from canvas textures.
// One job: colours + procedural textures. No image files, no network.
import * as THREE from 'three';

export const PALETTE = {
  sky: 0x2b2438, fog: 0x241d2e, ground: 0x4a4a48,
  concrete: 0x77716a, concreteDark: 0x55504a, steel: 0x3a4048, steelDark: 0x2b2f36,
  hazard: 0xe8b73a, accent: 0x37c8a5, accentDim: 0x1f7a64,
  vanguard: 0x4a90d9, sentinel: 0xd97b2f, muzzle: 0xffc861,
  siteA: 0x37c8a5, siteB: 0xe8b73a, lamp: 0xffb45e, crate: 0x6b5a3e,
};

function canvasTex(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function speckle(ctx, w, h, n, alpha, light) {
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${(Math.random() * alpha).toFixed(3)})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

export function makeConcreteTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#6f6a62'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 2600, 0.10, false); speckle(ctx, w, h, 1400, 0.07, true);
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.beginPath(); ctx.moveTo(0, 128); ctx.lineTo(w, 128); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.moveTo(0, 130); ctx.lineTo(w, 130); ctx.stroke();
  }, 8, 6);
}
export function makeGroundTexture() {
  return canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#4c4a45'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 5200, 0.12, false); speckle(ctx, w, h, 2400, 0.06, true);
    // expansion joints + oil stains
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * 128, 0); ctx.lineTo(i * 128, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * 128); ctx.lineTo(w, i * 128); ctx.stroke();
    }
    for (let i = 0; i < 7; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 18 + Math.random() * 42;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, 'rgba(10,8,6,0.35)'); g.addColorStop(1, 'rgba(10,8,6,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    // faded lane paint
    ctx.fillStyle = 'rgba(232,183,58,0.20)';
    ctx.fillRect(w / 2 - 6, 0, 12, h);
  }, 4, 3);
}
export function makeSteelTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3a4048'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let y = 0; y < h; y += 32) ctx.fillRect(0, y, w, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 16; y < h; y += 32) ctx.fillRect(0, y, w, 2);
    speckle(ctx, w, h, 900, 0.12, false);
    // rivets
    ctx.fillStyle = 'rgba(200,210,220,0.35)';
    for (let x = 16; x < w; x += 32) for (let y = 16; y < h; y += 32) {
      ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
    }
  }, 2, 1);
}
export function makeHazardTexture() {
  return canvasTex(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#e8b73a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#151310';
    for (let x = -h; x < w + h; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 16, 0); ctx.lineTo(x + 32, 0); ctx.lineTo(x + 16, h); ctx.fill();
    }
  }, 3, 1);
}
export function makeSignTexture(letter, sub, color) {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#101018'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = color; ctx.lineWidth = 10; ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = color; ctx.font = 'bold 150px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter, w / 2, h / 2 - 18);
    ctx.font = 'bold 24px Arial'; ctx.fillText(sub, w / 2, h - 42);
  });
}
export function makeGlowTexture() {
  return canvasTex(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
}
