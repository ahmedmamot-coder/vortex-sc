import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface FitnessExercise {
  name: string;
  sets: string;
  reps: string;
  rest: string;
}
export interface FitnessSection {
  name: string;
  exercises: FitnessExercise[];
}

const DEFAULT_SECTIONS: FitnessSection[] = [
  { name: "Activation", exercises: [{ name: "Band pull-aparts", sets: "2", reps: "15", rest: "30s" }] },
  { name: "Strength", exercises: [{ name: "Goblet squat", sets: "3", reps: "8", rest: "90s" }] },
  { name: "Core", exercises: [{ name: "Plank", sets: "3", reps: "45s", rest: "45s" }] },
  { name: "Mobility", exercises: [{ name: "World's greatest stretch", sets: "2", reps: "6/side", rest: "-" }] },
];

export async function getFitnessPlan(squadId: string): Promise<FitnessSection[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("fitness_plans").select("sections").eq("squad_id", squadId).maybeSingle();
  if (data) return data.sections as FitnessSection[];

  await supabase.from("fitness_plans").insert({ squad_id: squadId, sections: DEFAULT_SECTIONS });
  return DEFAULT_SECTIONS;
}
