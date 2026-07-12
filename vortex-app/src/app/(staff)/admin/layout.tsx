import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session.kind !== "staff") redirect("/login");
  if (session.profile.role !== "admin" && session.profile.role !== "head_coach") {
    redirect("/squads");
  }

  return <div className="max-w-3xl mx-auto px-5 py-6">{children}</div>;
}
