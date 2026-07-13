import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Serve the Claude Design prototype (public/proto.html) at the site root.
  // beforeFiles runs ahead of the app router, so "/" resolves to the prototype.
  async rewrites() {
    return {
      beforeFiles: [{ source: "/", destination: "/proto.html" }],
      afterFiles: [],
      fallback: [],
    };
  },
  // Never let the browser or the Vercel CDN serve a stale copy of the app HTML,
  // so every deploy (login fixes, new staff, etc.) reflects for everyone immediately.
  async headers() {
    const noStore = [
      { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      { key: "Pragma", value: "no-cache" },
      { key: "Expires", value: "0" },
    ];
    return [
      { source: "/", headers: noStore },
      { source: "/proto.html", headers: noStore },
    ];
  },
};

export default nextConfig;
