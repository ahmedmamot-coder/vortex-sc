"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { registerFamily } from "../actions";

export default function FamilyRegisterPage() {
  const [state, formAction, pending] = useActionState(registerFamily, undefined);
  const [role, setRole] = useState<"parent" | "swimmer">("parent");

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
            Create your account
          </h1>
          <p className="m-0 text-[14px]" style={{ color: "rgba(255,255,255,.6)", lineHeight: 1.45, maxWidth: 272 }}>
            Parent or swimmer — register to follow performance.
          </p>

          <form action={formAction} className="mt-6 flex flex-col gap-3.5">
            <input type="hidden" name="role" value={role} />
            <div className="flex gap-2">
              {(["parent", "swimmer"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className="flex-1 py-2.5 rounded-[11px] font-bold text-[12.5px] capitalize"
                  style={{
                    background: role === r ? "var(--vx-blue)" : "transparent",
                    border: "1px solid rgba(255,255,255,.16)",
                    color: role === r ? "#fff" : "rgba(255,255,255,.7)",
                  }}
                >
                  I&apos;m a {r}
                </button>
              ))}
            </div>
            <input name="full_name" placeholder="Full name" required className="vx-input-dark" />
            <input name="email" type="email" placeholder="Email" required className="vx-input-dark" />
            <input name="password" type="password" placeholder="Password (min 6 characters)" required minLength={6} className="vx-input-dark" />
            {state?.error && <p className="m-0 text-[12px] font-semibold" style={{ color: "#FF8A8D" }}>{state.error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="rounded-[13px] py-3.5 font-bold text-[14px] text-white disabled:opacity-60"
              style={{ background: "var(--vx-blue)" }}
            >
              {pending ? "Creating account…" : "Continue"}
            </button>
          </form>

          <Link href="/family/login" className="mt-auto pt-8 text-[12.5px] text-center" style={{ color: "rgba(255,255,255,.55)" }}>
            Already have an account? Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
