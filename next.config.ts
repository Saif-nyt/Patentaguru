import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The app is a client-side SPA wrapped in Next; keep JS bundles lean.
  compress: true,
};

export default nextConfig;
