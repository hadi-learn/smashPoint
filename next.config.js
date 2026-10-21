/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Allow tablets/TVs on the LAN to use the dev server (Next 15 dev origin checks).
  allowedDevOrigins: ['*'],
};

export default nextConfig;
