"use client";

import { useState, useTransition } from "react";
import { parseTimeToSeconds, formatTime, formatShortDate } from "@/lib/format";
import { logTPaceTest, deleteTPaceTest } from "./actions";

type TestRow = {
  id: string;
  name: string;
  distance: number;
  time_seconds: number;
  t_pace_seconds: number;
  tested_at: string;
  retest_due: string | null;
};

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
  const [distance, setDistance] = useState(1000);
  const [timeText, setTimeText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const preview = (() => {
    const secs = parseTimeToSeconds(timeText);
    if (secs == null) return null;
    return formatTime(secs / (distance / 100));
  })();

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
          <div className="flex gap-2">
            {[400, 1000].map((d) => (
              <button
                key={d}
                onClick={() => setDistance(d)}
                className="flex-1 py-2 rounded-[var(--radius-sm)] text-sm font-semibold"
                style={{ background: distance === d ? "var(--vx-blue)" : "rgba(255,255,255,0.06)", color: "#fff" }}
              >
                {d}m
              </button>
            ))}
          </div>
          <input
            value={timeText}
            onChange={(e) => setTimeText(e.target.value)}
            placeholder="Total time e.g. 11:40.00"
            className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
          />
          {preview && (
            <p className="text-sm text-[var(--vx-success)]">
              T-pace ≈ {preview} / 100m
            </p>
          )}
          {error && <p className="text-sm text-[var(--vx-danger)]">{error}</p>}
          <button
            onClick={() => {
              const secs = parseTimeToSeconds(timeText);
              if (secs == null) {
                setError("Enter a valid time (e.g. 11:40.00).");
                return;
              }
              setError(null);
              startTransition(async () => {
                await logTPaceTest(slug, swimmerId, distance, secs);
                setTimeText("");
              });
            }}
            className="rounded-[var(--radius-md)] px-4 py-2 text-sm font-semibold text-white"
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
          return (
            <div key={t.id} className="flex items-center justify-between rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] px-3 py-2">
              <div>
                <p className="text-[#0C1116] text-sm">{t.name}</p>
                <p className="text-xs text-[#7A8296]">
                  {t.distance}m in {formatTime(t.time_seconds)} · {formatShortDate(t.tested_at)}
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
                  onClick={() => startTransition(() => deleteTPaceTest(slug, t.id))}
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
