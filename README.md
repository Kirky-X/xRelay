# Vercel Proxy Shield

在 Vercel 部署的免费代理转发服务，支持免费代理池 + Fallback 直连。

## 功能特性

- **免费代理池** - 自动从多个免费源获取代理
- **Fallback 机制** - 代理失败时自动切换到 Vercel 直连
- **请求限流** - 防止滥用，保护资源
- **响应缓存** - 减少重复请求
- **IP 隐藏** - 隐藏本地 IP，保护隐私

## 使用方法

### 部署到 Vercel

1. Fork 本项目到你的 GitHub
2. 登录 [Vercel](https://vercel.com)
3. 点击 "Add New..." → "Project"
4. 选择你 Fork 的仓库
5. 点击 "Deploy"

### 使用示例

```bash
# 使用 curl 调用代理
curl -X POST "https://你的域名.vercel.app/api" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.google.com/search?q=test",
    "method": "GET",
    "headers": {
      "User-Agent": "Mozilla/5.0"
    }
  }'
```

### Rust 使用示例

```rust
use reqwest;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();

    let response = client
        .post("https://你的域名.vercel.app/api")
        .json(&serde_json::json!({
            "url": "https://www.google.com/search?q=test",
            "method": "GET",
            "headers": {
                "User-Agent": "Mozilla/5.0 (compatible; RustBot/1.0)"
            }
        }))
        .send()
        .await?;

    let result: serde_json::Value = response.json().await?;
    println!("Response: {:?}", result);

    Ok(())
}
```

## API 文档

### 请求格式

```json
{
  "url": "https://example.com",
  "method": "GET",
  "headers": {
    "User-Agent": "Mozilla/5.0"
  },
  "useCache": true
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| url | 是 | 目标 URL |
| method | 否 | HTTP 方法，默认为 GET |
| headers | 否 | 自定义请求头 |
| useCache | 否 | 是否使用缓存，默认为 true |

### 响应格式

```json
{
  "success": true,
  "data": "...",
  "status": 200,
  "usedProxy": "1.2.3.4:8080",
  "fallbackUsed": false,
  "responseTime": 1500,
  "rateLimit": {
    "global": { "allowed": true, "remaining": 9, "resetIn": 60000 },
    "ip": { "allowed": true, "remaining": 4, "resetIn": 60000 }
  }
}
```

## 配置说明

默认配置（见 `api/config.ts`）：

- **代理池刷新间隔**: 5 分钟
- **最大代理尝试次数**: 3 次
- **代理请求超时**: 8 秒
- **直连请求超时**: 10 秒
- **缓存时间**: 5 分钟
- **全局限流**: 每分钟 10 次
- **IP 限流**: 每分钟 5 次

## 项目结构

```
vercel-proxy-shield/
├── api/
│   ├── index.ts          # Edge Function 入口
│   ├── proxy-fetcher.ts  # 代理获取
│   ├── proxy-tester.ts   # 代理测试
│   ├── proxy-manager.ts  # 代理池管理
│   ├── request-handler.ts # 请求转发
│   ├── rate-limiter.ts   # 请求限流
│   ├── cache.ts          # 响应缓存
│   └── config.ts         # 配置
├── vercel.json           # Vercel 配置
├── package.json
└── tsconfig.json
```

## 代理来源

- ProxyScrape
- Free Proxy List
- Proxy List Download

## 注意事项

1. 免费代理不稳定，可能随时失效
2. 建议设置较短的请求超时
3. Fallback 机制可确保基本可用性
4. Vercel 免费额度：每月 100GB 流量

## License

MIT
