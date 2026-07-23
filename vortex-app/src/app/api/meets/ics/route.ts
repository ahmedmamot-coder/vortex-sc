// Public calendar feed of club meets. Families subscribe to this URL in Google/Apple
// Calendar and meets show up automatically:  https://vortexswimmingclub.com/api/meets/ics
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qhrpwiakobgcxfmcoyfg.supabase.co";
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFocnB3aWFrb2JnY3hmbWNveWZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NTgyMzQsImV4cCI6MjA5OTQzNDIzNH0.NVmLPF99O9M6rj-Srp3tP-ZkuhzIea0jSN4r0asW1eI";

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// Accept "M/D/YYYY" or "D Mon YYYY" and return YYYYMMDD, or null.
function toYmd(s: string): string | null {
  if (!s) return null;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + String(m[1]).padStart(2, "0") + String(m[2]).padStart(2, "0");
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (m) { const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mo) return m[3] + String(mo).padStart(2, "0") + String(m[1]).padStart(2, "0"); }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return m[1] + String(m[2]).padStart(2, "0") + String(m[3]).padStart(2, "0");
  return null;
}

function esc(s: string) { return String(s || "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n"); }

export async function GET() {
  let meets: Array<{ name?: string; date?: string; location?: string; course?: string }> = [];
  try {
    const r = await fetch(SB_URL + "/rest/v1/club_state?key=eq.vx_custom_meets&select=value", { headers: { apikey: SB_ANON, Authorization: "Bearer " + SB_ANON } });
    if (r.ok) { const rows = (await r.json()) as Array<{ value?: unknown }>; const v = rows[0]?.value; if (Array.isArray(v)) meets = v as typeof meets; }
  } catch {}

  const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Vortex SC//Meets//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Vortex SC Meets"];
  meets.forEach((m, i) => {
    const ymd = toYmd(m.date || "");
    if (!ymd) return;
    // all-day event; DTEND is next day per iCal spec
    const y = +ymd.slice(0, 4), mo = +ymd.slice(4, 6) - 1, d = +ymd.slice(6, 8);
    const end = new Date(Date.UTC(y, mo, d + 1));
    const endYmd = end.toISOString().slice(0, 10).replace(/-/g, "");
    lines.push(
      "BEGIN:VEVENT",
      "UID:vortex-meet-" + i + "-" + ymd + "@vortexswimmingclub.com",
      "DTSTAMP:" + now,
      "DTSTART;VALUE=DATE:" + ymd,
      "DTEND;VALUE=DATE:" + endYmd,
      "SUMMARY:" + esc(m.name || "Meet"),
      "LOCATION:" + esc(m.location || ""),
      "DESCRIPTION:" + esc((m.course || "") + " · Vortex SC"),
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n"), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
