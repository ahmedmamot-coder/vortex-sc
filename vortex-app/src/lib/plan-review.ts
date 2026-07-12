import type { PlanWithSections } from "@/lib/data/plans";
import type { Zone } from "@/lib/types";
import { SQUAD_ZONE_MATRIX, SQUAD_VOLUME_CAP } from "@/lib/zones";

export type Finding = {
  severity: "pass" | "review" | "fail";
  message: string;
};

export type ReviewResult = {
  verdict: "pass" | "review" | "fail";
  findings: Finding[];
};

/**
 * Deterministic, rules-based review of a squad's current plan against the
 * club ruleset. Rules decide; the wording just explains.
 */
export function reviewPlan(plan: PlanWithSections, squadSlug: string): ReviewResult {
  const findings: Finding[] = [];
  const allowedZones = SQUAD_ZONE_MATRIX[squadSlug] ?? [];
  const cap = SQUAD_VOLUME_CAP[squadSlug] ?? 8000;

  const allSets = plan.sections.flatMap((s) => s.sets);

  // Rule 1: zone permission
  const usedZones = new Set<Zone>();
  usedZones.add(plan.zone);
  for (const set of allSets) if (set.zone) usedZones.add(set.zone);
  const illegalZones = [...usedZones].filter((z) => !allowedZones.includes(z));
  if (illegalZones.length) {
    findings.push({
      severity: "fail",
      message: `Uses ${illegalZones.join(", ")} — this squad is only cleared for ${allowedZones.join(", ")}.`,
    });
  } else {
    findings.push({ severity: "pass", message: "All zones used are permitted for this squad." });
  }

  // Rule 2: session volume vs cap
  if (plan.total_metres > cap) {
    findings.push({
      severity: "review",
      message: `Total ${plan.total_metres}m exceeds the ${cap}m guideline for this squad — trim or split.`,
    });
  } else if (plan.total_metres === 0) {
    findings.push({ severity: "fail", message: "Plan is empty — no distance programmed." });
  } else {
    findings.push({
      severity: "pass",
      message: `Total ${plan.total_metres}m is within the ${cap}m squad guideline.`,
    });
  }

  // Rule 3: structure — expect warm-up + a main set + cool-down
  const names = plan.sections.map((s) => s.name.toLowerCase());
  const hasWarmup = names.some((n) => n.includes("warm"));
  const hasCooldown = names.some((n) => n.includes("cool") || n.includes("swim down") || n.includes("swim-down"));
  const hasMain = names.some((n) => n.includes("main"));
  if (hasWarmup && hasCooldown && hasMain) {
    findings.push({ severity: "pass", message: "Structure includes warm-up, main set and cool-down." });
  } else {
    const missing = [
      !hasWarmup && "warm-up",
      !hasMain && "main set",
      !hasCooldown && "cool-down",
    ].filter(Boolean);
    findings.push({ severity: "review", message: `Consider adding: ${missing.join(", ")}.` });
  }

  // Rule 4: speed sets need rest
  for (const set of allSets) {
    const zone = set.zone ?? plan.zone;
    const isSpeed = zone === "SP1" || zone === "SP2" || zone === "SP3";
    if (isSpeed && !set.rest?.trim()) {
      findings.push({
        severity: "review",
        message: `Speed set "${set.description}" (${zone}) has no rest specified — sprint quality needs full recovery.`,
      });
      break;
    }
  }

  // Rule 5: high-rep aerobic honesty
  for (const set of allSets) {
    const zone = set.zone ?? plan.zone;
    const repMatch = set.description.match(/(\d+)\s*[x×]/i);
    const reps = repMatch ? parseInt(repMatch[1], 10) : 0;
    const hasInterval = /@/.test(set.description) || !!set.rest?.trim();
    if (zone === "EN2" && reps >= 8 && !hasInterval) {
      findings.push({
        severity: "review",
        message: `High-rep aerobic set "${set.description}" — add an interval (@ time) so pace stays honest.`,
      });
      break;
    }
  }

  const verdict: ReviewResult["verdict"] = findings.some((f) => f.severity === "fail")
    ? "fail"
    : findings.some((f) => f.severity === "review")
      ? "review"
      : "pass";

  return { verdict, findings };
}
