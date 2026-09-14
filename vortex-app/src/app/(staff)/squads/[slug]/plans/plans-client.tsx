"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { PlanSet, Squad } from "@/lib/types";
import {
  EQUIPMENT_OPTIONS,
  SET_TYPE_OPTIONS,
  STROKE_OPTIONS,
  FOCUS_OPTIONS,
  ZONE_DEFS,
} from "@/lib/types";
import type { PlanWithSections } from "@/lib/data/plans";
import { perRepDistance } from "@/lib/plan-notation";
import PdfImport from "./pdf-import";
import {
  updatePlanMeta,
  addSection,
  removeSection,
  addSet,
  addSetFromNotation,
  addSetFromFavorite,
  removeSet,
  updateSet,
  moveSet,
  moveSetToSection,
  saveFavorite,
  deleteFavorite,
} from "./actions";
import type { PlanSetFavorite } from "@/lib/types";

const zoneColor = (id: string) => ZONE_DEFS.find((z) => z.id === id)?.color ?? "#7A8296";

/** A toggle chip in the detail editor. */
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
      className="px-2.5 py-1 rounded-[var(--radius-pill)] text-[11px] font-semibold transition-colors"
      style={{ background: active ? activeBg : "#EEF1F5", color: active ? "#fff" : "#4A5568" }}
    >
      {label}
    </button>
  );
}

/** A small read-only pill on a collapsed notation line. */
function Pill({ label, bg, color = "#fff" }: { label: string; bg: string; color?: string }) {
  return (
    <span
      className="px-2 py-0.5 rounded-[var(--radius-pill)] text-[10px] font-bold whitespace-nowrap"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  );
}

const iconBtn =
  "w-7 h-7 grid place-items-center rounded-[var(--radius-sm)] text-[#7A8296] hover:bg-[#EEF1F5] disabled:opacity-30 disabled:hover:bg-transparent";

