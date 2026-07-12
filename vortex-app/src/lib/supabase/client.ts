import { createBrowserClient } from "@supabase/ssr";

// NOTE: once the Supabase project is live, run
//   npx supabase gen types typescript --project-id <id> > src/lib/supabase/types.ts
// and add `<Database>` back here for full generated type-safety.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
