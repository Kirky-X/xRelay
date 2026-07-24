# Docker 部署指南

本文档提供使用 Docker 部署 xRelay 的指南。

> ⚠️ **注意**: Docker 配置文件与文档统一位于 `docker/` 子目录。所有命令需在**项目根目录**执行。

## 📋 前置要求

- Docker 20.10+
- Docker Compose 2.0+

## 📝 环境变量准备

Docker Compose 使用 `.env` 文件中的以下必需变量（`docker-compose.yml` 通过 `${VAR:?...}` 强制校验）：

```bash
# PostgreSQL（生产环境务必使用强密码 >= 32 字符随机串）
POSTGRES_USER=xrelay
POSTGRES_PASSWORD=CHANGE_ME_REQUIRED_strong_random_secret_min_32_chars
POSTGRES_DB=xrelay

# Redis（生产环境务必使用强密码 >= 32 字符随机串）
REDIS_PASSWORD=CHANGE_ME_REQUIRED_another_strong_random_secret_min_32_chars

# API Key（生产环境必需）
ENABLE_API_KEY=true   # docker-compose.yml 默认即为 true
API_KEYS=your-secret-api-key-here

# Cron 端点保护（生产环境必需，保护 /api/cron/cleanup）
CRON_SECRET=your-cron-secret-min-32-chars-random

# CORS 来源锁死（生产环境必需，逗号分隔）
CORS_ORIGINS=https://your-frontend.vercel.app

# Vercel KV / Redis（可选，未配置时缓存走内存降级）
KV_REST_API_URL=
KV_REST_API_TOKEN=
```

创建 `.env` 文件：
```bash
cp .env.example .env
# 然后编辑 .env 文件，设置强密码
```

## 🚀 快速开始

### 方式 1：使用测试脚本（推荐）

所有 compose 文件位于 `docker/` 子目录，脚本也在同一目录：

```bash
# 给脚本添加执行权限
chmod +x docker/docker-test.sh

# 运行测试脚本
./docker/docker-test.sh
```

测试脚本提供以下功能：
- 启动生产环境
- 启动开发环境
- 停止所有服务
- 查看日志
- 重启服务
- 清理所有容器和数据
- 进入 PostgreSQL 容器
- 测试 API

### 方式 2：手动启动

所有命令在**项目根目录**执行：

#### 生产环境

```bash
# 启动所有服务
docker compose -f docker/docker-compose.yml up -d

# 查看日志
docker compose -f docker/docker-compose.yml logs -f

# 停止服务
docker compose -f docker/docker-compose.yml down
```

#### 开发环境

```bash
# 启动开发环境
docker compose -f docker/docker-compose.dev.yml up -d

# 查看日志
docker compose -f docker/docker-compose.dev.yml logs -f

# 停止服务
docker compose -f docker/docker-compose.dev.yml down
```

## 📦 服务说明

### PostgreSQL

- **端口**: `127.0.0.1:15432`（仅本机访问，映射到容器内 5432）
- **用户**: 由 `POSTGRES_USER` 提供（默认 `xrelay`）
- **密码**: 由 `POSTGRES_PASSWORD` 提供（生产必须强随机串 >= 32 字符）
- **数据库**: 由 `POSTGRES_DB` 提供（默认 `xrelay`）
- **连接字符串**: `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}`

### Redis

- **端口**: `127.0.0.1:16379`（仅本机访问，映射到容器内 6379）
- **密码**: 由 `REDIS_PASSWORD` 提供
- **用途**: KV 存储（可选跨实例缓存；限流为内存实现，不依赖 Redis）

### 应用

- **端口**: `127.0.0.1:13000`（仅本机访问，映射到容器内 3000，对外应通过反向代理）
- **容器内监听**: `HOST=0.0.0.0`（compose 显式设置以接收映射流量）
- **环境变量**（由 `docker-compose.yml` 从 `.env` 注入）:
  - `NODE_ENV=production`
  - `HOST=0.0.0.0` / `PORT=3000`
  - `DATABASE_URL`: PostgreSQL 连接字符串
  - `ENABLE_API_KEY` / `API_KEYS`: API Key 验证（生产默认启用）
  - `CRON_SECRET`: 保护 `/api/cron/cleanup` 端点
  - `CORS_ORIGINS`: 锁死允许的前端来源
  - `KV_REST_API_URL` / `KV_REST_API_TOKEN`: 可选 KV 配置

## 🔧 配置

### 修改数据库密码

`docker-compose.yml` 通过 `${POSTGRES_PASSWORD:?...}` 从 `.env` 读取密码，因此直接编辑项目根目录的 `.env` 文件：

```bash
# 编辑 .env
POSTGRES_PASSWORD=your_new_strong_password_min_32_chars
```

应用容器的 `DATABASE_URL` 由 compose 自动拼接 `${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}`，无需单独维护。

修改后重启服务生效：
```bash
docker compose -f docker/docker-compose.yml --env-file .env down
docker compose -f docker/docker-compose.yml --env-file .env up -d
```

### 修改端口

编辑 `docker/docker-compose.yml`：

```yaml
services:
  app:
    ports:
      - "127.0.0.1:8080:3000"  # 将应用主机端口改为 8080（保持仅本机访问）

  postgres:
    ports:
      - "127.0.0.1:5433:5432"  # 将 PostgreSQL 主机端口改为 5433

  redis:
    ports:
      - "127.0.0.1:6380:6379"  # 将 Redis 主机端口改为 6380
```

## 🧪 测试

### 测试 API

```bash
# 使用测试脚本
./docker/docker-test.sh
# 选择 "8) 测试 API"

# 或手动测试（确保 Docker 已映射端口，生产环境需提供 x-api-key）
# 主机端口 13000 映射到容器内 3000
curl -X POST http://localhost:13000/api \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${API_KEYS}" \
  -d '{
    "url": "https://httpbin.org/ip",
    "method": "GET"
  }'
```

