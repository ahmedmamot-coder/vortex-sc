"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signInStaff(_prevState: { error: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "Incorrect email or password." };

  // The credentials are valid, but valid does not mean staff: parents and swimmers sign in
  // through the very same Supabase Auth (they get an account the moment they register a family),
  // so a correct password here is not by itself permission to be on the staff side. Only a row in
  // `profiles` marks an account as staff — the same test the staff layout guard applies — so we
  // make it here too and turn a family account away at the door rather than signing it in and
  // bouncing it off /squads a moment later. Sign the session back out so no half-open staff
  // session is left behind, and send them to the sign-in that is actually theirs.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile) {
    await supabase.auth.signOut();
    return { error: "This sign-in is for club staff only. Parents and swimmers, please use the parent sign-in." };
  }

  redirect("/squads");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
