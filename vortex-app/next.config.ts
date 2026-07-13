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
};

export default nextConfig;
