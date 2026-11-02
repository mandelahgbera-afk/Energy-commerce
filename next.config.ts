import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The end-to-end tests run their own dev server beside yours, so they build into their own folder.
  ...(process.env.POWER_E2E_DIST ? { distDir: process.env.POWER_E2E_DIST } : {}),
};

export default nextConfig;
