"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import Image from "next/image";
import { registerFamily } from "../actions";

export default function FamilyRegisterPage() {
  const [state, formAction, pending] = useActionState(registerFamily, undefined);
  const [role, setRole] = useState<"parent" | "swimmer">("parent");

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center px-6 py-16"
      style={{ background: "var(--vx-app-bg)" }}
    >
      <Image src="/images/vx-mark.png" alt="Vortex" width={56} height={56} className="mb-6" />
      <h1 className="text-2xl font-bold text-white mb-1">Create your account</h1>
      <p className="text-[var(--vx-slate-300)] mb-8 text-sm">Parent or swimmer? Register below</p>

      <form action={formAction} className="w-full max-w-xs flex flex-col gap-3">
        <input type="hidden" name="role" value={role} />
        <div className="flex rounded-[var(--radius-md)] overflow-hidden border border-white/15">
          {(["parent", "swimmer"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className="flex-1 py-3 font-semibold capitalize"
              style={{
                background: role === r ? "var(--vx-blue)" : "transparent",
                color: role === r ? "#fff" : "var(--vx-slate-300)",
              }}
            >
              {r}
            </button>
          ))}
        </div>
        <input
          name="full_name"
          placeholder="Full name"
          required
          className="rounded-[var(--radius-md)] px-4 py-3 bg-white/5 border border-white/15 text-white placeholder:text-white/40 outline-none focus:border-[var(--vx-blue)]"
        />
        <input
          name="email"
          type="email"
          placeholder="Email"
          required
          className="rounded-[var(--radius-md)] px-4 py-3 bg-white/5 border border-white/15 text-white placeholder:text-white/40 outline-none focus:border-[var(--vx-blue)]"
        />
        <input
          name="password"
          type="password"
          placeholder="Password (min 6 characters)"
          required
          minLength={6}
          className="rounded-[var(--radius-md)] px-4 py-3 bg-white/5 border border-white/15 text-white placeholder:text-white/40 outline-none focus:border-[var(--vx-blue)]"
        />
        {state?.error && <p className="text-sm text-[var(--vx-danger)]">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] px-5 py-3 font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--vx-blue)" }}
        >
          {pending ? "Creating account…" : "Continue"}
        </button>
      </form>

      <Link href="/family/login" className="mt-8 text-sm text-[var(--vx-slate-300)] underline">
        Already have an account? Sign in
      </Link>
    </div>
  );
}
