/**
 * Creates a staff login (auth user + profiles row) using the service-role key.
 *
 * Usage:
 *   npx tsx scripts/create-admin.ts <email> <password> "<Full Name>" [role]
 *
 * role defaults to "admin". Valid: admin | head_coach | coach | fitness_coach
 */
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { config } from "dotenv";

config({ path: path.join(__dirname, "..", ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const [email, password, fullName, role = "admin"] = process.argv.slice(2);

if (!email || !password || !fullName) {
  console.error('Usage: npx tsx scripts/create-admin.ts <email> <password> "<Full Name>" [role]');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

async function main() {
  // Create (or find) the auth user, email pre-confirmed.
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  let userId = created?.user?.id;

  if (createErr) {
    if (/already/i.test(createErr.message)) {
      const { data: list } = await supabase.auth.admin.listUsers();
      userId = list.users.find((u) => u.email === email)?.id;
      if (!userId) throw createErr;
      console.log("User already existed — reusing and updating profile.");
    } else {
      throw createErr;
    }
  }

  const { error: profileErr } = await supabase
    .from("profiles")
    .upsert({ id: userId!, role, full_name: fullName }, { onConflict: "id" });
  if (profileErr) throw profileErr;

  console.log(`\n✅ Staff login ready:\n   email: ${email}\n   role:  ${role}\n   name:  ${fullName}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
