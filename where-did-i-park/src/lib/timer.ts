export type Countdown = { endsAt: number | null; remainingMs: number };

export function startCountdown(minutes: number): Countdown {
  const endsAt = Date.now() + Math.max(1, Math.round(minutes * 60_000));
  return { endsAt, remainingMs: endsAt - Date.now() };
}

export function readCountdown(c: Countdown): Countdown {
  if (!c.endsAt) return { endsAt: null, remainingMs: 0 };
  const remainingMs = Math.max(0, c.endsAt - Date.now());
  return { endsAt: c.endsAt, remainingMs };
}

export function formatMMSS(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
