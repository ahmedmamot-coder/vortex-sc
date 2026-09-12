"use client";

import { useState, useTransition } from "react";
import type { Squad } from "@/lib/types";
import { updateSquadCoach } from "./actions";

export default function StaffClient({ squads }: { squads: Squad[] }) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#0C1116] mb-1">Staff</h1>
      <p className="text-sm text-[#7A8296] mb-6">
        Add, change or remove the head coach and assistant coach for each squad. Changes show up
        everywhere the squad appears — the squad list, squad screens, plan printouts and the family portal.
      </p>
      <div className="flex flex-col gap-2">
        {squads.map((sq) => (
          <div key={sq.id} className="rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] px-4 py-3">
            {editing === sq.id ? (
              <StaffEditRow squad={sq} onClose={() => setEditing(null)} />
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[#0C1116] font-semibold">{sq.name}</p>
                  <p className="text-xs text-[#7A8296] truncate">
                    {sq.coach_name?.trim() ? sq.coach_name : "No coach assigned"}
                    {sq.assistant_coach_name ? ` · asst. ${sq.assistant_coach_name}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => setEditing(sq.id)}
                  className="flex-none text-xs font-semibold text-[#4A5568] border border-[#E5E9F0] rounded-[var(--radius-pill)] px-3 py-1"
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
  const [coach, setCoach] = useState(squad.coach_name ?? "");
  const [asst, setAsst] = useState(squad.assistant_coach_name ?? "");
  const [pending, startTransition] = useTransition();

  const save = (fields: { coach_name?: string; assistant_coach_name?: string | null }) => {
    startTransition(async () => {
      await updateSquadCoach(squad.id, fields);
      onClose();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[#0C1116] font-semibold">{squad.name}</p>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-[#7A8296]">Head coach</span>
        <input
          value={coach}
          onChange={(e) => setCoach(e.target.value)}
          placeholder="e.g. Coach Wassim"
          className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="flex items-center justify-between text-xs font-semibold text-[#7A8296]">
          Assistant coach (optional)
          {asst.trim() && (
            <button
              type="button"
              onClick={() => setAsst("")}
              className="text-[11px] font-semibold text-[var(--vx-danger,#D14343)]"
            >
              Remove
            </button>
          )}
        </span>
        <input
          value={asst}
          onChange={(e) => setAsst(e.target.value)}
          placeholder="No assistant coach"
          className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
        />
      </label>

      <div className="flex gap-2 justify-end">
        <button
          onClick={onClose}
          disabled={pending}
          className="text-xs px-3 py-1.5 text-[#4A5568] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={() =>
            save({
              coach_name: coach.trim(),
              assistant_coach_name: asst.trim() || null,
            })
          }
          disabled={pending || !coach.trim()}
          className="text-xs font-semibold px-3 py-1.5 rounded-[var(--radius-pill)] text-white disabled:opacity-50"
          style={{ background: "var(--vx-success)" }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
