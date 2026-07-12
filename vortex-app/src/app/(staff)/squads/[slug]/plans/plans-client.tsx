"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { Squad } from "@/lib/types";
import { EQUIPMENT_OPTIONS, SET_TYPE_OPTIONS, ZONE_DEFS } from "@/lib/types";
import type { PlanWithSections } from "@/lib/data/plans";
import PdfImport from "./pdf-import";
import {
  updatePlanMeta,
  addSection,
  removeSection,
  addSet,
  removeSet,
  updateSet,
} from "./actions";

export default function PlansClient({
  slug,
  squad,
  plan,
}: {
  slug: string;
  squad: Squad;
  plan: PlanWithSections;
}) {
  const [title, setTitle] = useState(plan.title);
  const [, startTransition] = useTransition();

  function toggle<T>(arr: T[], value: T): T[] {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => startTransition(() => updatePlanMeta(plan.id, slug, { title }))}
          className="text-white font-bold text-lg bg-transparent border-b border-transparent focus:border-white/30 outline-none"
        />
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--vx-slate-300)]">{plan.total_metres}m total</span>
          <Link
            href={`/squads/${slug}/plans/print`}
            className="text-xs font-semibold px-3 py-1.5 rounded-[var(--radius-pill)] border border-white/20 text-white"
          >
            Print
          </Link>
        </div>
      </div>

      <PdfImport planId={plan.id} slug={slug} />

      <div className="flex flex-wrap gap-2 mb-6">
        {ZONE_DEFS.map((z) => (
          <button
            key={z.id}
            onClick={() =>
              startTransition(() => updatePlanMeta(plan.id, slug, { zone: z.id }))
            }
            className="px-3 py-1.5 rounded-[var(--radius-pill)] text-xs font-semibold"
            style={{
              background: plan.zone === z.id ? z.color : "rgba(255,255,255,0.06)",
              color: "#fff",
            }}
          >
            {z.id} · {z.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-5">
        {plan.sections.map((section) => (
          <div key={section.id} className="rounded-[var(--radius-lg)] bg-white/5 border border-white/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-white font-bold">{section.name}</span>
              <button
                onClick={() => startTransition(() => removeSection(section.id, slug, plan.id))}
                className="text-xs text-[var(--vx-danger)]"
              >
                Remove section
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {section.sets.map((set) => (
                <div
                  key={set.id}
                  className="rounded-[var(--radius-md)] p-3"
                  style={{ borderLeft: `3px solid ${squad.accent_color}`, background: "rgba(255,255,255,0.03)" }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="number"
                      defaultValue={set.distance}
                      onBlur={(e) =>
                        startTransition(() =>
                          updateSet(set.id, slug, plan.id, { distance: Number(e.target.value) }),
                        )
                      }
                      className="w-20 rounded-[var(--radius-sm)] bg-white/5 border border-white/10 px-2 py-1 text-white text-sm"
                    />
                    <span className="text-xs text-[var(--vx-slate-300)]">m</span>
                    <input
                      defaultValue={set.description}
                      onBlur={(e) =>
                        startTransition(() =>
                          updateSet(set.id, slug, plan.id, { description: e.target.value }),
                        )
                      }
                      className="flex-1 rounded-[var(--radius-sm)] bg-white/5 border border-white/10 px-2 py-1 text-white text-sm"
                    />
                    <button
                      onClick={() => startTransition(() => removeSet(set.id, slug, plan.id))}
                      className="text-[var(--vx-danger)] text-xs"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    <span className="text-[10px] text-[var(--vx-slate-300)] mr-1 self-center">Type:</span>
                    {SET_TYPE_OPTIONS.map((t) => (
                      <button
                        key={t}
                        onClick={() =>
                          startTransition(() =>
                            updateSet(set.id, slug, plan.id, {
                              set_types: toggle(set.set_types, t),
                            }),
                          )
                        }
                        className="px-2 py-0.5 rounded-[var(--radius-pill)] text-[10px] font-semibold"
                        style={{
                          background: set.set_types.includes(t) ? "var(--vx-blue)" : "rgba(255,255,255,0.06)",
                          color: "#fff",
                        }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    <span className="text-[10px] text-[var(--vx-slate-300)] mr-1 self-center">Tools:</span>
                    {EQUIPMENT_OPTIONS.map((eq) => (
                      <button
                        key={eq}
                        onClick={() =>
                          startTransition(() =>
                            updateSet(set.id, slug, plan.id, {
                              equipment: toggle(set.equipment, eq),
                            }),
                          )
                        }
                        className="px-2 py-0.5 rounded-[var(--radius-pill)] text-[10px] font-semibold"
                        style={{
                          background: set.equipment.includes(eq) ? "#3B2FD6" : "rgba(255,255,255,0.06)",
                          color: "#fff",
                        }}
                      >
                        {eq}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span className="text-[10px] text-[var(--vx-slate-300)] mr-1">Zone:</span>
                    {ZONE_DEFS.map((z) => (
                      <button
                        key={z.id}
                        onClick={() =>
                          startTransition(() => updateSet(set.id, slug, plan.id, { zone: z.id }))
                        }
                        className="px-2 py-0.5 rounded-[var(--radius-pill)] text-[10px] font-semibold"
                        style={{
                          background: (set.zone ?? plan.zone) === z.id ? z.color : "rgba(255,255,255,0.06)",
                          color: "#fff",
                        }}
                      >
                        {z.id}
                      </button>
                    ))}
                    <input
                      defaultValue={set.rest}
                      placeholder="Rest"
                      onBlur={(e) =>
                        startTransition(() => updateSet(set.id, slug, plan.id, { rest: e.target.value }))
                      }
                      className="ml-auto w-20 rounded-[var(--radius-sm)] bg-white/5 border border-white/10 px-2 py-0.5 text-white text-xs"
                    />
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() =>
                startTransition(() => addSet(section.id, slug, plan.id, section.sets.length))
              }
              className="mt-3 text-xs font-semibold text-white/80"
            >
              + Add set
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={() =>
          startTransition(() => addSection(plan.id, slug, "New section", plan.sections.length))
        }
        className="mt-4 rounded-[var(--radius-md)] px-4 py-2 text-sm font-semibold text-white"
        style={{ background: "var(--vx-blue)" }}
      >
        + Add section
      </button>
    </div>
  );
}
