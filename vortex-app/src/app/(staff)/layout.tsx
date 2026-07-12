import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session.kind !== "staff") redirect("/login");

  return (
    <div className="vx-frame">
      <main className="flex-1 vx-screen">{children}</main>
    </div>
  );
}
