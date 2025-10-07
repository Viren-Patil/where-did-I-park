// Cross-platform compass heading in degrees [0..360)
// iOS Safari exposes webkitCompassHeading; Android gives alpha (device orientation)
export type HeadingState = { heading: number | null; permissionNeeded: boolean; error?: string };

export async function requestOrientationPermissionIfNeeded(): Promise<boolean> {
  // iOS 13+ requires an explicit permission call on a user gesture
  // @ts-ignore
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      // @ts-ignore
      const res = await DeviceOrientationEvent.requestPermission();
      return res === "granted";
    } catch { return false; }
  }
  return true; // most Android/desktop won’t need it
}

export function startCompass(onUpdate: (s: HeadingState) => void): () => void {
  let active = true;

  function handler(ev: DeviceOrientationEvent) {
    if (!active) return;

    // iOS: webkitCompassHeading (0=N, increases clockwise)
    const iosHeading = (ev as any).webkitCompassHeading;
    if (typeof iosHeading === "number" && !Number.isNaN(iosHeading)) {
      onUpdate({ heading: iosHeading, permissionNeeded: false });
      return;
    }

    // Android: ev.alpha (0..360) is rotation around Z-axis; we want 0=N clockwise.
    // Many devices give alpha=0 at device pointing east; compensations vary.
    // Good-enough heuristic: treat alpha as compass with screen upright.
    if (typeof ev.alpha === "number" && !Number.isNaN(ev.alpha)) {
      // Some browsers report 0 at North, others at East. We’ll assume 0≈North.
      // If your device feels off by ~90°, add a calibration UI later.
      const heading = (360 - ev.alpha) % 360; // make it clockwise, 0=N
      onUpdate({ heading, permissionNeeded: false });
      return;
    }

    onUpdate({ heading: null, permissionNeeded: false, error: "No heading data" });
  }

  window.addEventListener("deviceorientation", handler, { passive: true });

  return () => {
    active = false;
    window.removeEventListener("deviceorientation", handler as any);
  };
}
