// Is the Odoo connection set up, and does it actually work?
//
// Returns NO credentials and no key — only whether each piece exists and what Odoo said when
// asked. Written before anything can be pushed, deliberately: "it did not work" is a useless
// thing to be told about a month of fees, and every failure here has a different fix.
//
// Open it in a browser: /api/odoo/status

import {
  ODOO_URL, ODOO_DB, ODOO_USER,
  odooMissing, odooConfigured, odooLogin, odooVersion, odooDatabases, odooCanBill,
} from "@/lib/odoo";

export async function GET() {
  const missing = odooMissing();
  const head = { "cache-control": "no-store" } as const;

  if (!odooConfigured()) {
    // Even with nothing configured, the reachable half can still be checked — and knowing the
    // server answers is what separates "not set up yet" from "wrong address".
    const version = ODOO_URL ? await odooVersion() : null;
    const databases = ODOO_URL ? await odooDatabases() : null;
    return Response.json(
      {
        configured: false,
        missing,
        url: ODOO_URL || null,
        reachable: !!version,
        serverVersion: version ? version.server_version : null,
        databases,
        hint: !ODOO_URL
          ? "Set ODOO_URL to the site root — https://vortexaquatics.com, with no /odoo on the end."
          : !version
            ? "That address did not answer the API. Check it is the site root and that the server is up."
            : databases && databases.length
              ? "The server is reachable. Set ODOO_DB to one of the databases listed here, plus ODOO_USER and ODOO_API_KEY."
              : "The server is reachable but will not list its databases, which is normal. Set ODOO_DB to the database name, plus ODOO_USER and ODOO_API_KEY.",
      },
      { headers: head },
    );
  }

  const version = await odooVersion();
  let uid: number | null = null;
  let loginError: string | null = null;
  try {
    uid = await odooLogin();
  } catch (e) {
    loginError = (e as Error).message;
  }

  if (!uid) {
    return Response.json(
      {
        configured: true,
        missing: [],
        url: ODOO_URL,
        db: ODOO_DB,
        user: ODOO_USER,
        reachable: !!version,
        serverVersion: version ? version.server_version : null,
        signedIn: false,
        // Odoo returns `false` for a bad login rather than an error, so this is the common case
        // and deserves the plainer sentence.
        why: loginError || "Odoo did not accept that login. Check ODOO_DB is the right database, ODOO_USER is the login email, and ODOO_API_KEY is a Developer API Key for that same user.",
      },
      { headers: head },
    );
  }

  const bill = await odooCanBill(uid);
  return Response.json(
    {
      configured: true,
      missing: [],
      url: ODOO_URL,
      db: ODOO_DB,
      user: ODOO_USER,
      reachable: true,
      serverVersion: version ? version.server_version : null,
      signedIn: true,
      uid,
      canBill: bill.ok,
      why: bill.ok ? null : bill.why,
    },
    { headers: head },
  );
}
