import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3', '@anthropic-ai/claude-agent-sdk'],
  // A stray lockfile in the parent folder must not become the workspace root
  turbopack: { root: process.cwd() },
}

export default nextConfig
