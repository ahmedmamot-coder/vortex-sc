"use client";

import { useState, useTransition } from "react";
import type { FitnessSection } from "@/lib/data/fitness";
import { saveFitnessPlan } from "./actions";

export default function FitnessClient({
  slug,
  squadId,
  initialSections,
}: {
  slug: string;
  squadId: string;
  initialSections: FitnessSection[];
}) {
  const [sections, setSections] = useState<FitnessSection[]>(initialSections);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function update(next: FitnessSection[]) {
    setSections(next);
    setSaved(false);
  }

  function save() {
    startTransition(async () => {
      await saveFitnessPlan(slug, squadId, sections);
      setSaved(true);
    });
  }

  return (
    <div>
      <div className="flex flex-col gap-4">
        {sections.map((section, si) => (
          <div key={si} className="rounded-[var(--radius-lg)] bg-white/5 border border-white/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <input
                value={section.name}
                onChange={(e) => {
                  const next = [...sections];
                  next[si] = { ...section, name: e.target.value };
                  update(next);
                }}
                className="text-white font-bold bg-transparent outline-none border-b border-transparent focus:border-white/30"
              />
              <button
                onClick={() => update(sections.filter((_, i) => i !== si))}
                className="text-xs text-[var(--vx-danger)]"
              >
                Remove
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {section.exercises.map((ex, ei) => (
                <div key={ei} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-1.5 items-center">
                  <input
                    value={ex.name}
                    onChange={(e) => {
                      const next = [...sections];
                      next[si].exercises[ei] = { ...ex, name: e.target.value };
                      update(next);
                    }}
                    className="rounded-[var(--radius-sm)] px-2 py-1.5 bg-white/5 border border-white/10 text-white text-sm"
                  />
                  {(["sets", "reps", "rest"] as const).map((field) => (
                    <input
                      key={field}
                      value={ex[field]}
                      placeholder={field}
                      onChange={(e) => {
                        const next = [...sections];
                        next[si].exercises[ei] = { ...ex, [field]: e.target.value };
                        update(next);
                      }}
                      className="w-16 rounded-[var(--radius-sm)] px-2 py-1.5 bg-white/5 border border-white/10 text-white text-xs"
                    />
                  ))}
                  <button
                    onClick={() => {
                      const next = [...sections];
                      next[si].exercises = section.exercises.filter((_, i) => i !== ei);
                      update(next);
                    }}
                    className="text-[var(--vx-danger)] text-xs"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={() => {
                const next = [...sections];
                next[si].exercises = [...section.exercises, { name: "New exercise", sets: "3", reps: "10", rest: "60s" }];
                update(next);
              }}
              className="mt-2 text-xs font-semibold text-white/80"
            >
              + Add exercise
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mt-4">
        <button
          onClick={() => update([...sections, { name: "New section", exercises: [] }])}
          className="rounded-[var(--radius-md)] px-4 py-2 text-sm font-semibold text-white border border-white/20"
        >
          + Add section
        </button>
        <button
          onClick={save}
          disabled={pending}
          className="rounded-[var(--radius-md)] px-4 py-2 text-sm font-semibold text-white"
          style={{ background: saved ? "var(--vx-success)" : "var(--vx-blue)" }}
        >
          {pending ? "Saving…" : saved ? "Saved ✓" : "Save plan"}
        </button>
      </div>
    </div>
  );
}
