import type { Zone } from "@/lib/types";

export const ZONE_GUIDE: Record<Zone, { pct: string; hr: string; lactate: string; purpose: string; example: string }> = {
  EN1: { pct: "60–70%", hr: "120–150", lactate: "1–2", purpose: "Base aerobic conditioning, active recovery & technique.", example: "1500 steady, 20x100 easy, 800 pull." },
  EN2: { pct: "70–80%", hr: "150–170", lactate: "3–4", purpose: "Lactate-threshold development, the cornerstone of endurance.", example: "10x200 @3:00, 8x300 threshold, 30x50 @0:45." },
  EN3: { pct: "80–90%", hr: "170–185", lactate: "4–6", purpose: "Maximal aerobic power, high-intensity intervals, long rest to hold quality.", example: "6x100 @2:00 fast, 8x150 @90%, 4x200." },
  SP1: { pct: "90–95%", hr: "185+", lactate: "6–10", purpose: "Race-pace endurance; tolerate & clear high lactate.", example: "8x50 @1:30 max, 4x100 race pace, broken 200s." },
  SP2: { pct: "95–98%", hr: "max", lactate: "10–14", purpose: "Maximal lactate production, short max efforts, full recovery.", example: "6x25 max @1:00, 4x50 all-out, 8x15m." },
  SP3: { pct: "98–100%", hr: "max", lactate: "low", purpose: "Pure speed & neuromuscular power, max velocity, full recovery.", example: "10x15m max, 8x25 sprint @2:00, dive starts." },
};

/**
 * Which zones each squad is cleared to train, by age band.
 * Younger squads live in EN1–EN2; SP work is layered in with age/training age.
 */
export const SQUAD_ZONE_MATRIX: Record<string, Zone[]> = {
  preteam: ["EN1", "EN2"],
  advb: ["EN1", "EN2"],
  adva: ["EN1", "EN2", "EN3"],
  junior: ["EN1", "EN2", "EN3", "SP1"],
  seniorb: ["EN1", "EN2", "EN3", "SP1", "SP2"],
  seniora: ["EN1", "EN2", "EN3", "SP1", "SP2", "SP3"],
  vortexb: ["EN1", "EN2", "EN3", "SP1", "SP2", "SP3"],
  vortexa: ["EN1", "EN2", "EN3", "SP1", "SP2", "SP3"],
  legend: ["EN1", "EN2", "EN3", "SP1", "SP2", "SP3"],
};

/** Recommended session-volume caps (metres) per squad. */
export const SQUAD_VOLUME_CAP: Record<string, number> = {
  preteam: 1200,
  advb: 1800,
  adva: 2500,
  junior: 3500,
  seniorb: 4500,
  seniora: 5500,
  vortexb: 6500,
  vortexa: 7000,
  legend: 7500,
};
