/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['youtubei.js'],
  // Only for the packaged desktop app. Vercel does its own bundling, so
  // leaving this on everywhere would change the deploy for no reason.
  output: process.env.BUILD_DESKTOP === '1' ? 'standalone' : undefined,
  async headers() {
    return [
      {
        // WebCodecs + large in-memory muxing behave better with these set.
        source: '/(.*)',
        headers: [{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' }],
      },
    ];
  },
};

export default nextConfig;
