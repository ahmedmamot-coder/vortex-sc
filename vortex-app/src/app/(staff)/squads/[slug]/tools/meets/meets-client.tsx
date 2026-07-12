"use client";

import { useEffect, useState, useTransition } from "react";
import type { Meet } from "@/lib/types";
import { EVENT_CATALOG } from "@/lib/events";
import { setMeetStatus, fetchEntries, addEntry, deleteEntry } from "./actions";

const STATUSES = ["upcoming", "entries_open", "in_progress", "completed"] as const;

type Entry = {
  id: string;
  event: string;
  heat: number | null;
  lane: number | null;
  swimmers: { first_name: string; last_name: string };
};

export default function MeetsClient({
  slug,
  squadId,
  squadName,
  meets,
  swimmers,
}: {
  slug: string;
  squadId: string;
  squadName: string;
  meets: Meet[];
  swimmers: { id: string; name: string }[];
}) {
  const [selectedMeet, setSelectedMeet] = useState<Meet | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [swimmerId, setSwimmerId] = useState(swimmers[0]?.id ?? "");
  const [event, setEvent] = useState(EVENT_CATALOG[0]);
  const [heat, setHeat] = useState(1);
  const [lane, setLane] = useState(4);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (selectedMeet) fetchEntries(selectedMeet.id, squadId).then((e) => setEntries(e as Entry[]));
  }, [selectedMeet, squadId]);

  if (!selectedMeet) {
    return (
      <div className="flex flex-col gap-2">
        {meets.map((m) => (
          <button
            key={m.id}
            onClick={() => setSelectedMeet(m)}
            className="text-left rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] px-4 py-3 hover:border-[#CDD3E2]"
          >
            <p className="text-[#0C1116] font-medium text-sm">{m.name}</p>
            <p className="text-xs text-[#7A8296] capitalize">{m.status.replace("_", " ")}</p>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => setSelectedMeet(null)} className="text-xs text-[#7A8296] mb-3">
        ← All meets
      </button>
      <h3 className="text-[#0C1116] font-bold mb-2">{selectedMeet.name}</h3>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => {
              startTransition(() => setMeetStatus(slug, selectedMeet.id, s));
              setSelectedMeet({ ...selectedMeet, status: s });
            }}
            className="px-2.5 py-1 rounded-[var(--radius-pill)] text-xs font-semibold capitalize"
            style={{
              background: selectedMeet.status === s ? "var(--vx-blue)" : "#EEF1F5",
              color: selectedMeet.status === s? "#fff" : "#4A5568",
            }}
          >
            {s.replace("_", " ")}
          </button>
        ))}
      </div>

      <div className="rounded-[var(--radius-lg)] bg-white border border-[#E5E9F0] p-4 mb-4">
        <p className="text-[#0C1116] font-semibold text-sm mb-3">Add entry</p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <select value={swimmerId} onChange={(e) => setSwimmerId(e.target.value)} className="rounded-[var(--radius-sm)] px-2 py-1.5 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm">
            {swimmers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select value={event} onChange={(e) => setEvent(e.target.value)} className="rounded-[var(--radius-sm)] px-2 py-1.5 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm">
            {EVENT_CATALOG.map((ev) => (
              <option key={ev} value={ev}>{ev}</option>
            ))}
          </select>
          <input type="number" value={heat} onChange={(e) => setHeat(Number(e.target.value))} placeholder="Heat" className="rounded-[var(--radius-sm)] px-2 py-1.5 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm" />
          <input type="number" value={lane} onChange={(e) => setLane(Number(e.target.value))} placeholder="Lane" className="rounded-[var(--radius-sm)] px-2 py-1.5 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm" />
        </div>
        <button
          onClick={() =>
            startTransition(async () => {
              await addEntry(slug, selectedMeet.id, squadId, swimmerId, event, heat, lane);
              const e = await fetchEntries(selectedMeet.id, squadId);
              setEntries(e as Entry[]);
            })
          }
          className="w-full rounded-[var(--radius-md)] py-2 text-sm font-semibold text-white"
          style={{ background: "var(--vx-blue)" }}
        >
          Add entry
        </button>
      </div>

      <div className="flex items-center justify-between mb-2">
        <p className="text-[#0C1116] font-semibold text-sm">Entries ({entries.length})</p>
        <button
          onClick={() => window.print()}
          className="text-xs font-semibold text-[#0C1116] border border-[#E5E9F0] rounded-[var(--radius-pill)] px-3 py-1"
        >
          Print program
        </button>
      </div>

      <div id="vx-print-sheet" className="vx-pattern-bg text-[#0C1116] rounded-[var(--radius-md)]">
        <div className="p-4">
          <p className="hidden print:block font-bold text-lg mb-2">
            Meet Program · {squadName} · {selectedMeet.name}
          </p>
          <div className="flex flex-col gap-1">
            {entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded-[var(--radius-sm)] bg-white print:bg-transparent px-3 py-2 text-sm">
                <span className="text-[#0C1116] print:text-black">
                  H{e.heat} · Ln {e.lane} · {e.swimmers.first_name} {e.swimmers.last_name}
                </span>
                <span className="text-[#7A8296] print:text-black">{e.event}</span>
                <button
                  onClick={() =>
                    startTransition(async () => {
                      await deleteEntry(slug, e.id);
                      const rows = await fetchEntries(selectedMeet.id, squadId);
                      setEntries(rows as Entry[]);
                    })
                  }
                  className="text-[var(--vx-danger)] text-xs print:hidden"
                >
                  ✕
                </button>
              </div>
            ))}
            {entries.length === 0 && (
              <p className="text-sm text-[#7A8296] print:text-black">No entries yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
