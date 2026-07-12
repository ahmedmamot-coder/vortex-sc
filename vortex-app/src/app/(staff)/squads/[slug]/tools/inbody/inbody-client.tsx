"use client";

import { useEffect, useState, useTransition } from "react";
import type { InBodyScan } from "@/lib/data/inbody";
import { analyseInBody } from "@/lib/nutrition";
import { formatShortDate } from "@/lib/format";
import { logScan, deleteScan, fetchScans } from "./actions";

const NUM = (v: string) => (v.trim() === "" ? null : Number(v));

export default function InBodyClient({
  slug,
  swimmers,
}: {
  slug: string;
  swimmers: { id: string; name: string }[];
}) {
  const [swimmerId, setSwimmerId] = useState(swimmers[0]?.id ?? "");
  const [scans, setScans] = useState<InBodyScan[]>([]);
  const [heightCm, setHeightCm] = useState("");
  const [form, setForm] = useState({ weight: "", muscle: "", fat: "", bmr: "", visceral: "" });
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!swimmerId) return;
    fetchScans(swimmerId).then(setScans);
  }, [swimmerId]);

  const latest = scans[0];
  const analysis = latest
    ? analyseInBody(
        {
          weight_kg: latest.weight_kg,
          muscle_mass_kg: latest.muscle_mass_kg,
          body_fat_pct: latest.body_fat_pct,
          bmr: latest.bmr,
          visceral_fat: latest.visceral_fat,
        },
        heightCm ? Number(heightCm) : undefined,
      )
    : null;

  function reload() {
    fetchScans(swimmerId).then(setScans);
  }

  return (
    <div>
      <select
        value={swimmerId}
        onChange={(e) => setSwimmerId(e.target.value)}
        className="w-full rounded-[var(--radius-md)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm mb-4"
      >
        {swimmers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <div className="rounded-[var(--radius-lg)] bg-white border border-[#E5E9F0] p-4 mb-4">
        <p className="text-[#0C1116] font-semibold text-sm mb-1">Log a scan</p>
        <p className="text-xs text-[#7A8296] mb-3">
          Read values from your InBody PDF or QR result sheet and enter them below.
        </p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input placeholder="Height cm (for BMI)" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm" />
          <input placeholder="Weight kg" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm" />
          <input placeholder="Muscle mass kg" value={form.muscle} onChange={(e) => setForm({ ...form, muscle: e.target.value })} className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm" />
          <input placeholder="Body fat %" value={form.fat} onChange={(e) => setForm({ ...form, fat: e.target.value })} className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm" />
          <input placeholder="BMR kcal" value={form.bmr} onChange={(e) => setForm({ ...form, bmr: e.target.value })} className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm" />
          <input placeholder="Visceral fat" value={form.visceral} onChange={(e) => setForm({ ...form, visceral: e.target.value })} className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm" />
        </div>
        <button
          onClick={() =>
            startTransition(async () => {
              await logScan(slug, swimmerId, {
                weight_kg: NUM(form.weight),
                muscle_mass_kg: NUM(form.muscle),
                body_fat_pct: NUM(form.fat),
                bmr: NUM(form.bmr),
                visceral_fat: NUM(form.visceral),
                source: "manual",
              });
              setForm({ weight: "", muscle: "", fat: "", bmr: "", visceral: "" });
              reload();
            })
          }
          className="w-full rounded-[var(--radius-md)] py-2 text-sm font-semibold text-white"
          style={{ background: "var(--vx-blue)" }}
        >
          Save scan
        </button>
      </div>

      {analysis && (
        <div className="rounded-[var(--radius-lg)] bg-white border border-[#E5E9F0] p-4 mb-4">
          <p className="text-[#0C1116] font-semibold text-sm mb-3">Analysis (latest scan)</p>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Stat label="BMI" value={analysis.bmi ? analysis.bmi.toFixed(1) : "—"} sub={analysis.bmiClass} />
            <Stat label="Calories" value={analysis.calorieTarget ? `${analysis.calorieTarget}` : "—"} sub="kcal/day" />
            <Stat
              label="Protein"
              value={analysis.proteinLow ? `${analysis.proteinLow}–${analysis.proteinHigh}` : "—"}
              sub="g/day"
            />
          </div>
          <ul className="flex flex-col gap-1">
            {analysis.notes.map((n, i) => (
              <li key={i} className="text-xs text-[#7A8296]">
                • {n}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[#0C1116] font-semibold text-sm mb-2">Scan history</p>
      <div className="flex flex-col gap-1">
        {scans.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] px-3 py-2 text-sm">
            <span className="text-[#7A8296]">{formatShortDate(s.scanned_at)}</span>
            <span className="text-[#0C1116]">
              {s.weight_kg ?? "—"}kg · {s.body_fat_pct ?? "—"}% fat
            </span>
            <button
              onClick={() =>
                startTransition(async () => {
                  await deleteScan(slug, s.id);
                  reload();
                })
              }
              className="text-[var(--vx-danger)] text-xs"
            >
              ✕
            </button>
          </div>
        ))}
        {scans.length === 0 && <p className="text-sm text-[#7A8296]">No scans yet.</p>}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-[var(--radius-md)] bg-white p-2 text-center">
      <p className="text-[10px] text-[#7A8296]">{label}</p>
      <p className="text-[#0C1116] font-bold">{value}</p>
      <p className="text-[10px] text-[#7A8296]">{sub}</p>
    </div>
  );
}
