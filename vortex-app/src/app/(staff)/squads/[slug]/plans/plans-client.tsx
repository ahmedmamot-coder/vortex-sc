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

function Chip({
  active,
  activeBg,
  label,
  onClick,
}: {
  active: boolean;
  activeBg: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-0.5 rounded-[var(--radius-pill)] text-[10px] font-semibold"
      style={{
        background: active ? activeBg : "#EEF1F5",
        color: active ? "#fff" : "#4A5568",
      }}
    >
      {label}
    </button>
  );
}

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
          className="text-[#0C1116] font-bold text-lg bg-transparent border-b border-transparent focus:border-[#CDD3E2] outline-none"
        />
        <div className="flex items-center gap-3">
          <span className="text-sm text-[#7A8296]">{plan.total_metres}m total</span>
          <Link
            href={`/squads/${slug}/plans/print`}
            className="text-xs font-semibold px-3 py-1.5 rounded-[var(--radius-pill)] border border-[#E5E9F0] text-[#0C1116]"
          >
            Print
          </Link>
        </div>
      </div>

      <PdfImport planId={plan.id} slug={slug} />

      <div className="flex flex-wrap gap-2 mb-6">
        {ZONE_DEFS.map((z) => (
          <Chip
            key={z.id}
            active={plan.zone === z.id}
            activeBg={z.color}
            label={`${z.id} · ${z.label}`}
            onClick={() => startTransition(() => updatePlanMeta(plan.id, slug, { zone: z.id }))}
          />
        ))}
      </div>

      <div className="flex flex-col gap-5">
        {plan.sections.map((section) => (
          <div
            key={section.id}
            className="rounded-[var(--radius-lg)] bg-white p-4"
            style={{ border: "1px solid #E5E9F0" }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[#0C1116] font-bold">{section.name}</span>
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
                  style={{ borderLeft: `3px solid ${squad.accent_color}`, background: "#F6F7F9" }}
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
                      className="w-20 rounded-[var(--radius-sm)] bg-white border border-[#E5E9F0] px-2 py-1 text-[#0C1116] text-sm"
                    />
                    <span className="text-xs text-[#7A8296]">m</span>
                    <input
                      defaultValue={set.description}
                      onBlur={(e) =>
                        startTransition(() =>
                          updateSet(set.id, slug, plan.id, { description: e.target.value }),
                        )
                      }
                      className="flex-1 rounded-[var(--radius-sm)] bg-white border border-[#E5E9F0] px-2 py-1 text-[#0C1116] text-sm"
                    />
                    <button
                      onClick={() => startTransition(() => removeSet(set.id, slug, plan.id))}
                      className="text-[var(--vx-danger)] text-xs"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-1.5 items-center">
                    <span className="text-[10px] text-[#7A8296] mr-1">Type:</span>
                    {SET_TYPE_OPTIONS.map((t) => (
                      <Chip
                        key={t}
                        active={set.set_types.includes(t)}
                        activeBg="var(--vx-blue)"
                        label={t}
                        onClick={() =>
                          startTransition(() =>
                            updateSet(set.id, slug, plan.id, { set_types: toggle(set.set_types, t) }),
                          )
                        }
                      />
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-1.5 items-center">
                    <span className="text-[10px] text-[#7A8296] mr-1">Tools:</span>
                    {EQUIPMENT_OPTIONS.map((eq) => (
                      <Chip
                        key={eq}
                        active={set.equipment.includes(eq)}
                        activeBg="#3B2FD6"
                        label={eq}
                        onClick={() =>
                          startTransition(() =>
                            updateSet(set.id, slug, plan.id, { equipment: toggle(set.equipment, eq) }),
                          )
                        }
                      />
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span className="text-[10px] text-[#7A8296] mr-1">Zone:</span>
                    {ZONE_DEFS.map((z) => (
                      <Chip
                        key={z.id}
                        active={(set.zone ?? plan.zone) === z.id}
                        activeBg={z.color}
                        label={z.id}
                        onClick={() => startTransition(() => updateSet(set.id, slug, plan.id, { zone: z.id }))}
                      />
                    ))}
                    <input
                      defaultValue={set.rest}
                      placeholder="Rest"
                      onBlur={(e) =>
                        startTransition(() => updateSet(set.id, slug, plan.id, { rest: e.target.value }))
                      }
                      className="ml-auto w-20 rounded-[var(--radius-sm)] bg-white border border-[#E5E9F0] px-2 py-0.5 text-[#0C1116] text-xs"
                    />
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() =>
                startTransition(() => addSet(section.id, slug, plan.id, section.sets.length))
              }
              className="mt-3 text-xs font-semibold text-[#4A5568]"
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
