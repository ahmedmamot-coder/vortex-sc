"use client";

import { useState, useTransition } from "react";
import { parsePlanText } from "@/lib/pdf-plan";
import { replacePlanFromImport } from "./actions";

export default function PdfImport({ planId, slug }: { planId: string; slug: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg("Reading PDF…");
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();

      const buf = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      const lines: string[] = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        // Group text items by their vertical position into lines.
        const rows = new Map<number, string[]>();
        for (const item of content.items as { str: string; transform: number[] }[]) {
          const y = Math.round(item.transform[5]);
          if (!rows.has(y)) rows.set(y, []);
          rows.get(y)!.push(item.str);
        }
        [...rows.entries()]
          .sort((a, b) => b[0] - a[0])
          .forEach(([, parts]) => lines.push(parts.join(" ")));
      }

      const sections = parsePlanText(lines);
      if (sections.length === 0) {
        setMsg("Couldn't find any sets in that PDF.");
        setBusy(false);
        return;
      }
      const total = sections.reduce(
        (a, s) => a + s.sets.reduce((x, y) => x + y.distance, 0),
        0,
      );
      startTransition(async () => {
        await replacePlanFromImport(planId, slug, sections);
        setMsg(`Imported ${sections.length} sections · ${total}m total.`);
        setBusy(false);
      });
    } catch {
      setMsg("Could not read that PDF.");
      setBusy(false);
    } finally {
      e.target.value = "";
    }
  }

  return (
    <div className="mb-4">
      <label className="inline-block rounded-[var(--radius-md)] border border-dashed border-white/25 px-4 py-2 text-sm font-semibold text-white cursor-pointer">
        {busy ? "Importing…" : "Import plan from PDF"}
        <input type="file" accept="application/pdf" onChange={onFile} className="hidden" disabled={busy} />
      </label>
      {msg && <p className="text-xs text-[var(--vx-slate-300)] mt-2">{msg}</p>}
    </div>
  );
}
