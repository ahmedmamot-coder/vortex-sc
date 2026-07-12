export function formatTime(seconds: number | null): string {
  if (seconds == null) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  if (mins > 0) return `${mins}:${secs.toFixed(2).padStart(5, "0")}`;
  return secs.toFixed(2);
}

export function parseTimeToSeconds(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.includes(":")) {
    const [m, s] = trimmed.split(":");
    const mins = Number(m);
    const secs = Number(s);
    if (Number.isNaN(mins) || Number.isNaN(secs)) return null;
    return mins * 60 + secs;
  }
  const secs = Number(trimmed);
  return Number.isNaN(secs) ? null : secs;
}

export function formatShortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}

export const DOT_COLORS = [
  "#067EEA",
  "#8A22D5",
  "#1CB87A",
  "#F5A623",
  "#E5484D",
  "#2A63E0",
  "#5D22CF",
  "#22C1DA",
];
