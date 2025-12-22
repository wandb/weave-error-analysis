/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Read backend port from environment, default to 8000
    const backendPort = process.env.NEXT_PUBLIC_BACKEND_PORT || '8000';
    return [
      {
        source: '/api/:path*',
        destination: `http://localhost:${backendPort}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;