export default function PlansClient({
  slug,
  squad,
  plan,
  favorites,
}: {
  slug: string;
  squad: Squad;
  plan: PlanWithSections;
  favorites: PlanSetFavorite[];
}) {
  const [title, setTitle] = useState(plan.title);
  const [editing, setEditing] = useState<string | null>(null);
  const [favOpen, setFavOpen] = useState(false);
  const [, startTransition] = useTransition();

  function toggle<T>(arr: T[], value: T): T[] {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
  }
  const run = (fn: () => Promise<unknown>) => startTransition(() => void fn());

  const setFields = (s: PlanSet) => ({
    distance: s.distance,
    reps: s.reps,
    stroke: s.stroke,
    description: s.description,
    equipment: s.equipment,
    set_types: s.set_types,
    focus: s.focus,
    rest: s.rest,
    zone: s.zone,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => run(() => updatePlanMeta(plan.id, slug, { title }))}
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

      {/* Session zone */}
      <div className="flex flex-wrap gap-2 mb-4">
        {ZONE_DEFS.map((z) => (
          <Chip
            key={z.id}
            active={plan.zone === z.id}
            activeBg={z.color}
            label={`${z.id} · ${z.label}`}
            onClick={() => run(() => updatePlanMeta(plan.id, slug, { zone: z.id }))}
          />
        ))}
      </div>

      {/* Favourites shelf */}
      <div className="mb-6 rounded-[var(--radius-lg)] border border-[#E5E9F0] bg-white">
        <button
          onClick={() => setFavOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-2.5"
        >
          <span className="text-sm font-bold text-[#0C1116]">
            ★ Favourites <span className="text-[#7A8296] font-semibold">({favorites.length})</span>
          </span>
          <span className="text-[#7A8296] text-xs">{favOpen ? "Hide" : "Show"}</span>
        </button>
        {favOpen && (
          <div className="px-4 pb-4 border-t border-[#EEF1F5] pt-3">
            {favorites.length === 0 ? (
              <p className="text-xs text-[#7A8296]">
                Star any set (☆) to save it here, then drop it into a plan later.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {favorites.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 flex-wrap rounded-[var(--radius-md)] bg-[#F6F7F9] px-3 py-2"
                  >
                    <span className="font-bold text-sm text-[#0C1116]">{f.label || `${f.distance}m`}</span>
                    {f.zone && <Pill label={f.zone} bg={zoneColor(f.zone)} />}
                    {f.equipment.map((e) => (
                      <Pill key={e} label={e} bg="#3B2FD6" />
                    ))}
                    {f.focus.map((x) => (
                      <Pill key={x} label={x} bg="#EEF1F5" color="#4A5568" />
                    ))}
                    <div className="ml-auto flex items-center gap-2">
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          const sectionId = e.target.value;
                          if (!sectionId) return;
                          const section = plan.sections.find((s) => s.id === sectionId);
                          run(() =>
                            addSetFromFavorite(sectionId, slug, plan.id, f.id, section?.sets.length ?? 0),
                          );
                          e.target.value = "";
                        }}
                        className="text-xs rounded-[var(--radius-sm)] border border-[#E5E9F0] bg-white px-2 py-1 text-[#0C1116]"
                      >
                        <option value="">Add to…</option>
                        {plan.sections.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => run(() => deleteFavorite(f.id, slug))}
                        className="text-[var(--vx-danger)] text-xs font-semibold"
                        aria-label="Remove favourite"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sections */}
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
                onClick={() => run(() => removeSection(section.id, slug, plan.id))}
                className="text-xs text-[var(--vx-danger)]"
              >
                Remove section
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {section.sets.map((set, idx) => {
                const per = perRepDistance(set.distance, set.reps);
                const isEditing = editing === set.id;
                return (
                  <div
                    key={set.id}
                    className="rounded-[var(--radius-md)] bg-[#F6F7F9]"
                    style={{ borderLeft: `3px solid ${set.zone ? zoneColor(set.zone) : squad.accent_color}` }}
                  >
                    {/* Collapsed notation line */}
                    <div className="flex items-start gap-2 p-3">
                      <button
                        onClick={() => setEditing(isEditing ? null : set.id)}
                        className="flex-1 text-left"
                      >
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <span className="text-[15px] font-extrabold text-[#0C1116]">
                            {set.reps > 1 ? (
                              <>
                                {set.reps} <span className="text-[#7A8296] font-semibold">×</span> {per}
                              </>
                            ) : (
                              set.distance
                            )}
                            <span className="text-[#7A8296] text-xs font-bold">m</span>
                          </span>
                          {set.stroke && (
                            <span className="text-[13px] font-extrabold" style={{ color: "var(--vx-blue)" }}>
                              {set.stroke}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                          {set.zone && <Pill label={set.zone} bg={zoneColor(set.zone)} />}
                          {set.set_types.map((t) => (
                            <Pill key={t} label={t} bg="var(--vx-blue)" />
                          ))}
                          {set.equipment.map((e) => (
                            <Pill key={e} label={e} bg="#3B2FD6" />
                          ))}
                          {set.focus.map((x) => (
                            <Pill key={x} label={x} bg="#EEF1F5" color="#4A5568" />
                          ))}
                          {set.rest && (
                            <span className="text-[11px] font-bold text-[#7A8296]">
                              {set.rest.startsWith("@") ? set.rest : `rest ${set.rest}`}
                            </span>
                          )}
                        </div>
                        {set.description && (
                          <p className="text-[12px] text-[#7A8296] mt-1.5 leading-snug">{set.description}</p>
                        )}
                      </button>

                      {/* Per-set controls */}
                      <div className="flex items-center shrink-0">
                        <button
                          className={iconBtn}
                          disabled={idx === 0}
                          onClick={() => run(() => moveSet(set.id, slug, plan.id, "up"))}
                          aria-label="Move up"
                        >
                          ▲
                        </button>
                        <button
                          className={iconBtn}
                          disabled={idx === section.sets.length - 1}
                          onClick={() => run(() => moveSet(set.id, slug, plan.id, "down"))}
                          aria-label="Move down"
                        >
                          ▼
                        </button>
                        <button
                          className={iconBtn}
                          onClick={() => run(() => saveFavorite(squad.id, slug, setFields(set)))}
                          aria-label="Save to favourites"
                          title="Save to favourites"
                        >
                          ☆
                        </button>
                        <button
                          className={iconBtn}
                          onClick={() => setEditing(isEditing ? null : set.id)}
                          aria-label="Edit set"
                        >
                          {isEditing ? "▾" : "✎"}
                        </button>
                        <button
                          className={`${iconBtn} text-[var(--vx-danger)]`}
                          onClick={() => run(() => removeSet(set.id, slug, plan.id))}
                          aria-label="Delete set"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* Expanded detail editor */}
                    {isEditing && (
                      <div className="px-3 pb-3 pt-1 border-t border-[#E5E9F0] flex flex-col gap-2.5">
                        <div className="flex items-center gap-2 flex-wrap pt-2">
                          <label className="text-[10px] text-[#7A8296] font-semibold">Reps</label>
                          <input
                            type="number"
                            min={1}
                            defaultValue={set.reps}
                            onBlur={(e) => {
                              const reps = Math.max(1, Number(e.target.value) || 1);
                              run(() => updateSet(set.id, slug, plan.id, { reps, distance: reps * per }));
                            }}
                            className="w-16 rounded-[var(--radius-sm)] bg-white border border-[#E5E9F0] px-2 py-1 text-sm"
                          />
                          <span className="text-[#7A8296] text-xs">×</span>
                          <input
                            type="number"
                            min={0}
                            defaultValue={per}
                            onBlur={(e) => {
                              const p = Math.max(0, Number(e.target.value) || 0);
                              run(() => updateSet(set.id, slug, plan.id, { distance: set.reps * p }));
                            }}
                            className="w-20 rounded-[var(--radius-sm)] bg-white border border-[#E5E9F0] px-2 py-1 text-sm"
                          />
                          <span className="text-[#7A8296] text-xs">m / rep</span>
                          <input
                            defaultValue={set.rest}
                            placeholder="rest / @send-off"
                            onBlur={(e) => run(() => updateSet(set.id, slug, plan.id, { rest: e.target.value }))}
                            className="ml-auto w-32 rounded-[var(--radius-sm)] bg-white border border-[#E5E9F0] px-2 py-1 text-xs"
                          />
                        </div>

                        <ChipRow label="Stroke">
                          {STROKE_OPTIONS.map((s) => (
                            <Chip
                              key={s}
                              active={set.stroke === s}
                              activeBg="var(--vx-blue)"
                              label={s}
                              onClick={() =>
                                run(() =>
                                  updateSet(set.id, slug, plan.id, { stroke: set.stroke === s ? null : s }),
                                )
                              }
                            />
                          ))}
                        </ChipRow>

                        <ChipRow label="Type">
                          {SET_TYPE_OPTIONS.map((t) => (
                            <Chip
                              key={t}
                              active={set.set_types.includes(t)}
                              activeBg="var(--vx-blue)"
                              label={t}
                              onClick={() =>
                                run(() =>
                                  updateSet(set.id, slug, plan.id, { set_types: toggle(set.set_types, t) }),
                                )
                              }
                            />
                          ))}
                        </ChipRow>

                        <ChipRow label="Tools">
                          {EQUIPMENT_OPTIONS.map((eq) => (
                            <Chip
                              key={eq}
                              active={set.equipment.includes(eq)}
                              activeBg="#3B2FD6"
                              label={eq}
                              onClick={() =>
                                run(() =>
                                  updateSet(set.id, slug, plan.id, { equipment: toggle(set.equipment, eq) }),
                                )
                              }
                            />
                          ))}
                        </ChipRow>

                        <ChipRow label="Zone">
                          {ZONE_DEFS.map((z) => (
                            <Chip
                              key={z.id}
                              active={set.zone === z.id}
                              activeBg={z.color}
                              label={z.id}
                              onClick={() =>
                                run(() =>
                                  updateSet(set.id, slug, plan.id, {
                                    zone: set.zone === z.id ? null : z.id,
                                  }),
                                )
                              }
                            />
                          ))}
                        </ChipRow>

                        <ChipRow label="Focus">
                          {FOCUS_OPTIONS.map((x) => (
                            <Chip
                              key={x}
                              active={set.focus.includes(x)}
                              activeBg="#0C1116"
                              label={x}
                              onClick={() =>
                                run(() => updateSet(set.id, slug, plan.id, { focus: toggle(set.focus, x) }))
                              }
                            />
                          ))}
                        </ChipRow>

                        <input
                          defaultValue={set.description}
                          placeholder="Notes — e.g. 200fr / 200 (25 scull–25 pull)"
                          onBlur={(e) =>
                            run(() => updateSet(set.id, slug, plan.id, { description: e.target.value }))
                          }
                          className="w-full rounded-[var(--radius-sm)] bg-white border border-[#E5E9F0] px-2 py-1.5 text-sm"
                        />

                        {plan.sections.length > 1 && (
                          <div className="flex items-center gap-2">
                            <label className="text-[10px] text-[#7A8296] font-semibold">Move to</label>
                            <select
                              value=""
                              onChange={(e) => {
                                if (!e.target.value) return;
                                run(() => moveSetToSection(set.id, slug, plan.id, e.target.value));
                                setEditing(null);
                              }}
                              className="text-xs rounded-[var(--radius-sm)] border border-[#E5E9F0] bg-white px-2 py-1"
                            >
                              <option value="">another section…</option>
                              {plan.sections
                                .filter((s) => s.id !== section.id)
                                .map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                            </select>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Quick-add + blank */}
            <QuickAdd
              onAdd={(text) =>
                run(() => addSetFromNotation(section.id, slug, plan.id, text, section.sets.length))
              }
            />
            <button
              onClick={() => run(() => addSet(section.id, slug, plan.id, section.sets.length))}
              className="mt-2 text-xs font-semibold text-[#4A5568]"
            >
              + Blank set
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={() =>
          run(() => addSection(plan.id, slug, "New section", plan.sections.length))
        }
        className="mt-4 rounded-[var(--radius-md)] px-4 py-2 text-sm font-semibold text-white"
        style={{ background: "var(--vx-blue)" }}
      >
        + Add section
      </button>
    </div>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] text-[#7A8296] font-semibold w-12 shrink-0">{label}</span>
      {children}
    </div>
  );
}

function QuickAdd({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText("");
  };
  return (
    <div className="mt-3 flex items-center gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Type a set — e.g. 8x100 free en2 fins @1:30"
        className="flex-1 rounded-[var(--radius-md)] border border-dashed border-[#CDD3E2] bg-[#FAFBFD] px-3 py-2 text-sm outline-none focus:border-[var(--vx-blue)]"
      />
      <button
        onClick={submit}
        className="rounded-[var(--radius-md)] px-3 py-2 text-sm font-semibold text-white shrink-0"
        style={{ background: "var(--vx-blue)" }}
      >
        Add
      </button>
    </div>
  );
}
