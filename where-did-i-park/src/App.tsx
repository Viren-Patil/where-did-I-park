import { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import { startCompass, requestOrientationPermissionIfNeeded } from "./lib/compass";
import { haversine, bearingFromTo, formatDistance } from "./lib/geo";
import type { LatLng } from "./lib/geo"
import { startCountdown, readCountdown, formatMMSS } from "./lib/timer";
import { beep } from "./lib/beep";

type ParkedSpot = {
  lat: number;
  lon: number;
  accuracy?: number;
  note?: string;
  photoDataUrl?: string;
  when: number; // epoch ms
};

const KEY = "wdip_spot_v1";

export default function App() {
  const [spot, setSpot] = useState<ParkedSpot | null>(loadSpot());
  const [status, setStatus] = useState<string>("");
  const [livePos, setLivePos] = useState<GeolocationPosition | null>(null);
  const [watchId, setWatchId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [compassOn, setCompassOn] = useState(false);
  const [timer, setTimer] = useState<{ endsAt: number | null; remainingMs: number }>({ endsAt: null, remainingMs: 0 });
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    // start watching user location when a spot exists
    if (!spot) return;
    if (watchId !== null) return;
    if (!("geolocation" in navigator)) return;

    const id = navigator.geolocation.watchPosition(
      (pos) => setLivePos(pos),
      (err) => setStatus(err.message),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
    setWatchId(id);

    return () => {
      if (id) navigator.geolocation.clearWatch(id);
      setWatchId(null);
    };
  }, [spot]);


  const compassStopRef = useRef<null | (() => void)>(null);

  async function enableCompass() {
    const ok = await requestOrientationPermissionIfNeeded();
    if (!ok) { setStatus("Compass permission denied."); return; }
    if (compassStopRef.current) return; // already on
    compassStopRef.current = startCompass((s) => setHeading(s.heading));
    setCompassOn(true);
  }

  function disableCompass() {
    compassStopRef.current?.();
    compassStopRef.current = null;
    setCompassOn(false);
  }

  const liveLatLon: LatLng | null = livePos
    ? { lat: livePos.coords.latitude, lon: livePos.coords.longitude }
    : null;

  const distance = useMemo(() => {
    if (!spot || !liveLatLon) return null;
    return haversine(liveLatLon, { lat: spot.lat, lon: spot.lon });
  }, [spot, liveLatLon]);

  const bearing = useMemo(() => {
    if (!spot || !liveLatLon) return null;
    return Math.round(bearingFromTo(liveLatLon, { lat: spot.lat, lon: spot.lon }));
  }, [spot, liveLatLon]);

  const arrowRotation = useMemo(() => {
    if (bearing == null) return 0;
    if (heading == null) return bearing; // fall back to map bearing only
    // rotate arrow so "up" equals walking direction
    return (bearing - heading + 360) % 360;
  }, [bearing, heading]);

  function saveSpot(coords: GeolocationCoordinates, override?: Partial<ParkedSpot>) {
    const s: ParkedSpot = {
      lat: coords.latitude,
      lon: coords.longitude,
      accuracy: coords.accuracy,
      note: override?.note,
      photoDataUrl: override?.photoDataUrl,
      when: Date.now(),
    };
    localStorage.setItem(KEY, JSON.stringify(s));
    setSpot(s);
  }

  async function onParkHere() {
    setStatus("Getting a precise location… (walk near a window if indoors)");
    setPhotoUrl((p) => p); // keep photo if already chosen

    try {
      const pos = await getBestPosition({ maxWaitMs: 12000, desiredAccuracyM: 25 });
      saveSpot(pos.coords, { note, photoDataUrl: photoUrl });
      const acc = Math.round(pos.coords.accuracy ?? 0);
      setStatus(acc ? `Saved with ±${acc} m accuracy` : "Saved!");
      setNote("");
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to get location.");
    }
  }


  function onForget() {
    localStorage.removeItem(KEY);
    setSpot(null);
    setLivePos(null);
    setStatus("");
    setPhotoUrl(undefined);
  }

  function openMaps() {
    if (!spot) return;
    const q = `${spot.lat},${spot.lon}`;
    // Let the OS choose (Apple Maps on iOS, Google Maps on Android/Desktop)
    window.location.href = `https://maps.google.com/?q=${q}&ll=${q}&z=18`;
  }

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoUrl(reader.result as string);
    reader.readAsDataURL(f);
  }

  async function requestNotifyPermission(): Promise<boolean> {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const res = await Notification.requestPermission();
    return res === "granted";
  }

  function stopTicker() {
    if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
  }

  function startTicker() {
    stopTicker();
    tickRef.current = window.setInterval(() => {
      setTimer((t) => readCountdown(t));
    }, 500);
  }

  async function startMeter(minutes: number) {
    const c = startCountdown(minutes);
    setTimer(c);
    startTicker();
  }

  function clearMeter() {
    stopTicker();
    setTimer({ endsAt: null, remainingMs: 0 });
  }

  useEffect(() => {
    if (!timer.endsAt) return;
    if (timer.remainingMs <= 0) {
      stopTicker();
      // Try a local notification (works while the page is open; Web Push is not required)
      (async () => {
        const ok = await requestNotifyPermission();
        if (ok) new Notification("Meter ended", { body: "Time to move your car." });
        await beep();
      })();
    }
  }, [timer.remainingMs, timer.endsAt]);



  return (
    <main>
      <h1>Where did I park?</h1>

      {!spot && (
        <div className="card grid">
          <textarea
            className="note"
            placeholder="Level B2, near pillar G7… (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="row">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPhotoChange}
            />
            {photoUrl && <img className="preview" src={photoUrl} alt="Parking spot" />}
          </div>
          <button className="btn" onClick={onParkHere}>Park here</button>
          <p className="kicker">We only store your spot on this device. No cloud, no account.</p>
          {!!status && <p className="meta">{status}</p>}
        </div>
      )}

      {spot && (
        <div className="grid">
          <div className="card">
            <h3>Saved spot</h3>
            <div className="row">
              <div className="coords">
                {spot.lat.toFixed(6)}, {spot.lon.toFixed(6)}
              </div>
              {typeof spot.accuracy === "number" && (
                <div className="meta">± {Math.round(spot.accuracy)} m</div>
              )}
              <div className="meta">
                Parked {new Date(spot.when).toLocaleString()}
              </div>
              {spot.note && <div>Note: {spot.note}</div>}
              {spot.photoDataUrl && (
                <img className="preview" src={spot.photoDataUrl} alt="Your car" />
              )}
            </div>
          </div>

          <div className="card">
            <h3>Meter timer</h3>
            {timer.endsAt ? (
              <div className="row-inline">
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  {formatMMSS(timer.remainingMs)}
                </div>
                <button className="btn secondary" onClick={clearMeter}>Stop</button>
              </div>
            ) : (
              <div className="row-inline">
                <button className="btn secondary" onClick={() => startMeter(10)}>10 min</button>
                <button className="btn secondary" onClick={() => startMeter(20)}>20</button>
                <button className="btn secondary" onClick={() => startMeter(30)}>30</button>
                <button className="btn secondary" onClick={() => startMeter(60)}>60</button>
              </div>
            )}
            <p className="kicker">
              We’ll ping you here when time’s up. Keep the tab/app open for the alert + chime.
            </p>
          </div>

          <div className="card">
            <h3>Find my car</h3>
            {!liveLatLon && <p className="meta">Waiting for your current location…</p>}
            {distance !== null && (
              <>
                <div className="row-inline">
                  <div style={{ transform: `rotate(${arrowRotation}deg)` }} className="arrow">⬆️</div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>
                      {distance != null ? formatDistance(distance) : "—"}
                    </div>
                    <div className="meta">
                      Head {bearing ?? "—"}°
                      {heading != null ? ` • Your heading ${Math.round(heading)}°` : ""}
                    </div>
                  </div>
                </div>

                <div className="row">
                  {!compassOn
                    ? <button className="btn secondary" onClick={enableCompass}>Enable compass</button>
                    : <button className="btn secondary" onClick={disableCompass}>Disable compass</button>
                  }
                </div>
              </>
            )}
            <div className="row">
              <button className="btn" onClick={openMaps}>Open in Maps</button>
              <button className="btn secondary" onClick={onForget}>Clear saved spot</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function loadSpot(): ParkedSpot | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ParkedSpot) : null;
  } catch { return null; }
}

function getPosition(opts?: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, opts)
  );
}

function getBestPosition(
  { maxWaitMs = 12000, desiredAccuracyM = 25 }: { maxWaitMs?: number; desiredAccuracyM?: number } = {}
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation not supported"));
      return;
    }

    let best: GeolocationPosition | null = null;
    const start = Date.now();

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const acc = pos.coords.accuracy ?? 99999;
        // keep track of best so far
        if (!best || acc < (best.coords.accuracy ?? 99999)) best = pos;

        // resolve early if we hit our target
        if (acc <= desiredAccuracyM) {
          navigator.geolocation.clearWatch(id);
          resolve(pos);
        } else if (Date.now() - start > maxWaitMs) {
          navigator.geolocation.clearWatch(id);
          // time's up — return best seen (even if not ideal)
          resolve(best ?? pos);
        }
      },
      (err) => {
        navigator.geolocation.clearWatch(id);
        reject(err);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,       // don't use a cached reading
        timeout: 15000,
      }
    );
  });
}

