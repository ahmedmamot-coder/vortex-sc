import Link from "next/link";

export default function ToolShell({
  slug,
  title,
  children,
}: {
  slug: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Link
        href={`/squads/${slug}/tools`}
        className="text-xs text-[#7A8296] mb-3 inline-block"
      >
        ← Tools
      </Link>
      <h2 className="text-[#0C1116] font-bold text-lg mb-4">{title}</h2>
      {children}
    </div>
  );
}
