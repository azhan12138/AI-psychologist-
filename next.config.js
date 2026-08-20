const output = process.env.NEXT_OUTPUT || undefined;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output,
  reactStrictMode: false,
  assetPrefix: process.env.BASE_PATH || "",
  basePath: process.env.BASE_PATH || "",
  trailingSlash: true,
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push("sherpa-onnx");
    }
    return config;
  },
};

module.exports = nextConfig;
