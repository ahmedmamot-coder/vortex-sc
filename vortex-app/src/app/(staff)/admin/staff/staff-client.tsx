"use client";

import { useState, useTransition } from "react";
import type { Squad } from "@/lib/types";
import { updateSquadCoach } from "./actions";

export default function StaffClient({ squads }: { squads: Squad[] }) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#0C1116] mb-6">Staff</h1>
      <div className="flex flex-col gap-2">
        {squads.map((sq) => (
          <div key={sq.id} className="rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] px-4 py-3">
            {editing === sq.id ? (
              <StaffEditRow squad={sq} onClose={() => setEditing(null)} />
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[#0C1116] font-semibold">{sq.name}</p>
                  <p className="text-xs text-[#7A8296]">
                    {sq.coach_name}
                    {sq.assistant_coach_name ? ` · asst. ${sq.assistant_coach_name}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => setEditing(sq.id)}
                  className="text-xs font-semibold text-[#4A5568] border border-[#E5E9F0] rounded-[var(--radius-pill)] px-3 py-1"
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StaffEditRow({ squad, onClose }: { squad: Squad; onClose: () => void }) {
  const [coach, setCoach] = useState(squad.coach_name);
  const [asst, setAsst] = useState(squad.assistant_coach_name ?? "");
  const [, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <input
        value={coach}
        onChange={(e) => setCoach(e.target.value)}
        className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
      />
      <input
        value={asst}
        onChange={(e) => setAsst(e.target.value)}
        placeholder="Assistant coach (optional)"
        className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
      />
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="text-xs px-3 py-1.5 text-[#4A5568]">
          Cancel
        </button>
        <button
          onClick={() => {
            startTransition(() =>
              updateSquadCoach(squad.id, { coach_name: coach, assistant_coach_name: asst || null }),
            );
            onClose();
          }}
          className="text-xs font-semibold px-3 py-1.5 rounded-[var(--radius-pill)] text-white"
          style={{ background: "var(--vx-success)" }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