### 进入 PostgreSQL

```bash
# 使用测试脚本
./docker/docker-test.sh
# 选择 "7) 进入 PostgreSQL 容器"

# 或手动进入
docker exec -it xrelay-postgres psql -U xrelay -d xrelay
```

### 查看数据库状态

```sql
-- 查看可用代理
SELECT ip, port, failure_count, success_count,
       (success_count::float / (success_count + failure_count + 1)) as weight
FROM xrelay.available_proxies
ORDER BY weight DESC;

-- 查看废弃代理
SELECT ip, port, failure_count, deprecated_at
FROM xrelay.deprecated_proxies
ORDER BY deprecated_at DESC;

-- 查看迁移记录
SELECT * FROM xrelay.migrations;
```

## 📊 监控

### 查看容器状态

```bash
docker ps
```

### 查看资源使用

```bash
docker stats
```

### 查看日志

```bash
# 查看所有服务日志
docker compose -f docker/docker-compose.yml logs -f

# 查看特定服务日志
docker compose -f docker/docker-compose.yml logs -f app
docker compose -f docker/docker-compose.yml logs -f postgres
docker compose -f docker/docker-compose.yml logs -f redis
```

## 🧹 清理

### 停止并删除容器

```bash
docker compose -f docker/docker-compose.yml down
```

### 停止并删除容器和数据卷

```bash
docker compose -f docker/docker-compose.yml down -v
```

### 完全清理（包括镜像）

```bash
docker compose -f docker/docker-compose.yml down -v --rmi all
```

## 🔍 故障排查

### 容器无法启动

```bash
# 查看容器日志
docker compose -f docker/docker-compose.yml logs app

# 检查容器状态
docker ps -a
```

### 数据库连接失败

```bash
# 检查 PostgreSQL 是否健康
docker compose -f docker/docker-compose.yml ps postgres

# 查看 PostgreSQL 日志
docker compose -f docker/docker-compose.yml logs postgres

# 测试数据库连接
docker exec -it xrelay-postgres psql -U xrelay -d xrelay
```

### 端口冲突

如果端口已被占用，修改 `docker/docker-compose.yml` 中的端口映射：

```yaml
ports:
  - "127.0.0.1:3001:3000"  # 使用 3001 而不是 13000（保持仅本机访问）
```

## 📝 环境变量

### 必需变量（`docker-compose.yml` 通过 `${VAR:?...}` 强制校验）

- `POSTGRES_PASSWORD`: PostgreSQL 密码（强随机串 >= 32 字符）
- `REDIS_PASSWORD`: Redis 密码（强随机串 >= 32 字符）
- `API_KEYS`: API Keys（逗号分隔，强随机串）
- `CRON_SECRET`: 保护 `/api/cron/cleanup` 端点（强随机串 >= 32 字符）
- `CORS_ORIGINS`: 允许的前端来源（逗号分隔）

### 默认值变量（可在 `.env` 覆盖）

- `POSTGRES_USER`: 默认 `xrelay`
- `POSTGRES_DB`: 默认 `xrelay`
- `ENABLE_API_KEY`: 默认 `true`（compose 中已设）
- `NODE_ENV`: compose 中固定为 `production`
- `HOST`: compose 中固定为 `0.0.0.0`（容器内必须，主机侧已绑定 `127.0.0.1`）
- `PORT`: 默认 `3000`

### 可选变量

- `API_KEY_HEADER`: API Key 请求头名称（默认: `x-api-key`）
- `DATABASE_URL`: 未配置时使用内存模式（compose 中由 `POSTGRES_*` 自动拼接，通常无需手动设置）
- `CHROME_PATH`: 网页捕获用的 Chrome 可执行文件路径（未配置时 Vercel 环境用 `@sparticuz/chromium`）
- `ENABLE_CACHE` / `ENABLE_RATE_LIMIT` / `ENABLE_FALLBACK`: 功能开关，默认均为 `true`
- `ENABLE_VERBOSE_LOGGING`: 默认 `false`（生产应保持关闭）

### Vercel KV / Redis 配置（可选）

`KV_REST_API_URL` / `KV_REST_API_TOKEN` 用于跨实例缓存。未配置时缓存走内存 LRU 降级。**限流始终为内存滑动窗口实现，不依赖 KV/Redis。**

如需启用，在 `.env` 中设置：
```bash
KV_REST_API_URL=redis://redis:6379
KV_REST_API_TOKEN=${REDIS_PASSWORD}
```

## 🚀 生产部署建议

1. **使用环境变量文件**

```bash
# 从模板创建 .env 文件
cp .env.example .env
# 编辑 .env 文件设置强密码和 API Key

# 使用 .env 文件启动
docker compose -f docker/docker-compose.yml --env-file .env up -d
```

2. **配置资源限制**

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

3. **配置健康检查**

`docker-compose.yml` 已内置健康检查，使用 `node` 内置 `http` 模块（避免依赖 `curl`/`wget`）：

```yaml
services:
  app:
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://127.0.0.1:3000/api/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
```

端点 `/api/health` 由 `dispatchRequest` 路由处理，返回 200 + JSON（含 `version`/`uptime`/`requestId`）。

4. **使用外部数据库**

修改 `DATABASE_URL` 指向外部 PostgreSQL 实例：

```yaml
app:
  environment:
    DATABASE_URL: postgresql://user:password@external-host:5432/xrelay
```

然后从 `docker/docker-compose.yml` 中移除 `postgres` 服务。

## 📚 相关文档

- [README.md](../README.md) - 项目主文档
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 架构设计
- [DEPLOYMENT.md](./DEPLOYMENT.md) - 部署指南