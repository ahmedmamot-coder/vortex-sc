"use client";

import { useState, useTransition } from "react";
import { addTrial, setTrialStatus, addFee, deleteFee } from "./actions";

type Trial = { id: string; child_name: string; age: number | null; phone: string | null; status: string };
type Fee = { id: string; program_name: string; price: number; currency: string };

const TRIAL_STATUSES = ["pending", "trialled", "enrolled", "declined"];

export default function AcademyClient({
  trials,
  fees,
  currency,
}: {
  trials: Trial[];
  fees: Fee[];
  currency: string;
}) {
  const [tab, setTab] = useState<"trials" | "fees">("trials");
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [phone, setPhone] = useState("");
  const [program, setProgram] = useState("");
  const [price, setPrice] = useState("");
  const [, startTransition] = useTransition();

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#0C1116] mb-4">Academy</h1>
      <div className="flex gap-2 mb-4">
        {(["trials", "fees"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2 rounded-[var(--radius-pill)] text-sm font-semibold capitalize"
            style={{ background: tab === t ? "var(--vx-blue)" : "rgba(255,255,255,0.06)", color: "#fff" }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "trials" && (
        <div>
          <div className="rounded-[var(--radius-lg)] bg-white border border-[#E5E9F0] p-4 mb-4">
            <p className="text-[#0C1116] font-semibold text-sm mb-3">New trial request</p>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <input placeholder="Child name" value={name} onChange={(e) => setName(e.target.value)} className="rounded-[var(--radius-sm)] px-2 py-1.5 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm" />
              <input placeholder="Age" value={age} onChange={(e) => setAge(e.target.value)} className="rounded-[var(--radius-sm)] px-2 py-1.5 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm" />
              <input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="rounded-[var(--radius-sm)] px-2 py-1.5 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm" />
            </div>
            <button
              onClick={() =>
                startTransition(async () => {
                  await addTrial({ child_name: name, age: age ? Number(age) : null, phone });
                  setName("");
                  setAge("");
                  setPhone("");
                })
              }
              disabled={!name}
              className="w-full rounded-[var(--radius-md)] py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--vx-blue)" }}
            >
              Add
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {trials.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] px-3 py-2">
                <div>
                  <p className="text-[#0C1116] text-sm">{t.child_name}</p>
                  <p className="text-xs text-[#7A8296]">
                    {t.age ? `Age ${t.age}` : ""} {t.phone ? `· ${t.phone}` : ""}
                  </p>
                </div>
                <select
                  value={t.status}
                  onChange={(e) => startTransition(() => setTrialStatus(t.id, e.target.value))}
                  className="rounded-[var(--radius-sm)] px-2 py-1 bg-white border border-[#E5E9F0] text-[#0C1116] text-xs capitalize"
                >
                  {TRIAL_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            ))}
            {trials.length === 0 && <p className="text-sm text-[#7A8296]">No trial requests yet.</p>}
          </div>
        </div>
      )}

      {tab === "fees" && (
        <div>
          <div className="rounded-[var(--radius-lg)] bg-white border border-[#E5E9F0] p-4 mb-4">
            <p className="text-[#0C1116] font-semibold text-sm mb-3">Add fee</p>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input placeholder="Program" value={program} onChange={(e) => setProgram(e.target.value)} className="rounded-[var(--radius-sm)] px-2 py-1.5 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm" />
              <input placeholder={`Price (${currency})`} value={price} onChange={(e) => setPrice(e.target.value)} className="rounded-[var(--radius-sm)] px-2 py-1.5 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm" />
            </div>
            <button
              onClick={() =>
                startTransition(async () => {
                  await addFee({ program_name: program, price: Number(price) || 0, currency });
                  setProgram("");
                  setPrice("");
                })
              }
              disabled={!program}
              className="w-full rounded-[var(--radius-md)] py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--vx-blue)" }}
            >
              Add
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {fees.map((f) => (
              <div key={f.id} className="flex items-center justify-between rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] px-3 py-2">
                <span className="text-[#0C1116] text-sm">{f.program_name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[#0C1116] font-semibold text-sm">
                    {f.price} {f.currency}
                  </span>
                  <button onClick={() => startTransition(() => deleteFee(f.id))} className="text-[var(--vx-danger)] text-xs">
                    ✕
                  </button>
                </div>
              </div>
            ))}
            {fees.length === 0 && <p className="text-sm text-[#7A8296]">No fees set.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
