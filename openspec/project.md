# Project Context

## Purpose
xRelay 是一个在 Vercel 部署的免费代理转发服务，提供免费代理池和智能 Fallback 直连机制。主要目标包括：
- 通过免费代理池提供 IP 隐藏和匿名访问
- 使用 Fallback 机制确保请求的高成功率
- 通过请求限流和缓存保护资源
- 为开发者提供简单易用的 RESTful API

## Tech Stack
- **Language**: TypeScript 5.3
- **Frontend**: Vue 3 + Vite
- **Backend**: Node.js / Vercel Edge Runtime
- **HTTP Client**: undici (Node.js native fetch)
- **Testing**: Vitest
- **Deployment**: Vercel
- **Key Dependencies**:
  - `@vercel/edge` - Edge Runtime support
  - `@vercel/kv` - Key-value storage (Redis)
  - `@vitejs/plugin-vue` - Vue 3 support
  - `path-to-regexp` - URL pattern matching

## Project Conventions

### Code Style
- **TypeScript**: Strict mode enabled, ES2020 target, ESNext modules
- **Linting**: ESLint with TypeScript ESLint plugin
  - Unused variables with `_` prefix are allowed
  - `no-explicit-any` set to "warn"
  - `console.log` allowed
- **Module System**: ESM (type: "module" in package.json)
- **File Extensions**: `.ts` for TypeScript, `.vue` for Vue components
- **Imports**: Use `.js` extension for ESM compatibility

### Architecture Patterns
- **Edge-First Design**: Leverages Vercel Edge Functions for low latency
- **Modular Architecture**: Separated concerns in `api/` directory
  - `proxy-fetcher.ts` - Proxy source management
  - `proxy-tester.ts` - Proxy validation
  - `proxy-manager.ts` - Proxy pool lifecycle
  - `request-handler.ts` - Request forwarding logic
  - `rate-limiter.ts` - Rate limiting (global + IP-based)
  - `cache.ts` - Response caching
  - `security.ts` - Header sanitization
- **Fallback Pattern**: Automatic fallback to direct connection when proxy fails
- **Circuit Breaker**: Retry limits and timeout handling

### Testing Strategy
- **Framework**: Vitest
- **Environment**: Node.js
- **Test Files**: `**/*.test.ts` pattern
- **Coverage**: Currently 28 passing tests
- **Approach**: Unit tests for individual modules
- **Command**: `npm test` or `npm run test:watch`

### Git Workflow
- **Main Branch**: `main`
- **Commit Convention**: Conventional Commits
  - `feat:` - New features
  - `fix:` - Bug fixes
  - Example: `feat: add local development server for API testing`
- **Remote**: `origin/main` as default branch
- **Untracked Files**: `.iflow/`, `AGENTS.md`, `IFLOW.md`, `openspec/` (not yet committed)

## Domain Context
- **Proxy Sources**: Free proxy providers (ProxyScrape, Free Proxy List, Proxy List Download)
- **Proxy Lifecycle**: Fetch → Test → Use → Rotate (every 5 minutes)
- **Rate Limiting**:
  - Global: 10 requests/minute
  - Per IP: 5 requests/minute
- **Caching**: 5-minute TTL for responses
- **Timeout Configuration**:
  - Proxy requests: 8 seconds
  - Direct requests: 10 seconds
  - Max proxy attempts: 3

## Important Constraints
- **Vercel Free Tier**: 100GB bandwidth/month
- **Proxy Reliability**: Free proxies are unstable and may fail frequently
- **Performance**: Must handle requests quickly (<10s target)
- **Security**: Must sanitize headers to prevent information leakage
- **Edge Runtime**: Must use Edge-compatible APIs (no Node.js-specific modules)

## External Dependencies
- **Vercel Edge Network**: Global edge runtime infrastructure
- **Free Proxy Sources**:
  - ProxyScrape
  - Free Proxy List
  - Proxy List Download
- **Vercel KV**: For rate limiting and caching (optional, can use in-memory)
- **Target Servers**: Any HTTP/HTTPS endpoint that clients want to access
