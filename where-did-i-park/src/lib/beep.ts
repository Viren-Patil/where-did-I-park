export async function beep() {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.value = 880; // A5
  g.gain.value = 0.001;
  o.connect(g).connect(ctx.destination);
  o.start();
  const t0 = ctx.currentTime;
  g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.00001, t0 + 0.8);
  o.stop(t0 + 0.85);
  setTimeout(() => ctx.close(), 1000);
}
