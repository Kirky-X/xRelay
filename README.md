<div align="center">
<img src="public/xRelay.png" alt="xRelay Logo" width="180" />

# xRelay

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/) [![Tests](https://img.shields.io/badge/Tests-28%20passing-green.svg)](https://github.com/your-repo/xRelay) [![Version](https://img.shields.io/badge/version-0.1.2-orange.svg)](https://github.com/your-repo/xRelay)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fyour-repo%2FxRelay)

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
| `/api/ready` | GET | 就绪检查 |

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
  "rateLimit": {
    "global": { "allowed": true, "remaining": 99, "resetAt": 1234567890 },
    "ip": { "allowed": true, "remaining": 4, "resetAt": 1234567890 }
  }
}
```

| 字段 | 说明 |
|------|------|
| success | 请求是否成功 |
| body | 响应内容 |
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
| rateLimit | 限流信息 |

### 网页捕获 POST /api/capture

捕获网页的 HTML 内容、截图或提取文章。

**请求格式：**

```json
{
  "url": "https://example.com",
  "options": {
    "mode": "html",
    "waitFor": 1000,
    "viewport": {
      "width": 1920,
      "height": 1080
    }
  }
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| url | 是 | 目标 URL |
| options.mode | 否 | 模式：html/screenshot/article，默认 html |
| options.waitFor | 否 | 等待时间（毫秒）|
| options.viewport | 否 | 视口大小 |

**响应格式：**

```json
{
  "success": true,
  "data": {
    "html": "...",
    "title": "Example",
    "url": "https://example.com",
    "mode": "html",
    "resources": [],
    "capturedAt": "2026-03-15T12:00:00Z",
    "duration": 1500
  },
  "requestId": "abc123",
  "duration": 1500
}
```

### 健康检查 GET /api/health

检查服务健康状态。

**响应格式：**

```json
{
  "status": "healthy",
  "timestamp": "2026-03-15T12:00:00Z",
  "version": "0.1.2",
  "uptime": 3600,
  "requestId": "abc123"
}
```

## 配置说明

默认配置（见 `src/config.ts`）：

- **代理池刷新间隔**: 5 分钟
- **最大代理尝试次数**: 3 次
- **代理请求超时**: 8 秒
- **直连请求超时**: 10 秒
- **缓存时间**: 5 分钟
- **全局限流**: 每分钟 100 次
- **IP 限流**: 每分钟 5 次
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
│   └── index.ts              # Edge Function 入口（薄入口层）
├── src/                       # 核心模块
│   ├── core/                 # 核心业务逻辑
│   │   ├── proxy/            # 代理模式
│   │   │   ├── memory-mode.ts
│   │   │   ├── database-mode.ts
│   │   │   ├── circuit-breaker.ts
│   │   │   └── types.ts
│   │   ├── proxy-service.ts  # 代理服务
│   │   ├── proxy-strategy.ts # 代理策略
│   │   └── container.ts      # 依赖注入容器
│   ├── middleware/          # 中间件
│   │   ├── rate-limit.ts     # 限流
│   │   ├── auth.ts           # 认证
│   │   ├── cors.ts          # CORS
│   │   ├── api-key.ts       # API Key 验证
│   │   ├── body-parser.ts   # 请求体解析
│   │   ├── compose.ts       # 中间件组合
│   │   └── validator.ts     # 参数验证
│   ├── security/            # 安全模块
│   │   ├── index.ts
│   │   ├── url-validator.ts # URL 验证
│   │   └── request-validator.ts
│   ├── database/            # 数据库模块
│   │   ├── connection.ts    # 数据库连接
│   │   ├── available-proxies-dao.ts
│   │   ├── deprecated-proxies-dao.ts
│   │   └── cleanup.ts       # 自动清理
│   ├── cache/               # 缓存模块
│   │   ├── index.ts
│   │   ├── advanced-cache.ts
│   │   └── types.ts
│   ├── webpage-capture/     # 网页捕获模块
│   │   ├── capture-service.ts
│   │   ├── browser-pool.ts
│   │   ├── article-extractor.ts
│   │   └── types.ts
│   ├── proxy-fetcher.ts     # 代理获取
│   ├── proxy-tester.ts      # 代理测试
│   ├── proxy-manager.ts     # 代理池管理
│   ├── request-handler.ts   # 请求转发
│   ├── rate-limiter.ts      # 请求限流
│   ├── config.ts            # 配置管理
│   ├── logger.ts            # 日志
│   └── types/               # 类型定义
├── frontend/                 # 前端源码 (Vue)
├── tests/                    # 测试文件
│   ├── unit/                # 单元测试
│   ├── middleware/          # 中间件测试
│   └── __mocks__/           # Mock 文件
├── docker/                   # Docker 配置
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── docker-compose.dev.yml
├── docs/                     # 项目文档
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   └── DOCKER.md
├── public/                   # 静态资源
├── scripts/                  # 脚本文件
├── config/                   # 配置文件
├── package.json
├── tsconfig.json
├── vite.config.ts
└── server.js
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
