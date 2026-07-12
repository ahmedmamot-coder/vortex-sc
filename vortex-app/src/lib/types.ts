export type UserRole = "admin" | "head_coach" | "coach" | "fitness_coach" | "parent" | "swimmer";
export type Course = "L" | "S";
export type MeetStatus = "upcoming" | "entries_open" | "in_progress" | "completed";
export type Zone = "EN1" | "EN2" | "EN3" | "SP1" | "SP2" | "SP3";

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string;
  squad_id: string | null;
}

export interface Squad {
  id: string;
  slug: string;
  name: string;
  age_range: string;
  coach_name: string;
  assistant_coach_name: string | null;
  accent_color: string;
  sort_order: number;
}

export interface Swimmer {
  id: string;
  squad_id: string;
  first_name: string;
  last_name: string;
  age: number;
  gender: "Girls" | "Boys";
  photo_url: string | null;
  sponsor: boolean;
  active: boolean;
}

export interface PersonalBest {
  id: string;
  swimmer_id: string;
  event: string;
  course: Course;
  seconds: number;
  time_text: string;
  drop_text: string;
  achieved_at: string | null;
}

export interface Meet {
  id: string;
  name: string;
  meet_date: string;
  course: Course;
  status: MeetStatus;
}

export interface MeetResult {
  id: string;
  meet_id: string;
  swimmer_id: string;
  event: string;
  course: Course;
  seconds: number | null;
  time_text: string;
  place: number | null;
}

export interface Plan {
  id: string;
  squad_id: string;
  title: string;
  zone: Zone;
  total_metres: number;
  updated_at: string;
}

export interface PlanSection {
  id: string;
  plan_id: string;
  name: string;
  sort_order: number;
}

export interface PlanSet {
  id: string;
  section_id: string;
  distance: number;
  description: string;
  equipment: string[];
  set_types: string[];
  rest: string;
  zone: Zone | null;
  sort_order: number;
}

export interface Attendance {
  id: string;
  squad_id: string;
  swimmer_id: string;
  session_date: string;
  present: boolean;
}

export interface FamilyAccount {
  id: string;
  role: "parent" | "swimmer";
  full_name: string;
  email: string;
}

export const EQUIPMENT_OPTIONS = ["Fins", "Paddles", "Pull buoy", "Kickboard", "Snorkel", "Band"] as const;
export const SET_TYPE_OPTIONS = ["Swim", "Drill", "Kick", "Pull", "Scull"] as const;

export const ZONE_DEFS: { id: Zone; label: string; name: string; color: string }[] = [
  { id: "EN1", label: "Recovery", name: "Recovery", color: "#22C1DA" },
  { id: "EN2", label: "Aerobic", name: "Aerobic Endurance", color: "#1BA5E6" },
  { id: "EN3", label: "Threshold", name: "Aerobic Threshold", color: "#067EEA" },
  { id: "SP1", label: "VO2 max", name: "VO2 Max", color: "#2733D6" },
  { id: "SP2", label: "Lactate", name: "Lactate Tolerance", color: "#5D22CF" },
  { id: "SP3", label: "Sprint", name: "Sprint & Power", color: "#8A22D5" },
];
