# 使用 Node.js 作为基础镜像
FROM node:20-alpine AS builder

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装所有依赖（包括 devDependencies）
RUN npm ci

# 复制源代码
COPY . .

# 构建前端
RUN npm run build:frontend

# 构建 API (TypeScript 编译)
RUN npm run build:api

# 生产环境镜像
FROM node:20-alpine AS production

# 安装 tini 作为 init 进程，正确处理信号转发与僵尸进程回收
RUN apk add --no-cache tini

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 仅安装生产依赖
RUN npm ci --only=production

# 从 builder 阶段复制构建产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# 创建非 root 用户运行应用，降低容器逃逸影响范围
RUN addgroup -S xrelay && adduser -S -G xrelay xrelay \
    && chown -R xrelay:xrelay /app
USER xrelay

# 暴露端口
EXPOSE 3000

# 设置环境变量
ENV NODE_ENV=production

# 使用 tini 作为 entrypoint
ENTRYPOINT ["/sbin/tini", "--"]

# 启动应用
CMD ["node", "server.js"]