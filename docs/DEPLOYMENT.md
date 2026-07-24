# xRelay 部署指南

本文档提供 xRelay 的部署指南，包括 Vercel 和 Docker 两种部署方式。

## 📋 前置要求

- Node.js 20+
- npm 或 yarn
- Git

## 🚀 Vercel 部署

### 1. 准备工作

1. Fork 项目到你的 GitHub
2. 登录 [Vercel](https://vercel.com)
3. 点击 "Add New..." → "Project"

### 2. 配置环境变量

在 Vercel 项目设置中添加以下环境变量：

```bash
# API Key 配置（生产必需）
ENABLE_API_KEY=true
API_KEYS=your-secret-key-1,your-secret-key-2
API_KEY_HEADER=x-api-key

# CORS 配置（生产必需，逗号分隔，锁死允许的前端来源）
CORS_ORIGINS=https://your-frontend.vercel.app

# 定时任务保护（生产必需，强随机串 >= 32 字符）
# 保护 /api/cron/cleanup 不被未授权触发
CRON_SECRET=your-cron-secret-min-32-chars-random

# 数据库配置（可选，未配置时使用内存模式）
DATABASE_URL=postgresql://user:password@host:5432/xrelay

# Vercel KV / Redis 配置（可选，未配置时缓存走内存降级）
KV_REST_API_URL=
KV_REST_API_TOKEN=

# 网页捕获（可选，Vercel 环境默认使用 @sparticuz/chromium）
# CHROME_PATH=/path/to/chrome

# 安全配置
NODE_ENV=production

# 功能开关（可选，以下为默认值）
# ENABLE_CACHE=true
# ENABLE_RATE_LIMIT=true
# ENABLE_FALLBACK=true
# ENABLE_VERBOSE_LOGGING=false

# 独立部署监听配置（Vercel 部署可忽略，standalone/Docker 使用）
# HOST=127.0.0.1   # 默认仅本机访问；Docker 容器内由 compose 设为 0.0.0.0
# PORT=3000
```

> ⚠️ 生产环境必须配置：`API_KEYS`、`ENABLE_API_KEY=true`、`CRON_SECRET`、`CORS_ORIGINS`。`validateProductionConfig()` 在启动时校验，缺失会记录错误日志。

### 3. 部署

点击 "Deploy" 按钮即可完成部署。

## 🐳 Docker 部署

### 前置准备

Docker Compose 需要 `.env` 文件设置以下必需变量：

```bash
# 从模板创建
cp .env.example .env

# 编辑 .env，设置强密码（>= 32 字符）
# POSTGRES_PASSWORD, REDIS_PASSWORD, API_KEYS
```

### 1. 使用 Docker Compose（推荐）

```bash
# 启动所有服务（docker/ 子目录）
docker compose -f docker/docker-compose.yml --env-file .env up -d

# 查看日志
docker compose -f docker/docker-compose.yml logs -f

# 停止服务
docker compose -f docker/docker-compose.yml down
```

### 2. 手动构建与运行

```bash
# 构建镜像
docker build -f docker/Dockerfile -t xrelay-app .

# 运行容器（生产环境必须提供下列变量）
# 主机端口 13000 映射到容器内 3000
docker run -d \
  --name xrelay-app \
  -p 127.0.0.1:13000:3000 \
  -e HOST=0.0.0.0 \
  -e PORT=3000 \
  -e NODE_ENV=production \
  -e ENABLE_API_KEY=true \
  -e API_KEYS=your-secret-api-key-here \
  -e CRON_SECRET=your-cron-secret-min-32-chars \
  -e CORS_ORIGINS=https://your-frontend.vercel.app \
  -e DATABASE_URL=postgresql://user:password@host:5432/xrelay \
  -e KV_REST_API_URL= \
  -e KV_REST_API_TOKEN= \
  xrelay-app
```

> 端口映射 `127.0.0.1:13000:3000` 仅本机访问，对外暴露应通过反向代理。容器内 `HOST` 必须为 `0.0.0.0` 才能接收映射流量。

详见 [docker/DOCKER.md](../docker/DOCKER.md) 或 [docs/DOCKER.md](./DOCKER.md)

## 🔧 配置说明

### 数据库配置

如果配置了 `DATABASE_URL`，应用将使用 PostgreSQL 持久化存储代理数据。未配置时使用内存模式。

### Vercel KV / Redis 配置

`KV_REST_API_URL` / `KV_REST_API_TOKEN` 用于跨实例缓存。未配置时缓存走内存 LRU 降级（单实例）。限流始终为内存滑动窗口实现，不依赖 KV/Redis。

### API Key 配置

启用 API Key 验证后，所有请求必须在请求头中提供有效的 API Key。

## 📊 监控

### Vercel 监控

- 访问 Vercel Dashboard
- 查看 Functions 日志
- 监控性能指标

### Docker 监控

```bash
# 查看容器日志
docker logs -f xrelay-app

# 查看容器资源使用
docker stats xrelay-app
```

## 🛠️ 故障排查

### 常见问题

1. **数据库连接失败**
   - 检查 `DATABASE_URL` 是否正确
   - 确保数据库可访问

2. **代理不可用**
   - 免费代理不稳定，这是正常现象
   - 应用会自动回退到直连

3. **限流触发**
   - 默认阈值：代理端点 `/api` 100/分，捕获端点 `/api/capture` 30/分
   - 未知/无效 IP 自动降至 1/10（防止伪造 IP 头绕过）
   - 响应头 `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` 可观察当前配额
   - 限流为内存实现，Vercel 多实例下每实例独立计数

## 📚 相关文档

- [README.md](../README.md) - 项目主文档
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 架构设计
- [DOCKER.md](./DOCKER.md) - Docker 部署指南