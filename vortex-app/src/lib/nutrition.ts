export interface InBodyReading {
  weight_kg: number | null;
  muscle_mass_kg: number | null;
  body_fat_pct: number | null;
  bmr: number | null;
  visceral_fat: number | null;
}

export interface NutritionAnalysis {
  bmi: number | null;
  bmiClass: string;
  calorieTarget: number | null;
  proteinLow: number | null;
  proteinHigh: number | null;
  notes: string[];
}

/**
 * Simple, transparent analysis from an InBody reading. Uses the scan's BMR
 * where available (swimmers train hard → activity factor ~1.6) and standard
 * athlete protein ranges (1.4–1.8 g/kg).
 */
export function analyseInBody(reading: InBodyReading, heightCm?: number): NutritionAnalysis {
  const notes: string[] = [];

  let bmi: number | null = null;
  let bmiClass = "—";
  if (reading.weight_kg && heightCm) {
    const h = heightCm / 100;
    bmi = reading.weight_kg / (h * h);
    bmiClass =
      bmi < 18.5 ? "Underweight" : bmi < 25 ? "Healthy range" : bmi < 30 ? "Overweight" : "Obese";
  }

  let calorieTarget: number | null = null;
  if (reading.bmr) {
    calorieTarget = Math.round(reading.bmr * 1.6); // hard-training swimmer
    notes.push(`Estimated ${calorieTarget} kcal/day for a hard-training day (BMR ×1.6).`);
  }

  let proteinLow: number | null = null;
  let proteinHigh: number | null = null;
  if (reading.weight_kg) {
    proteinLow = Math.round(reading.weight_kg * 1.4);
    proteinHigh = Math.round(reading.weight_kg * 1.8);
    notes.push(`Aim ${proteinLow}–${proteinHigh}g protein/day (1.4–1.8 g/kg) to support recovery.`);
  }

  if (reading.body_fat_pct != null) {
    if (reading.body_fat_pct > 25) notes.push("Body fat above typical athlete range — review energy balance.");
    else notes.push("Body fat within a healthy athlete range.");
  }
  if (reading.visceral_fat != null && reading.visceral_fat > 10) {
    notes.push("Visceral fat elevated — prioritise whole foods and consistent training.");
  }

  return { bmi, bmiClass, calorieTarget, proteinLow, proteinHigh, notes };
}
