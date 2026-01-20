# 本地开发指南

## 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 编译 TypeScript
```bash
npx tsc --outDir dist
```

### 3. 启动本地开发服务器

**方式一：使用本地开发服务器（推荐）**
```bash
npm run dev:api
```

这会启动一个同时提供前端和 API 的服务器在 `http://localhost:3000`

**方式二：分别启动前端和 API**
```bash
# 终端 1：启动前端
npm run dev

# 终端 2：需要配置 Vercel CLI（需要 yarn）
vercel dev
```

### 4. 测试 API

```bash
curl -X POST http://localhost:3000/api \
  -H "Content-Type: application/json" \
  -H "x-api-key: 2857d873479991ecf5fe331ace168fe7845c5b79ac2ed3f0edff44ac617cbe6f" \
  -d '{"url": "https://httpbin.org/ip", "method": "GET"}'
```

## 常见问题

### Q: 为什么 `npm run dev` 不能访问 `/api`？
A: `npm run dev` 只启动 Vite 前端开发服务器，不处理 API 请求。请使用 `npm run dev:api` 或 `vercel dev`。

### Q: 为什么 API 响应很慢？
A: 首次请求需要从多个来源获取代理（1500+ 个）并测试可用性，大约需要 8-10 秒。后续请求会使用缓存。

### Q: 为什么返回的是我的 IP 而不是代理 IP？
A: 免费代理的可用性很低（通常 < 5%），如果所有代理都不可用，会自动回退到直连模式。

### Q: 如何查看代理是否成功？
A: 检查响应中的字段：
- `proxyUsed: true` - 使用了代理
- `proxyUsed: false, fallbackUsed: true` - 回退到直连
- `proxyIp: "ip:port"` - 使用的代理地址

## 开发说明

- **前端端口**: 3000（可通过 vite.config.ts 修改）
- **API 端点**: `/api`
- **TypeScript 编译输出**: `dist/` 目录
- **本地服务器**: `server.js`

## 生产部署

项目已配置为在 Vercel 上部署，直接使用：
```bash
npm run deploy
```