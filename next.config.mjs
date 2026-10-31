/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['youtubei.js'],
  // Only for the packaged desktop app. Vercel does its own bundling, so
  // leaving this on everywhere would change the deploy for no reason.
  output: process.env.BUILD_DESKTOP === '1' ? 'standalone' : undefined,
  // The app never uses next/image — search thumbnails are plain <img> — so the
  // optimizer and its native `sharp` dependency are pure liability. In a
  // cross-built desktop bundle sharp ships as a Linux binary that cannot load
  // on macOS, so drop it entirely.
  images: { unoptimized: true },
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
