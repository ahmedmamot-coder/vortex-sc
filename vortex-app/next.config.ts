import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Serve the Claude Design prototype (public/proto.html) at the site root.
  // beforeFiles runs ahead of the app router, so "/" resolves to the prototype.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/proto.html" },
        { source: "/privacy", destination: "/privacy.html" },
        { source: "/consent", destination: "/consent.html" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  // Never serve a stale copy of the app HTML, so every deploy reflects immediately —
  // but "no-store" was doing that with a sledgehammer. It forbids the browser from
  // keeping the file at all, so every single open re-downloaded 1.2MB of app before
  // anyone could so much as type their username. On mobile data that is most of the
  // wait people were calling "the sign-in is slow".
  //
  // "no-cache, must-revalidate" keeps the guarantee and drops the cost: the browser
  // may keep the file but must check first, so an unchanged app comes back as a 304
  // with no body at all, and a new deploy still arrives the moment it is published.
  async headers() {
    const revalidate = [
      { key: "Cache-Control", value: "no-cache, must-revalidate" },
    ];
    return [
      { source: "/", headers: revalidate },
      { source: "/proto.html", headers: revalidate },
    ];
  },
};

export default nextConfig;
