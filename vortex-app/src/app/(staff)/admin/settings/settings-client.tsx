"use client";

import { useState, useTransition } from "react";
import type { Club } from "@/lib/data/club";
import { updateClub } from "./actions";

export default function SettingsClient({ club, totalSwimmers }: { club: Club; totalSwimmers: number }) {
  const [name, setName] = useState(club.name);
  const [zoneMethod, setZoneMethod] = useState(club.zone_method);
  const [currency, setCurrency] = useState(club.currency);
  const [, startTransition] = useTransition();

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#0C1116] mb-6">Settings</h1>

      <div className="rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] p-4 mb-4">
        <p className="text-sm text-[#7A8296] mb-1">Club name</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => startTransition(() => updateClub(club.id, { name }))}
          className="w-full rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm mb-4"
        />

        <p className="text-sm text-[#7A8296] mb-1">Zone ruleset</p>
        <div className="flex gap-2 mb-4">
          {(["5", "6"] as const).map((z) => (
            <button
              key={z}
              onClick={() => {
                setZoneMethod(z);
                startTransition(() => updateClub(club.id, { zone_method: z }));
              }}
              className="flex-1 py-2 rounded-[var(--radius-sm)] text-sm font-semibold"
              style={{
                background: zoneMethod === z ? "var(--vx-blue)" : "#EEF1F5",
                color: zoneMethod === z? "#fff" : "#4A5568",
              }}
            >
              {z}-zone
            </button>
          ))}
        </div>

        <p className="text-sm text-[#7A8296] mb-1">Currency</p>
        <input
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          onBlur={() => startTransition(() => updateClub(club.id, { currency }))}
          className="w-full rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
        />
      </div>

      <div className="rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] p-4">
        <p className="text-sm text-[#7A8296]">Club stats</p>
        <p className="text-[#0C1116] font-bold text-xl">{totalSwimmers} swimmers</p>
      </div>
    </div>
  );
}
