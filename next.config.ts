import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every portal renders per-request, role-scoped data, so this app uses the
  // classic dynamic-rendering model instead of Cache Components.
  cacheComponents: false,
  poweredByHeader: false,
  // development only: keep the Next.js indicator off the sidebar's account card (bottom-left)
  devIndicators: { position: "bottom-right" },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The Order ID + PIN lookup was retired (migration 006). Printed slips and old
  // links still point at /track, so send them to the email login (Option 1) or the
  // quote request (Option 2). Temporary (307) so browsers do not cache it forever.
  async redirects() {
    return [
      { source: "/track/request", destination: "/customer/customize", permanent: false },
      { source: "/track/:path*", destination: "/customer/login", permanent: false },
      { source: "/customer", destination: "/customer/login", permanent: false },
      // links already emailed before the set-up flow moved (query strings are carried over)
      { source: "/customer/setup-password", destination: "/customer/set-password", permanent: false },
      { source: "/customer/auth/confirm", destination: "/auth/callback", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
