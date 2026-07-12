"use client";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="px-4 py-2 rounded-[var(--radius-md)] font-semibold text-white text-sm"
      style={{ background: "var(--vx-blue)" }}
    >
      Print / Save as PDF
    </button>
  );
}
