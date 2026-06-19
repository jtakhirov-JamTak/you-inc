import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  allowedDevOrigins: ["10.0.0.133"],
};

export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  sourcemaps: { disable: true },
});
