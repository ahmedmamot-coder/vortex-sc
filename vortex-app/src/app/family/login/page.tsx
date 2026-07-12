"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInFamily } from "../actions";

export default function FamilyLoginPage() {
  const [state, formAction, pending] = useActionState(signInFamily, undefined);

  return (
    <div className="vx-frame">
      <div className="relative flex flex-col min-h-dvh text-white" style={{ background: "#0A0F1A" }}>
        <div
          className="absolute inset-0"
          style={{ backgroundImage: "url(/images/hero-dive.jpg)", backgroundSize: "cover", backgroundPosition: "center" }}
        />
        <div className="vx-hero-overlay" />

        <div className="relative flex flex-col px-7 pt-16 pb-8 flex-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/vx-mark.png" alt="Vortex" style={{ width: 52, height: 52 }} />
          <h1 className="font-bold mt-5 mb-1" style={{ fontSize: 31, letterSpacing: "-0.02em", lineHeight: 1.04 }}>
            Welcome back.
          </h1>
          <p className="m-0 text-[14px]" style={{ color: "rgba(255,255,255,.6)", lineHeight: 1.45, maxWidth: 272 }}>
            View your swimmer&apos;s PBs, attendance, results &amp; upcoming meets.
          </p>

          <form action={formAction} className="mt-8 flex flex-col gap-3.5">
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
            <p className="m-0 text-[11px]" style={{ color: "rgba(255,255,255,.4)", lineHeight: 1.5 }}>
              Read-only access to your swimmer&apos;s PBs, attendance, results and upcoming meets. No plans, no other squads.
            </p>
          </form>

          <Link href="/family/register" className="mt-auto pt-8 text-[12.5px] text-center" style={{ color: "rgba(255,255,255,.55)" }}>
            New here? Register
          </Link>
        </div>
      </div>
    </div>
  );
}
