import type { ParsedSection } from "@/app/(staff)/squads/[slug]/plans/actions";
import { EQUIPMENT_OPTIONS, SET_TYPE_OPTIONS } from "@/lib/types";

const SECTION_HINTS = ["warm", "pre-set", "pre set", "preset", "main", "cool", "swim down", "swim-down", "pyramid", "transition"];

function detectEquipment(line: string): string[] {
  const lower = line.toLowerCase();
  return EQUIPMENT_OPTIONS.filter((eq) => lower.includes(eq.toLowerCase().split(" ")[0]));
}
function detectTypes(line: string): string[] {
  const lower = line.toLowerCase();
  return SET_TYPE_OPTIONS.filter((t) => lower.includes(t.toLowerCase()));
}
function detectRest(line: string): string {
  const m = line.match(/@\s*\d+[:.]?\d*/);
  return m ? m[0].replace(/\s/g, "") : "";
}

// Distance can appear as "8x100" (reps × distance) or plain "400".
function detectDistance(line: string): number {
  const rep = line.match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (rep) return parseInt(rep[1], 10) * parseInt(rep[2], 10);
  const plain = line.match(/\b(\d{2,4})\s*m?\b/);
  return plain ? parseInt(plain[1], 10) : 0;
}

const FOOTER_JUNK = [/generated from/i, /vortex swimming/i, /^club$/i, /page \d+/i];

/**
 * Parse raw text lines from a coach's session-plan PDF into structured
 * sections and sets. Best-effort — the coach can tidy up in the editor.
 */
export function parsePlanText(lines: string[]): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (FOOTER_JUNK.some((re) => re.test(line))) continue;

    const lower = line.toLowerCase();
    const isHeader = SECTION_HINTS.some((h) => lower.includes(h)) && detectDistance(line) === 0;

    if (isHeader) {
      current = { name: line, sets: [] };
      sections.push(current);
      continue;
    }

    const distance = detectDistance(line);
    if (distance > 0) {
      if (!current) {
        current = { name: "Main set", sets: [] };
        sections.push(current);
      }
      current.sets.push({
        distance,
        description: line,
        equipment: detectEquipment(line),
        set_types: detectTypes(line),
        rest: detectRest(line),
      });
    }
  }

  return sections.filter((s) => s.sets.length > 0);
}
