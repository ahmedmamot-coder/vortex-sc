/** Max age for each squad, and the squad a swimmer promotes into next. */
export const SQUAD_LADDER: { slug: string; maxAge: number; next: string | null }[] = [
  { slug: "preteam", maxAge: 6, next: "advb" },
  { slug: "advb", maxAge: 8, next: "adva" },
  { slug: "adva", maxAge: 10, next: "junior" },
  { slug: "junior", maxAge: 12, next: "seniorb" },
  { slug: "seniorb", maxAge: 13, next: "seniora" },
  { slug: "seniora", maxAge: 14, next: "vortexb" },
  { slug: "vortexb", maxAge: 15, next: "vortexa" },
  { slug: "vortexa", maxAge: 16, next: "legend" },
  { slug: "legend", maxAge: 99, next: null },
];

export function squadRung(slug: string) {
  return SQUAD_LADDER.find((r) => r.slug === slug) ?? null;
}
