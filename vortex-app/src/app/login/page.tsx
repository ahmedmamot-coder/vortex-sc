"use client";

import Link from "next/link";
import { useActionState } from "react";
import Image from "next/image";
import { signInStaff } from "./actions";

export default function StaffLoginPage() {
  const [state, formAction, pending] = useActionState(signInStaff, undefined);

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center px-6 py-16"
      style={{ background: "var(--vx-app-bg)" }}
    >
      <Image src="/images/vx-mark.png" alt="Vortex" width={56} height={56} className="mb-6" />
      <h1 className="text-2xl font-bold text-white mb-1">Staff sign in</h1>
      <p className="text-[var(--vx-slate-300)] mb-8 text-sm">Coaches, admins &amp; club staff</p>

      <form action={formAction} className="w-full max-w-xs flex flex-col gap-3">
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
          placeholder="Password"
          required
          className="rounded-[var(--radius-md)] px-4 py-3 bg-white/5 border border-white/15 text-white placeholder:text-white/40 outline-none focus:border-[var(--vx-blue)]"
        />
        {state?.error && <p className="text-sm text-[var(--vx-danger)]">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] px-5 py-3 font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--vx-blue)" }}
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <Link href="/family/login" className="mt-8 text-sm text-[var(--vx-slate-300)] underline">
        Parent or swimmer? Sign in here
      </Link>
    </div>
  );
}
