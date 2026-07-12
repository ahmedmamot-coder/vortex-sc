"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { searchSwimmers, linkSwimmer } from "../actions";

type Match = { id: string; full_name: string; squad_name: string; age: number; gender: string };

export default function LinkSwimmerPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Match[]>([]);
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  function onQueryChange(value: string) {
    setQuery(value);
    startTransition(async () => {
      const matches = await searchSwimmers(value);
      setResults(matches as Match[]);
    });
  }

  function onLink(id: string) {
    startTransition(async () => {
      await linkSwimmer(id);
      setLinkedIds((prev) => new Set(prev).add(id));
    });
  }

  return (
    <div
      className="flex flex-1 flex-col items-center px-6 py-16"
      style={{ background: "var(--vx-app-bg)" }}
    >
      <h1 className="text-2xl font-bold text-white mb-1">Link your swimmer</h1>
      <p className="text-[var(--vx-slate-300)] mb-8 text-sm text-center max-w-xs">
        Search by name. You can link more than one child.
      </p>

      <div className="w-full max-w-sm">
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search swimmer name…"
          className="w-full rounded-[var(--radius-md)] px-4 py-3 bg-white/5 border border-white/15 text-white placeholder:text-white/40 outline-none focus:border-[var(--vx-blue)] mb-4"
        />

        <div className="flex flex-col gap-2">
          {results.map((m) => {
            const linked = linkedIds.has(m.id);
            return (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-[var(--radius-md)] bg-white/5 border border-white/10 px-4 py-3"
              >
                <div>
                  <p className="text-white font-medium">{m.full_name}</p>
                  <p className="text-xs text-[var(--vx-slate-300)]">
                    {m.squad_name} · Age {m.age} · {m.gender}
                  </p>
                </div>
                <button
                  onClick={() => onLink(m.id)}
                  disabled={linked || pending}
                  className="rounded-[var(--radius-pill)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: linked ? "var(--vx-success)" : "var(--vx-blue)" }}
                >
                  {linked ? "Linked" : "Link"}
                </button>
              </div>
            );
          })}
          {query.length >= 2 && !pending && results.length === 0 && (
            <p className="text-sm text-[var(--vx-slate-300)] text-center py-4">No matches.</p>
          )}
        </div>

        <button
          onClick={() => router.push("/family")}
          disabled={linkedIds.size === 0}
          className="mt-6 w-full rounded-[var(--radius-md)] px-5 py-3 font-semibold text-white disabled:opacity-40"
          style={{ background: "var(--vx-blue)" }}
        >
          Done — go to portal
        </button>
      </div>
    </div>
  );
}
