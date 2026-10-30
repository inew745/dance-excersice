/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['youtubei.js'],
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
