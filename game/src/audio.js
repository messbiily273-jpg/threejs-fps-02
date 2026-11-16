// audio.js — WebAudio-synthesized SFX only. No audio files, no network.
// One job: every sound the game makes, built from oscillators + noise.
export function createAudio() {
  const a = { ctx: null, master: null, muted: false, lastStep: 0 };
  a.ensure = () => {
    if (a.ctx) { if (a.ctx.state === 'suspended') a.ctx.resume(); return true; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      a.ctx = new AC();
      a.master = a.ctx.createGain();
      a.master.gain.value = 0.35;
      a.master.connect(a.ctx.destination);
      return true;
    } catch { return false; }
  };
  function tone(freq, dur, type = 'sine', vol = 0.5, slideTo = null, delay = 0) {
    if (!a.ctx || a.muted) return;
    const t0 = a.ctx.currentTime + delay;
    const o = a.ctx.createOscillator(), g = a.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(a.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, filterFreq, type = 'lowpass', delay = 0) {
    if (!a.ctx || a.muted) return;
    const t0 = a.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(a.ctx.sampleRate * dur));
    const buf = a.ctx.createBuffer(1, len, a.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.ctx.createBufferSource(); src.buffer = buf;
    const f = a.ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = a.ctx.createGain(); g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(a.master);
    src.start(t0);
  }
  a.shot = (id) => {
    if (!a.ensure()) return;
    if (id === 'lm88') { noise(0.28, 0.9, 900); tone(160, 0.22, 'sawtooth', 0.5, 40); }
    else if (id === 'ar77') { noise(0.12, 0.7, 1800); tone(220, 0.08, 'square', 0.25, 90); }
    else if (id === 'vk9') { noise(0.09, 0.55, 2400); tone(280, 0.06, 'square', 0.2, 110); }
    else { noise(0.1, 0.6, 2000); tone(300, 0.07, 'square', 0.22, 120); }
  };
  a.dryFire = () => { if (a.ensure()) tone(1200, 0.03, 'square', 0.15); };
  a.reload = () => { if (!a.ensure()) return; tone(700, 0.04, 'square', 0.2, 500, 0); tone(500, 0.04, 'square', 0.2, 350, 0.35); tone(900, 0.05, 'square', 0.25, 600, 0.7); };
  a.hit = () => { if (a.ensure()) tone(1900, 0.05, 'sine', 0.4); };
  a.kill = () => { if (!a.ensure()) return; tone(660, 0.09, 'sine', 0.4); tone(990, 0.14, 'sine', 0.4, null, 0.09); };
  a.hurt = () => { if (!a.ensure()) return; tone(140, 0.18, 'sawtooth', 0.4, 70); noise(0.12, 0.25, 500); };
  a.step = () => {
    if (!a.ensure()) return;
    const now = performance.now();
    if (now - a.lastStep < 240) return;
    a.lastStep = now;
    noise(0.05, 0.12, 700);
  };
  a.beep = () => { if (a.ensure()) tone(880, 0.12, 'sine', 0.35); };
  a.plantBeep = () => { if (a.ensure()) tone(1200, 0.07, 'square', 0.3); };
  a.explosion = () => { if (!a.ensure()) return; noise(0.9, 1.0, 320); tone(70, 0.7, 'sine', 0.7, 28); };
  a.flash = () => { if (a.ensure()) tone(2400, 0.3, 'sine', 0.3, 300); };
  a.roundWin = () => { if (!a.ensure()) return; [523, 659, 784].forEach((f, i) => tone(f, 0.22, 'triangle', 0.4, null, i * 0.13)); };
  a.roundLose = () => { if (!a.ensure()) return; [392, 330, 262].forEach((f, i) => tone(f, 0.25, 'triangle', 0.35, null, i * 0.14)); };
  a.click = () => { if (a.ensure()) tone(1000, 0.04, 'square', 0.2); };
  a.buy = () => { if (!a.ensure()) return; tone(880, 0.06, 'sine', 0.3); tone(1320, 0.09, 'sine', 0.3, null, 0.07); };
  return a;
}
