"use client";

import { useMemo, useState, useTransition } from "react";
import type { Squad, Swimmer, PersonalBest } from "@/lib/types";
import { EVENT_CATALOG } from "@/lib/events";
import { parseTimeToSeconds } from "@/lib/format";
import {
  addSwimmer,
  updateSwimmer,
  deleteSwimmer,
  addPersonalBest,
  removePersonalBest,
} from "./actions";

type SwimmerRow = Swimmer & { squads: { name: string; slug: string }; personal_bests: PersonalBest[] };

export default function SwimmersAdminClient({
  swimmers,
  squads,
}: {
  swimmers: SwimmerRow[];
  squads: Squad[];
}) {
  const [query, setQuery] = useState("");
  const [squadFilter, setSquadFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    return swimmers.filter((s) => {
      const matchesQuery = `${s.first_name} ${s.last_name}`.toLowerCase().includes(query.toLowerCase());
      const matchesSquad = squadFilter === "all" || s.squad_id === squadFilter;
      return matchesQuery && matchesSquad;
    });
  }, [swimmers, query, squadFilter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-[#0C1116]">Swimmers</h1>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="text-sm font-semibold px-3 py-1.5 rounded-[var(--radius-pill)] text-white"
          style={{ background: "var(--vx-blue)" }}
        >
          + Add swimmer
        </button>
      </div>

      {showAdd && <AddSwimmerForm squads={squads} onClose={() => setShowAdd(false)} />}

      <div className="flex gap-2 mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name…"
          className="flex-1 rounded-[var(--radius-md)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
        />
        <select
          value={squadFilter}
          onChange={(e) => setSquadFilter(e.target.value)}
          className="rounded-[var(--radius-md)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
        >
          <option value="all">All squads</option>
          {squads.map((sq) => (
            <option key={sq.id} value={sq.id}>
              {sq.name}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-[#7A8296] mb-2">{filtered.length} swimmers</p>

      <div className="flex flex-col gap-1 max-h-[70vh] overflow-y-auto vx-scroll">
        {filtered.map((s) => (
          <div key={s.id} className="rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] p-3">
            {editingId === s.id ? (
              <EditSwimmerForm
                swimmer={s}
                squads={squads}
                onClose={() => setEditingId(null)}
              />
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[#0C1116] font-medium">
                    {s.first_name} {s.last_name}
                  </p>
                  <p className="text-xs text-[#7A8296]">
                    {s.squads?.name} · Age {s.age} · {s.gender} ·{" "}
                    {s.personal_bests[0] ? `${s.personal_bests[0].event} ${s.personal_bests[0].time_text}` : "no PBs"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingId(s.id)}
                    className="text-xs font-semibold text-[#4A5568] border border-[#E5E9F0] rounded-[var(--radius-pill)] px-3 py-1"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete ${s.first_name} ${s.last_name}?`)) {
                        startTransition(() => deleteSwimmer(s.id));
                      }
                    }}
                    className="text-xs font-semibold text-[var(--vx-danger)] border border-[#E5E9F0] rounded-[var(--radius-pill)] px-3 py-1"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AddSwimmerForm({ squads, onClose }: { squads: Squad[]; onClose: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [age, setAge] = useState(10);
  const [gender, setGender] = useState<"Girls" | "Boys">("Girls");
  const [squadId, setSquadId] = useState(squads[0]?.id ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-[var(--radius-md)] bg-white border border-[#E5E9F0] p-4 mb-4">
      <div className="grid grid-cols-2 gap-2 mb-2">
        <input
          placeholder="First name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
        />
        <input
          placeholder="Last name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
        />
        <input
          type="number"
          placeholder="Age"
          value={age}
          onChange={(e) => setAge(Number(e.target.value))}
          className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
        />
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value as "Girls" | "Boys")}
          className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
        >
          <option value="Girls">Girls</option>
          <option value="Boys">Boys</option>
        </select>
        <select
          value={squadId}
          onChange={(e) => setSquadId(e.target.value)}
          className="col-span-2 rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
        >
          {squads.map((sq) => (
            <option key={sq.id} value={sq.id}>
              {sq.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="text-xs px-3 py-1.5 text-[#4A5568]">
          Cancel
        </button>
        <button
          disabled={pending || !firstName || !lastName}
          onClick={() =>
            startTransition(async () => {
              await addSwimmer({ first_name: firstName, last_name: lastName, age, gender, squad_id: squadId });
              onClose();
            })
          }
          className="text-xs font-semibold px-3 py-1.5 rounded-[var(--radius-pill)] text-white"
          style={{ background: "var(--vx-blue)" }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function EditSwimmerForm({
  swimmer,
  squads,
  onClose,
}: {
  swimmer: SwimmerRow;
  squads: Squad[];
  onClose: () => void;
}) {
  const [firstName, setFirstName] = useState(swimmer.first_name);
  const [lastName, setLastName] = useState(swimmer.last_name);
  const [age, setAge] = useState(swimmer.age);
  const [squadId, setSquadId] = useState(swimmer.squad_id);
  const [pbs, setPbs] = useState(swimmer.personal_bests);
  const [newEvent, setNewEvent] = useState(EVENT_CATALOG[0]);
  const [newTime, setNewTime] = useState("");
  const [, startTransition] = useTransition();

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
        />
        <input
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
        />
        <input
          type="number"
          value={age}
          onChange={(e) => setAge(Number(e.target.value))}
          className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
        />
        <select
          value={squadId}
          onChange={(e) => setSquadId(e.target.value)}
          className="rounded-[var(--radius-sm)] px-3 py-2 bg-white border border-[#E5E9F0] text-[#0C1116] text-sm"
        >
          {squads.map((sq) => (
            <option key={sq.id} value={sq.id}>
              {sq.name}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-[#7A8296] mb-1">Personal Bests</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {pbs.map((pb) => (
          <span
            key={pb.id}
            className="flex items-center gap-1 text-xs bg-[#EEF1F5] rounded-[var(--radius-pill)] px-2 py-1 text-[#0C1116]"
          >
            {pb.event} · {pb.time_text}
            <button
              onClick={() => {
                startTransition(() => removePersonalBest(pb.id));
                setPbs((p) => p.filter((x) => x.id !== pb.id));
              }}
              className="text-[var(--vx-danger)] ml-1"
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5 mb-3">
        <select
          value={newEvent}
          onChange={(e) => setNewEvent(e.target.value)}
          className="rounded-[var(--radius-sm)] px-2 py-1 bg-white border border-[#E5E9F0] text-[#0C1116] text-xs"
        >
          {EVENT_CATALOG.map((ev) => (
            <option key={ev} value={ev}>
              {ev}
            </option>
          ))}
        </select>
        <input
          placeholder="e.g. 1:05.19"
          value={newTime}
          onChange={(e) => setNewTime(e.target.value)}
          className="rounded-[var(--radius-sm)] px-2 py-1 bg-white border border-[#E5E9F0] text-[#0C1116] text-xs w-28"
        />
        <button
          onClick={() => {
            const seconds = parseTimeToSeconds(newTime);
            if (seconds == null) return;
            startTransition(() => addPersonalBest(swimmer.id, newEvent, "L", seconds, newTime));
            setPbs((p) => [
              ...p.filter((x) => x.event !== newEvent),
              { id: `tmp-${Date.now()}`, swimmer_id: swimmer.id, event: newEvent, course: "L", seconds, time_text: newTime, drop_text: "", achieved_at: null },
            ]);
            setNewTime("");
          }}
          className="text-xs font-semibold px-2 py-1 rounded-[var(--radius-pill)] text-white"
          style={{ background: "var(--vx-blue)" }}
        >
          Add
        </button>
      </div>

      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="text-xs px-3 py-1.5 text-[#4A5568]">
          Cancel
        </button>
        <button
          onClick={() => {
            startTransition(() =>
              updateSwimmer(swimmer.id, {
                first_name: firstName,
                last_name: lastName,
                age,
                squad_id: squadId,
              }),
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
