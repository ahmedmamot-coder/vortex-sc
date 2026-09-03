"use client";

import { useState, useTransition } from "react";
import { parseTimeToSeconds, formatTime, formatShortDate } from "@/lib/format";
import {
  DISTANCE_TRIALS,
  FIXED_CLOCK_TESTS,
  fixedClockProtocol,
  fixedClockTest,
  formatMetres,
  tPaceFromDistanceTrial,
  tPaceFromFixedClock,
  type TPaceTestType,
} from "@/lib/tpace-tests";
import { logTPaceTest, deleteTPaceTest } from "./actions";

type TestRow = {
  id: string;
  name: string;
  type: TPaceTestType;
  distance: number;
  time_seconds: number;
  t_pace_seconds: number;
  tested_at: string;
  retest_due: string | null;
};

const BUTTONS: { type: TPaceTestType; label: string }[] = [
  ...DISTANCE_TRIALS.map((d) => ({ type: String(d) as TPaceTestType, label: `${d}m trial` })),
  ...(["t30", "t20"] as const).map((t) => ({ type: t, label: `${FIXED_CLOCK_TESTS[t].label} test` })),
];

export default function TPaceClient({
  slug,
  swimmers,
  tests,
}: {
  slug: string;
  swimmers: { id: string; name: string }[];
  tests: TestRow[];
}) {
  const [swimmerId, setSwimmerId] = useState(swimmers[0]?.id ?? "");
  const [type, setType] = useState<TPaceTestType>("1000");
  const [timeText, setTimeText] = useState("");
  // A fixed-clock test asks for metres and a distance trial asks for a time, so they get their
  // own field. Sharing one would mean a stale "14:32.50" could be read as 14 metres.
  const [distText, setDistText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const fixed = fixedClockTest(type);

  const preview = (() => {
    if (fixed) {
      const m = parseFloat(distText.trim());
      if (!Number.isFinite(m) || m <= 0) return null;
      return formatTime(tPaceFromFixedClock(type, m)!);
    }
    const secs = parseTimeToSeconds(timeText);
    if (secs == null || secs <= 0) return null;
    return formatTime(tPaceFromDistanceTrial(Number(type), secs));
  })();

  function save() {
    const value = fixed ? parseFloat(distText.trim()) : parseTimeToSeconds(timeText);
    if (value == null || !Number.isFinite(value) || value <= 0) {
      setError(
        fixed
          ? `Enter the distance swum in metres, e.g. ${fixed.eg}.`
          : "Enter a valid time (e.g. 11:40.00).",
      );
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await logTPaceTest(slug, swimmerId, type, value);
      if (res.ok) {
        setTimeText("");
        setDistText("");
      } else {
        setError(res.message);
      }
    });
  }

  return (
    <div>
      <div className="rounded-[var(--radius-lg)] bg-white border border-[#E5E9F0] p-4 mb-6">
        <p className="text-sm text-[#0C1116] font-semibold mb-3">Log a trial</p>
        <div className="flex flex-col gap-2">
          <select
            value={swimmerId}
            onChange={(e) => setSwimmerId(e.target.value)}
            className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
          >
            {swimmers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            {BUTTONS.map((b) => (
              <button
                key={b.type}
                onClick={() => {
                  setType(b.type);
                  setError(null);
                }}
                className="py-2 rounded-[var(--radius-sm)] text-sm font-semibold"
                style={{
                  background: type === b.type ? "var(--vx-blue)" : "#EEF1F5",
                  color: type === b.type ? "#fff" : "#4A5568",
                }}
              >
                {b.label}
              </button>
            ))}
          </div>

          {fixed ? (
            <>
              <div className="rounded-[var(--radius-sm)] p-3" style={{ background: "#0A0F1A" }}>
                <p
                  className="text-[10px] font-bold uppercase tracking-[0.1em] m-0"
                  style={{ color: "rgba(255,255,255,.5)" }}
                >
                  {fixed.label} · {fixed.mins} minutes continuous freestyle
                </p>
                <p className="text-xs mt-1.5 leading-relaxed m-0" style={{ color: "#CFE0FF" }}>
                  {fixedClockProtocol(fixed)}
                </p>
              </div>
              <input
                value={distText}
                onChange={(e) => setDistText(e.target.value)}
                inputMode="decimal"
                placeholder={`Distance in metres e.g. ${fixed.eg}`}
                className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
              />
            </>
          ) : (
            <input
              value={timeText}
              onChange={(e) => setTimeText(e.target.value)}
              placeholder="Total time e.g. 11:40.00"
              className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
            />
          )}

          {preview && (
            <p className="text-sm text-[var(--vx-success)]">T-pace ≈ {preview} / 100m</p>
          )}
          {error && <p className="text-sm text-[var(--vx-danger)]">{error}</p>}
          <button
            onClick={save}
            disabled={pending}
            className="rounded-[var(--radius-md)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--vx-blue)" }}
          >
            Save trial
          </button>
        </div>
      </div>

      <p className="text-[#0C1116] font-semibold mb-2 text-sm">Recent trials</p>
      <div className="flex flex-col gap-1">
        {tests.map((t) => {
          const overdue = t.retest_due && new Date(t.retest_due) < new Date();
          const tFixed = fixedClockTest(t.type);
          return (
            <div key={t.id} className="flex items-center justify-between rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] px-3 py-2">
              <div>
                <p className="text-[#0C1116] text-sm">{t.name}</p>
                <p className="text-xs text-[#7A8296]">
                  {/* A fixed-clock test reads as the distance covered. Printing "30:00.00" would
                      show the protocol every swimmer shares rather than this swimmer's result. */}
                  {tFixed
                    ? `${tFixed.label} · ${formatMetres(t.distance)}m`
                    : `${formatMetres(t.distance)}m in ${formatTime(t.time_seconds)}`}{" "}
                  · {formatShortDate(t.tested_at)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-[#0C1116] font-bold text-sm">{formatTime(t.t_pace_seconds)}</p>
                  <p className="text-[10px]" style={{ color: overdue ? "var(--vx-danger)" : "var(--vx-slate-300)" }}>
                    {overdue ? "retest due" : "/100m"}
                  </p>
                </div>
                <button
                  onClick={() => startTransition(() => deleteTPaceTest(slug, t.id).then(() => {}))}
                  className="text-[var(--vx-danger)] text-xs"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
        {tests.length === 0 && <p className="text-sm text-[#7A8296]">No trials logged yet.</p>}
      </div>
    </div>
  );
}
