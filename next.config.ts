import type { NextConfig } from 'next';

// The API answers exactly as the Express version did, so Next's own extras are switched off:
// no X-Powered-By header, no ETag (always a real 200, never a cached 304), and no response compression.
const config: NextConfig = {
  poweredByHeader: false,
  generateEtags: false,
  compress: false,
  serverExternalPackages: ['pg', 'ws'],
};

export default config;
