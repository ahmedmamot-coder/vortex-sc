"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInStaff } from "./actions";

export default function StaffLoginPage() {
  const [state, formAction, pending] = useActionState(signInStaff, undefined);

  return (
    <div className="vx-frame">
      <div className="relative flex flex-col min-h-dvh text-white" style={{ background: "#0A0F1A" }}>
        <div
          className="absolute inset-0"
          style={{ backgroundImage: "url(/images/hero-coach.jpg)", backgroundSize: "cover", backgroundPosition: "center" }}
        />
        <div className="vx-hero-overlay" />

        <div className="relative flex flex-col px-7 pt-16 pb-8 flex-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/vx-mark.png" alt="Vortex" style={{ width: 52, height: 52 }} />
          <h1 className="font-bold mt-5 mb-1" style={{ fontSize: 31, letterSpacing: "-0.02em", lineHeight: 1.04 }}>
            Welcome back.
          </h1>
          <p className="m-0 text-[14px]" style={{ color: "rgba(255,255,255,.6)", lineHeight: 1.45, maxWidth: 272 }}>
            Coaches, admins &amp; club staff — sign in to your account.
          </p>

          <form action={formAction} className="mt-8 flex flex-col gap-3.5">
            <p className="text-[10.5px] font-semibold tracking-[0.14em] uppercase m-0" style={{ color: "rgba(255,255,255,.42)" }}>
              Staff account
            </p>
            <input name="email" type="email" placeholder="Email" required className="vx-input-dark" />
            <input name="password" type="password" placeholder="Password" required className="vx-input-dark" />
            {state?.error && <p className="m-0 text-[12px] font-semibold" style={{ color: "#FF8A8D" }}>{state.error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="rounded-[13px] py-3.5 font-bold text-[14px] text-white disabled:opacity-60"
              style={{ background: "var(--vx-blue)" }}
            >
              {pending ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <Link href="/family/login" className="mt-auto pt-8 text-[12.5px] text-center" style={{ color: "rgba(255,255,255,.55)" }}>
            Parent or swimmer? Sign in here
          </Link>
        </div>
      </div>
    </div>
  );
}
