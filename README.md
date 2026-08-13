<div align="center">
<img src="docs/assets/xRelay.png" alt="xRelay Logo" height="180" />

# xRelay

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/) [![Tests](https://img.shields.io/github/actions/workflow/status/Kirky-X/xRelay/ci.yml?branch=main&label=Tests)](https://github.com/Kirky-X/xRelay/actions/workflows/ci.yml) [![Version](https://img.shields.io/github/v/release/Kirky-X/xRelay)](https://github.com/Kirky-X/xRelay/releases) [![Coverage](https://img.shields.io/badge/Coverage-92.93%25-brightgreen)](https://github.com/Kirky-X/xRelay)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FKirky-X%2FxRelay)

**[中文文档](./README.md)** | **[English](./README.en.md)**

在 Vercel 部署的免费代理转发服务，支持免费代理池 + Fallback 直连。

**[📚 查看架构设计文档](./docs/ARCHITECTURE.md)**

</div>

---

## 功能特性

- **🛡️ 免费代理池** - 自动从多个免费源获取代理
- **🔄 Fallback 机制** - 代理失败时自动切换到直连
- **🚦 请求限流** - 防止滥用，保护资源
- **💾 响应缓存** - 减少重复请求
- **🕵️ IP 隐藏** - 隐藏本地 IP，保护隐私
- **🗄️ 数据库持久化** - 支持 PostgreSQL 存储，跨实例共享代理状态
- **⚡ 多代理竞速** - 每次请求选 5 个代理并行尝试，选取最快响应
- **🕸️ 网页捕获** - 支持完整网页截图、内容提取
- **🏥 健康检查** - 提供服务健康状态端点
- **🔑 API Key 认证** - 支持 API Key 验证
- **🔒 安全防护** - DNS 重绑定防护、安全响应头
- **📦 独立部署** - 支持 Bun 二进制与 Docker 部署

## 使用方法

### 部署到 Vercel

1. Fork 本项目到你的 GitHub
2. 登录 [Vercel](https://vercel.com)
3. 点击 "Add New..." → "Project"
4. 选择你 Fork 的仓库
5. 点击 "Deploy"

### 环境变量配置

| 变量名 | 必填 | 说明 | 默认值 |
|--------|------|------|--------|
| DATABASE_URL | 否 | PostgreSQL 连接字符串 | 内存模式 |
| API_KEYS | 否 | API Key 列表（逗号分隔） | - |
| ENABLE_API_KEY | 否 | 启用 API Key 验证 | false |
| ENABLE_CACHE | 否 | 启用响应缓存 | true |
| ENABLE_RATE_LIMIT | 否 | 启用请求限流 | true |
| ENABLE_FALLBACK | 否 | 启用 Fallback 直连 | true |
| CORS_ORIGINS | 是（生产） | 允许的跨域来源（逗号分隔） | 开发默认白名单 |
| CRON_SECRET | 是（生产） | Cron 端点认证密钥 | - |
| HOST | 否 | 独立部署监听地址 | 127.0.0.1 |
| PORT | 否 | 独立部署监听端口 | 3000 |
| CHROME_PATH | 否 | Puppeteer 可执行文件路径 | 自动检测 |
| KV_REST_API_URL | 否 | Vercel KV 地址（分布式存储） | - |
| KV_REST_API_TOKEN | 否 | Vercel KV 访问令牌 | - |

> **生产环境强制校验**：以下 4 项在生产环境必须显式配置，否则启动时记录配置错误日志（详见 `src/config.ts` 的 `validateProductionConfig`）：
> - `API_KEYS` — 必须设置 API Key 列表
> - `ENABLE_API_KEY` — 必须设为 `true`
> - `CRON_SECRET` — Cron 端点认证密钥
> - `CORS_ORIGINS` — 允许的跨域来源

### 使用示例

```bash
# 使用 curl 调用代理
curl -X POST "https://你的域名.vercel.app/api" \
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

### Node.js 使用示例

```javascript
const response = await fetch('https://你的域名.vercel.app/api', {
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

## API 文档

### 端点概览

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api` | POST | 代理请求 |
| `/api/capture` | POST | 网页捕获 |
| `/api/health` | GET | 健康检查 |
| `/api/ready` | GET | 就绪检查（与 health 同义，返回 healthy） |
| `/api/cron/cleanup` | GET | 定时清理废弃代理（需 `CRON_SECRET`） |

### 代理请求 POST /api

**请求格式：**

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

| 字段 | 必填 | 说明 |
|------|------|------|
| url | 是 | 目标 URL |
| method | 否 | HTTP 方法，默认为 GET |
| headers | 否 | 自定义请求头 |
| body | 否 | 请求体 |
| timeout | 否 | 请求超时（毫秒）|

**响应格式：**

```json
{
  "success": true,
  "body": "响应内容",
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
  "data": "响应内容"
}
```

| 字段 | 说明 |
|------|------|
| success | 请求是否成功 |
| body | 响应内容（ProxyService 路径） |
| data | 响应内容（request-handler 路径） |
| status | HTTP 状态码 |
| statusText | HTTP 状态文本 |
| headers | 响应头 |
| proxyUsed | 是否使用了代理 |
| proxyIp | 使用的代理 IP:端口 |
| proxySuccess | 代理请求是否成功 |
| fallbackUsed | 是否使用了 Fallback 直连 |
| duration | 请求耗时（毫秒）|
| cached | 是否命中缓存 |
| requestId | 请求 ID |

> **限流信息**通过响应头返回：`X-RateLimit-Limit`、`X-RateLimit-Remaining`、`X-RateLimit-Reset`

### 网页捕获 POST /api/capture

捕获网页的 HTML 内容（支持 JS 渲染）或提取文章正文。

**请求格式：**

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

| 字段 | 必填 | 说明 |
|------|------|------|
| url | 是 | 目标 URL |
| options.mode | 否 | 捕获模式：`html`（仅 HTML，快速）/ `full`（完整网页，资源内联为 Data URI），默认 `html` |
| options.extractArticle | 否 | 是否启用文章解析（使用 article-extractor），默认 false |
| options.waitTime | 否 | 额外等待时间（毫秒），用于动态内容加载 |
| options.waitForSelector | 否 | 等待特定选择器出现 |
| options.scrollToEnd | 否 | 是否滚动到底部触发懒加载（仅 full 模式） |
| options.timeout | 否 | 总超时时间（毫秒），默认 30000 |
| options.userAgent | 否 | 自定义 User-Agent（未指定则随机轮换） |
| options.viewport | 否 | 视口大小 |
| options.removeScripts | 否 | 是否移除脚本标签（仅 full 模式） |
| options.removeComments | 否 | 是否移除 HTML 注释 |
| options.preserveLinks | 否 | 是否保留链接原始 href（仅 full 模式） |
| options.processIframes | 否 | 是否处理 iframe 内容（仅 full 模式） |

> **降级策略**：浏览器不可用时，`html` 模式自动降级为 fetch 直接获取静态 HTML（不渲染 JS）。`full` 模式无法降级。降级响应中 `degraded: true`。

**响应格式：**

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

> `resources` 仅 `full` 模式返回；`article` 仅 `extractArticle: true` 时返回。

### 健康检查 GET /api/health

检查服务健康状态。

**响应格式：**

```json
{
  "status": "healthy",
  "timestamp": "2026-03-15T12:00:00Z",
  "version": "0.2.4",
  "uptime": 3600,
  "requestId": "abc123"
}
```

## 配置说明

默认配置（见 `src/config.ts` 与 `src/middleware/rate-limit.ts`）：

- **代理池刷新间隔**: 5 分钟
- **最大代理尝试次数**: 3 次
- **代理请求超时**: 8 秒
- **直连请求超时**: 10 秒
- **缓存时间**: 5 分钟
- **代理端点限流**: 每分钟 100 次（未知/无效 IP 降为 10 次/分）
- **捕获端点限流**: 每分钟 30 次（未知/无效 IP 降为 3 次/分）
- **每次请求选取代理数**: 5 个

### 数据库配置（可选）

支持 PostgreSQL 数据库持久化代理状态，配置后可享受以下优势：

- **跨实例共享**: 多个部署实例共享代理状态
- **自动清理**: 废弃代理 30 天后自动删除
- **状态持久化**: 服务重启后快速恢复代理状态

配置方法：

1. 在 Vercel 环境变量中添加 `DATABASE_URL`
2. 格式：`postgresql://user:password@host:port/database`
3. 推荐使用 [Neon PostgreSQL](https://neon.tech/)（免费额度充足）

示例：

```bash
# Neon PostgreSQL
DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require

# 本地 PostgreSQL
DATABASE_URL=postgresql://postgres:password@localhost:5432/xrelay
```

**注意**: 如果不配置 `DATABASE_URL`，系统将使用内存模式，功能完全正常。

### API Key 配置（可选）

生产环境建议启用 API Key 验证：

```bash
# 设置 API Keys（多个用逗号分隔）
API_KEYS=key1,key2,key3

# 启用 API Key 验证
ENABLE_API_KEY=true
```

请求时需要在 Header 中添加：

```
x-api-key: your-api-key
```

## 项目结构

```
xRelay/
├── api/                       # Vercel Edge Functions
│   ├── index.ts              # Edge Function 入口（IO 适配层）
│   └── cron/                 # Cron 端点
├── src/                       # 核心模块
│   ├── core/                 # 核心业务逻辑
│   │   ├── proxy/            # 代理模式
│   │   │   ├── memory-mode.ts
│   │   │   ├── database-mode.ts
│   │   │   ├── circuit-breaker.ts
│   │   │   └── types.ts
│   │   ├── proxy-service.ts  # 代理服务（含缓存集成）
│   │   └── index.ts
│   ├── server/               # 跨运行时共享处理器
│   │   └── handlers.ts       # 路由分发与请求处理
│   ├── middleware/           # 中间件
│   │   ├── rate-limit.ts     # 限流（内存滑动窗口）
│   │   ├── auth.ts           # API Key 验证
│   │   └── types.ts          # 中间件类型定义
│   ├── security/             # 安全模块
│   │   ├── index.ts
│   │   ├── url-validator.ts  # URL 验证
│   │   └── request-validator.ts
│   ├── security.ts           # SSRF 防护（DNS 验证、IP 黑白名单）
│   ├── database/             # 数据库模块
│   │   ├── connection.ts     # 数据库连接（SCHEMA_SQL 内联）
│   │   ├── available-proxies-dao.ts
│   │   ├── deprecated-proxies-dao.ts
│   │   ├── cleanup.ts        # 自动清理
│   │   └── index.ts
│   ├── cache/                # 缓存模块
│   │   └── advanced-cache.ts # LRU 内存缓存
│   ├── webpage-capture/      # 网页捕获模块
│   │   ├── capture-service.ts
│   │   ├── browser-pool.ts
│   │   ├── article-extractor.ts
│   │   ├── resource-processor.ts
│   │   ├── stealth-scripts.ts
│   │   ├── config.ts
│   │   ├── types.ts
│   │   └── index.ts
│   ├── errors/               # 统一错误处理
│   │   └── index.ts
│   ├── utils/                # 工具函数
│   │   ├── crypto.ts
│   │   ├── headers.ts
│   │   ├── proxy.ts
│   │   └── user-agent.ts
│   ├── shared/               # 共享组件
│   │   └── error-handler.ts
│   ├── proxy-fetcher.ts      # 代理获取
│   ├── proxy-tester.ts       # 代理测试
│   ├── proxy-manager.ts      # 代理池管理
│   ├── request-handler.ts    # 请求转发与 Fallback
│   ├── config.ts             # 配置管理
│   ├── logger.ts             # 日志
│   ├── kv-client.ts          # KV 存储客户端
│   ├── standalone.ts         # Bun 独立服务器入口
│   ├── index.ts              # Edge Runtime 轻量入口
│   └── types/                # 类型定义
│       └── index.ts
├── frontend/                  # 前端源码 (Vue 3)
│   ├── App.vue
│   ├── main.ts
│   ├── style.css
│   └── components/
├── tests/                     # 测试文件
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
├── docker/                    # Docker 配置
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── docker-compose.dev.yml
│   ├── docker-test.sh
│   └── DOCKER.md
├── docs/                      # 项目文档
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   └── DOCKER.md
├── scripts/                   # 构建与部署脚本
│   ├── build-binary.sh
│   ├── ci-check.sh
│   └── deployment-test.sh
├── config/                    # 构建配置
│   ├── tsconfig.json
│   └── vite.config.ts
├── package.json
├── server.js                  # Node.js 本地开发服务器
└── vercel.json
```

## 代理来源

- ProxyScrape (api.proxyscrape.com)
- GitHub-clarketm/proxy-list
- GitHub-ShiftyTR/Proxy-List
- GitHub-fate0/proxylist
- TheSpeedX/PROXY-List
- monosans/proxy-list

## 注意事项

1. 免费代理不稳定，可能随时失效
2. 建议设置较短的请求超时
3. Fallback 机制可确保基本可用性
4. Vercel 免费额度：每月 100GB 流量
5. 生产环境建议启用 API Key 验证
6. 网页捕获功能需要较长的超时时间

## License

MIT
