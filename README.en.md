<div align="center">
<img src="docs/assets/xRelay.png" alt="xRelay Logo" height="180" />

# xRelay

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/) [![Tests](https://img.shields.io/github/actions/workflow/status/Kirky-X/xRelay/ci.yml?branch=main&label=Tests)](https://github.com/Kirky-X/xRelay/actions/workflows/ci.yml) [![Version](https://img.shields.io/github/v/release/Kirky-X/xRelay)](https://github.com/Kirky-X/xRelay/releases) [![Coverage](https://img.shields.io/badge/Coverage-92.93%25-brightgreen)](https://github.com/Kirky-X/xRelay)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FKirky-X%2FxRelay)

**[中文文档](./README.md)** | **[English](./README.en.md)**

A free proxy relay service deployed on Vercel, with free proxy pool + Fallback direct connection support.

**[📚 View Architecture Design Docs](./docs/ARCHITECTURE.md)**

</div>

---

## Features

- **🛡️ Free Proxy Pool** - Automatically fetch proxies from multiple free sources
- **🔄 Fallback Mechanism** - Automatically switch to direct connection when proxy fails
- **🚦 Rate Limiting** - Prevent abuse and protect resources
- **💾 Response Caching** - Reduce duplicate requests
- **🕵️ IP Hiding** - Hide local IP and protect privacy
- **🗄️ Database Persistence** - Support PostgreSQL storage for cross-instance proxy state sharing
- **⚡ Multi-Proxy Racing** - Select 5 proxies per request for parallel attempts, pick the fastest response
- **🕸️ Web Capture** - Support full page screenshots and content extraction
- **🏥 Health Check** - Provide service health status endpoint
- **🔑 API Key Authentication** - Support API Key verification
- **🔒 Security Protection** - DNS rebinding protection, secure response headers
- **📦 Standalone Deployment** - Support Bun binary and Docker deployment

## Usage

### Deploy to Vercel

1. Fork this project to your GitHub
2. Log in to [Vercel](https://vercel.com)
3. Click "Add New..." → "Project"
4. Select your forked repository
5. Click "Deploy"

### Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| DATABASE_URL | No | PostgreSQL connection string | Memory mode |
| API_KEYS | No | API Key list (comma-separated) | - |
| ENABLE_API_KEY | No | Enable API Key verification | false |
| ENABLE_CACHE | No | Enable response caching | true |
| ENABLE_RATE_LIMIT | No | Enable rate limiting | true |
| ENABLE_FALLBACK | No | Enable Fallback direct connection | true |
| CORS_ORIGINS | Yes (Production) | Allowed CORS origins (comma-separated) | Dev default whitelist |
| CRON_SECRET | Yes (Production) | Cron endpoint authentication secret | - |
| HOST | No | Standalone deployment listen address | 127.0.0.1 |
| PORT | No | Standalone deployment listen port | 3000 |
| CHROME_PATH | No | Puppeteer executable path | Auto-detect |
| KV_REST_API_URL | No | Vercel KV address (distributed storage) | - |
| KV_REST_API_TOKEN | No | Vercel KV access token | - |

> **Production environment mandatory**: The following 4 items must be explicitly configured in production, otherwise configuration error logs will be recorded on startup (see `validateProductionConfig` in `src/config.ts`):
> - `API_KEYS` — API Key list must be set
> - `ENABLE_API_KEY` — Must be set to `true`
> - `CRON_SECRET` — Cron endpoint authentication secret
> - `CORS_ORIGINS` — Allowed CORS origins

### Usage Example

```bash
# Use curl to call the proxy
curl -X POST "https://your-domain.vercel.app/api" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "url": "https://www.google.com/search?q=test",
    "method": "GET",
    "headers": {
      "User-Agent": "Mozilla/5.0"
    }
  }'
```

### Node.js Example

```javascript
const response = await fetch('https://your-domain.vercel.app/api', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'your-api-key'
  },
  body: JSON.stringify({
    url: 'https://example.com',
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  })
});

const result = await response.json();
console.log(result);
```

## API Documentation

### Endpoint Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api` | POST | Proxy request |
| `/api/capture` | POST | Web capture |
| `/api/health` | GET | Health check |
| `/api/ready` | GET | Readiness check (same as health, returns healthy) |
| `/api/cron/cleanup` | GET | Scheduled cleanup of deprecated proxies (requires `CRON_SECRET`) |

### Proxy Request POST /api

**Request Format:**

```json
{
  "url": "https://example.com",
  "method": "GET",
  "headers": {
    "User-Agent": "Mozilla/5.0"
  },
  "body": "request body",
  "timeout": 10000
}
```

| Field | Required | Description |
|-------|----------|-------------|
| url | Yes | Target URL |
| method | No | HTTP method, defaults to GET |
| headers | No | Custom request headers |
| body | No | Request body |
| timeout | No | Request timeout (milliseconds) |

**Response Format:**

```json
{
  "success": true,
  "body": "Response content",
  "status": 200,
  "statusText": "OK",
  "headers": {},
  "proxyUsed": true,
  "proxyIp": "1.2.3.4:8080",
  "proxySuccess": true,
  "fallbackUsed": false,
  "duration": 1500,
  "cached": false,
  "requestId": "abc123",
  "data": "Response content"
}
```

| Field | Description |
|-------|-------------|
| success | Whether the request succeeded |
| body | Response content (ProxyService path) |
| data | Response content (request-handler path) |
| status | HTTP status code |
| statusText | HTTP status text |
| headers | Response headers |
| proxyUsed | Whether a proxy was used |
| proxyIp | The proxy IP:port used |
| proxySuccess | Whether the proxy request succeeded |
| fallbackUsed | Whether a direct fallback connection was used |
| duration | Request duration (milliseconds) |
| cached | Whether cache was hit |
| requestId | Request ID |

> **Rate limit info** is returned via response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

### Web Capture POST /api/capture

Capture the HTML content of a webpage (with JS rendering support) or extract article content.

**Request Format:**

```json
{
  "url": "https://example.com",
  "options": {
    "mode": "html",
    "extractArticle": false,
    "waitTime": 1000,
    "waitForSelector": "#content",
    "scrollToEnd": false,
    "timeout": 30000,
    "userAgent": "Mozilla/5.0 ...",
    "viewport": {
      "width": 1920,
      "height": 1080
    },
    "removeScripts": false,
    "removeComments": false,
    "preserveLinks": false,
    "processIframes": false
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| url | Yes | Target URL |
| options.mode | No | Capture mode: `html` (HTML only, fast) / `full` (complete webpage, resources inlined as Data URI), default `html` |
| options.extractArticle | No | Enable article extraction (using article-extractor), default false |
| options.waitTime | No | Additional wait time (milliseconds) for dynamic content loading |
| options.waitForSelector | No | Wait for a specific selector to appear |
| options.scrollToEnd | No | Scroll to bottom to trigger lazy loading (full mode only) |
| options.timeout | No | Total timeout (milliseconds), default 30000 |
| options.userAgent | No | Custom User-Agent (randomly rotated if not specified) |
| options.viewport | No | Viewport size |
| options.removeScripts | No | Remove script tags (full mode only) |
| options.removeComments | No | Remove HTML comments |
| options.preserveLinks | No | Preserve original link href (full mode only) |
| options.processIframes | No | Process iframe content (full mode only) |

> **Degradation strategy**: When the browser is unavailable, `html` mode automatically degrades to fetch for static HTML (no JS rendering). `full` mode cannot degrade. Degraded responses have `degraded: true`.

**Response Format:**

```json
{
  "success": true,
  "data": {
    "html": "...",
    "title": "Example",
    "url": "https://example.com",
    "mode": "html",
    "degraded": false,
    "resources": {
      "images": 5,
      "styles": 2,
      "scripts": 3,
      "fonts": 0,
      "iframes": 0,
      "others": 1
    },
    "article": {
      "success": true,
      "title": "...",
      "content": "...",
      "textContent": "..."
    },
    "capturedAt": "2026-03-15T12:00:00Z",
    "duration": 1500
  },
  "requestId": "abc123",
  "duration": 1500
}
```

> `resources` is only returned in `full` mode; `article` is only returned when `extractArticle: true`.

### Health Check GET /api/health

Check service health status.

**Response Format:**

```json
{
  "status": "healthy",
  "timestamp": "2026-03-15T12:00:00Z",
  "version": "0.2.4",
  "uptime": 3600,
  "requestId": "abc123"
}
```

## Configuration

Default configuration (see `src/config.ts` and `src/middleware/rate-limit.ts`):

- **Proxy pool refresh interval**: 5 minutes
- **Max proxy attempts**: 3
- **Proxy request timeout**: 8 seconds
- **Direct connection timeout**: 10 seconds
- **Cache duration**: 5 minutes
- **Proxy endpoint rate limit**: 100 requests/minute (10 requests/minute for unknown/invalid IPs)
- **Capture endpoint rate limit**: 30 requests/minute (3 requests/minute for unknown/invalid IPs)
- **Proxies selected per request**: 5

### Database Configuration (Optional)

Supports PostgreSQL database persistence for proxy state, providing the following benefits:

- **Cross-instance sharing**: Multiple deployment instances share proxy state
- **Auto cleanup**: Deprecated proxies automatically deleted after 30 days
- **State persistence**: Quick proxy state recovery after service restart

Configuration:

1. Add `DATABASE_URL` to Vercel environment variables
2. Format: `postgresql://user:password@host:port/database`
3. Recommended: [Neon PostgreSQL](https://neon.tech/) (generous free tier)

Example:

```bash
# Neon PostgreSQL
DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require

# Local PostgreSQL
DATABASE_URL=postgresql://postgres:password@localhost:5432/xrelay
```

**Note**: If `DATABASE_URL` is not configured, the system will use memory mode, which works perfectly fine.

### API Key Configuration (Optional)

It is recommended to enable API Key verification in production:

```bash
# Set API Keys (comma-separated for multiple)
API_KEYS=key1,key2,key3

# Enable API Key verification
ENABLE_API_KEY=true
```

When making requests, add the following header:

```
x-api-key: your-api-key
```

## Project Structure

```
xRelay/
├── api/                       # Vercel Edge Functions
│   ├── index.ts              # Edge Function entry (IO adapter layer)
│   └── cron/                 # Cron endpoints
├── src/                       # Core modules
│   ├── core/                 # Core business logic
│   │   ├── proxy/            # Proxy modes
│   │   │   ├── memory-mode.ts
│   │   │   ├── database-mode.ts
│   │   │   ├── circuit-breaker.ts
│   │   │   └── types.ts
│   │   ├── proxy-service.ts  # Proxy service (with cache integration)
│   │   └── index.ts
│   ├── server/               # Cross-runtime shared handlers
│   │   └── handlers.ts       # Route dispatch and request handling
│   ├── middleware/           # Middleware
│   │   ├── rate-limit.ts     # Rate limiting (memory sliding window)
│   │   ├── auth.ts           # API Key verification
│   │   └── types.ts          # Middleware type definitions
│   ├── security/             # Security module
│   │   ├── index.ts
│   │   ├── url-validator.ts  # URL validation
│   │   └── request-validator.ts
│   ├── security.ts           # SSRF protection (DNS verification, IP blacklist/whitelist)
│   ├── database/             # Database module
│   │   ├── connection.ts     # Database connection (SCHEMA_SQL inline)
│   │   ├── available-proxies-dao.ts
│   │   ├── deprecated-proxies-dao.ts
│   │   ├── cleanup.ts        # Auto cleanup
│   │   └── index.ts
│   ├── cache/                # Cache module
│   │   └── advanced-cache.ts # LRU memory cache
│   ├── webpage-capture/      # Web capture module
│   │   ├── capture-service.ts
│   │   ├── browser-pool.ts
│   │   ├── article-extractor.ts
│   │   ├── resource-processor.ts
│   │   ├── stealth-scripts.ts
│   │   ├── config.ts
│   │   ├── types.ts
│   │   └── index.ts
│   ├── errors/               # Unified error handling
│   │   └── index.ts
│   ├── utils/                # Utility functions
│   │   ├── crypto.ts
│   │   ├── headers.ts
│   │   ├── proxy.ts
│   │   └── user-agent.ts
│   ├── shared/               # Shared components
│   │   └── error-handler.ts
│   ├── proxy-fetcher.ts      # Proxy fetching
│   ├── proxy-tester.ts       # Proxy testing
│   ├── proxy-manager.ts      # Proxy pool management
│   ├── request-handler.ts    # Request forwarding and Fallback
│   ├── config.ts             # Configuration management
│   ├── logger.ts             # Logging
│   ├── kv-client.ts          # KV storage client
│   ├── standalone.ts         # Bun standalone server entry
│   ├── index.ts              # Edge Runtime lightweight entry
│   └── types/                # Type definitions
│       └── index.ts
├── frontend/                  # Frontend source (Vue 3)
│   ├── App.vue
│   ├── main.ts
│   ├── style.css
│   └── components/
├── tests/                     # Test files
│   ├── unit/
│   ├── core/
│   ├── middleware/
│   ├── database/
│   ├── server/
│   ├── utils/
│   ├── e2e/
│   ├── __mocks__/
│   ├── setup.ts
│   └── vitest.config.ts
├── docker/                    # Docker configuration
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── docker-compose.dev.yml
│   ├── docker-test.sh
│   └── DOCKER.md
├── docs/                      # Project documentation
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   └── DOCKER.md
├── scripts/                   # Build and deployment scripts
│   ├── build-binary.sh
│   ├── ci-check.sh
│   └── deployment-test.sh
├── config/                    # Build configuration
│   ├── tsconfig.json
│   └── vite.config.ts
├── package.json
├── server.js                  # Node.js local development server
└── vercel.json
```

## Proxy Sources

- ProxyScrape (api.proxyscrape.com)
- GitHub-clarketm/proxy-list
- GitHub-ShiftyTR/Proxy-List
- GitHub-fate0/proxylist
- TheSpeedX/PROXY-List
- monosans/proxy-list

## Notes

1. Free proxies are unstable and may go down at any time
2. It is recommended to set shorter request timeouts
3. The Fallback mechanism ensures basic availability
4. Vercel free tier: 100GB bandwidth per month
5. It is recommended to enable API Key verification in production
6. Web capture features require longer timeout values

## License

MIT
