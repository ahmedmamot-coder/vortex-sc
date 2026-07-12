"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function registerFamily(
  _prevState: { error: string } | undefined,
  formData: FormData,
) {
  const role = String(formData.get("role") || "parent");
  const fullName = String(formData.get("full_name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  if (!fullName || !email || password.length < 6) {
    return { error: "Fill in your name, email, and a password of at least 6 characters." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };
  if (!data.user) {
    return {
      error: "Check your email to confirm your account, then sign in.",
    };
  }

  const { error: profileError } = await supabase.from("family_accounts").insert({
    id: data.user.id,
    role,
    full_name: fullName,
    email,
  });
  if (profileError) return { error: profileError.message };

  redirect("/family/link");
}

export async function searchSwimmers(query: string) {
  if (query.trim().length < 2) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_swimmers", { q: query.trim() });
  if (error) throw error;
  return data ?? [];
}

export async function linkSwimmer(swimmerId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { error } = await supabase
    .from("family_links")
    .insert({ family_account_id: user.id, swimmer_id: swimmerId });
  if (error) throw error;
}

export async function signInFamily(
  _prevState: { error: string } | undefined,
  formData: FormData,
) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Incorrect email or password." };

  redirect("/family");
}
