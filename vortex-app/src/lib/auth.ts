import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Profile, FamilyAccount } from "@/lib/types";

export type Session =
  | { kind: "staff"; profile: Profile }
  | { kind: "family"; account: FamilyAccount }
  | { kind: "none" };

export async function getSession(): Promise<Session> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { kind: "none" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, full_name, squad_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profile) return { kind: "staff", profile: profile as Profile };

  const { data: account } = await supabase
    .from("family_accounts")
    .select("id, role, full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  if (account) return { kind: "family", account: account as FamilyAccount };

  return { kind: "none" };
}
