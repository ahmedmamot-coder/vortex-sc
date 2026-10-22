// Your club's settings for the Vortex SC app. Fill these in before you deploy.
// They are read by the app in the browser, so only public values belong here:
// the Supabase ANON key is meant to be public; never put the service-role key in this file.
window.VX_CONFIG = {
  // Supabase → Project Settings → API
  supabaseUrl: "",       // e.g. "https://abcdefghijklmnop.supabase.co"
  supabaseAnonKey: "",   // the "anon" / "public" key

  // The two built-in administrator seats. Each must also be a user in
  // Supabase → Authentication → Users, with the same email.
  adminEmail: "",
  admin2Email: "",

  // Your live domain, without https:// (e.g. "myclub.com"). On any other address the
  // app shows an orange "STAGING · TEST COPY" bar. Leave empty for no bar.
  liveDomain: "",

  // Optional: web push notifications. The public half of the VAPID key pair whose
  // private half is VAPID_PRIVATE_KEY on the server (`npx web-push generate-vapid-keys`).
  vapidPublicKey: "",
};
