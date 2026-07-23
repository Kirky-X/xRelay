# Docker 部署指南

本文档提供使用 Docker 部署 xRelay 的指南。

> ⚠️ **注意**: Docker 配置文件与文档统一位于 `docker/` 子目录。所有命令需在**项目根目录**执行。

## 📋 前置要求

- Docker 20.10+
- Docker Compose 2.0+

## 📝 环境变量准备

Docker Compose 使用 `.env` 文件中的以下必需变量：

```bash
# 生产环境务必使用强密码（>= 32 字符随机串）
POSTGRES_USER=xrelay
POSTGRES_PASSWORD=CHANGE_ME_REQUIRED_strong_random_secret_min_32_chars
POSTGRES_DB=xrelay
REDIS_PASSWORD=CHANGE_ME_REQUIRED_another_strong_random_secret_min_32_chars

# API Key（生产环境必需）
ENABLE_API_KEY=true
API_KEYS=your-secret-api-key-here
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

- **端口**: 5432
- **用户**: xrelay
- **密码**: xrelay_password
- **数据库**: xrelay
- **连接字符串**: `postgresql://xrelay:xrelay_password@localhost:5432/xrelay`

### Redis

- **端口**: 6379
- **用途**: KV 存储（缓存、限流）

### 应用

- **端口**: 3000
- **环境变量**:
  - `DATABASE_URL`: PostgreSQL 连接字符串
  - `ENABLE_API_KEY`: 是否启用 API Key 验证
  - `KV_REST_API_URL`: Redis 连接 URL
  - `KV_REST_API_TOKEN`: Redis 密码

## 🔧 配置

### 修改数据库密码

编辑 `docker/docker-compose.yml` 或 `docker/docker-compose.dev.yml`：

```yaml
postgres:
  environment:
    POSTGRES_USER: xrelay
    POSTGRES_PASSWORD: your_password  # 修改这里
    POSTGRES_DB: xrelay
```

同时更新应用的环境变量：

```yaml
app:
  environment:
    DATABASE_URL: postgresql://xrelay:your_password@postgres:5432/xrelay  # 修改这里
```

### 修改端口

编辑 `docker/docker-compose.yml`：

```yaml
services:
  app:
    ports:
      - "8080:3000"  # 将应用端口改为 8080

  postgres:
    ports:
      - "5433:5432"  # 将 PostgreSQL 端口改为 5433

  redis:
    ports:
      - "6380:6379"  # 将 Redis 端口改为 6380
```

## 🧪 测试

### 测试 API

```bash
# 使用测试脚本
./docker/docker-test.sh
# 选择 "8) 测试 API"

# 或手动测试（确保 Docker 已映射端口）
curl -X POST http://localhost:3000/api \
  -H "Content-Type: application/json" \
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
  - "3001:3000"  # 使用 3001 而不是 3000
```

## 📝 环境变量

### 必需变量

- `DATABASE_URL`: PostgreSQL 连接字符串

### 可选变量

- `ENABLE_API_KEY`: 是否启用 API Key 验证（默认: false）
- `API_KEYS`: API Keys（逗号分隔）
- `API_KEY_HEADER`: API Key 请求头名称（默认: x-api-key）

### Redis 配置（可选）

如果需要使用 Redis 进行缓存和限流（需先设置 `REDIS_PASSWORD` 环境变量）：

```yaml
app:
  environment:
    KV_REST_API_URL: "redis://redis:6379"
    KV_REST_API_TOKEN: "${REDIS_PASSWORD}"
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

```yaml
services:
  app:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

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