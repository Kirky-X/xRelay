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
# 数据库配置（可选）
DATABASE_URL=postgresql://user:password@host:5432/xrelay

# Redis 配置（可选）
KV_REST_API_URL=redis://host:6379
KV_REST_API_TOKEN=your_token

# API Key 配置（可选）
ENABLE_API_KEY=true
API_KEYS=your-secret-key-1,your-secret-key-2
API_KEY_HEADER=x-api-key
```

### 3. 部署

点击 "Deploy" 按钮即可完成部署。

## 🐳 Docker 部署

### 1. 构建镜像

```bash
docker build -t xrelay-app .
```

### 2. 运行容器

```bash
docker run -d \
  --name xrelay-app \
  -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:password@host:5432/xrelay \
  xrelay-app
```

### 3. 使用 Docker Compose

```bash
# 启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

详见 [DOCKER.md](./DOCKER.md)

## 🔧 配置说明

### 数据库配置

如果配置了 `DATABASE_URL`，应用将使用 PostgreSQL 持久化存储代理数据。未配置时使用内存模式。

### Redis 配置

Redis 用于缓存和限流。未配置时这些功能将不可用。

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
   - 检查请求频率
   - 考虑增加限流阈值

## 📚 相关文档

- [README.md](../README.md) - 项目主文档
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 架构设计
- [DOCKER.md](./DOCKER.md) - Docker 部署指南