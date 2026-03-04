// 本地开发服务器 - 同时提供前端和 API
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import handler from './dist/api/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3000;

const server = createServer(async (req, res) => {
  // 处理 API 请求
  if (req.url.startsWith('/api')) {
    try {
      // 将 Node.js 的 IncomingMessage 转换为 Web Request 对象
      const url = new URL(req.url, `http://${req.headers.host}`);
      
      const webRequest = {
        method: req.method,
        headers: new Headers(req.headers),
        url: url.href,
        json: async () => {
          return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
              try {
                resolve(JSON.parse(body));
              } catch (e) {
                reject(e);
              }
            });
            req.on('error', reject);
          });
        }
      };

      const webResponse = await handler(webRequest);
      
      // 设置响应头
      for (const [key, value] of Object.entries(webResponse.headers)) {
        res.setHeader(key, value);
      }
      
      res.statusCode = webResponse.status;
      
      // 发送响应体
      const body = await webResponse.text();
      res.end(body);
      
    } catch (error) {
      console.error('API Error:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: error.message }));
    }
  } 
  // 处理静态文件请求
  else {
    try {
      let filePath = join(__dirname, 'dist', req.url === '/' ? 'index.html' : req.url);
      
      // 如果是 API 路由但文件不存在，返回 404
      if (filePath.includes('/api/')) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }
      
      const content = readFileSync(filePath);
      const ext = filePath.split('.').pop();
      const contentTypes = {
        'html': 'text/html',
        'js': 'application/javascript',
        'css': 'text/css',
        'json': 'application/json',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'svg': 'image/svg+xml',
        'ico': 'image/x-icon'
      };
      
      res.setHeader('Content-Type', contentTypes[ext] || 'text/plain');
      res.end(content);
    } catch (error) {
      // 如果文件不存在，返回 index.html（SPA 路由）
      try {
        const indexHtml = readFileSync(join(__dirname, 'dist', 'index.html'));
        res.setHeader('Content-Type', 'text/html');
        res.end(indexHtml);
      } catch (e) {
        res.statusCode = 404;
        res.end('Not Found');
      }
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 本地开发服务器运行在 http://localhost:${PORT}`);
  console.log(`📡 API 端点: http://localhost:${PORT}/api`);
  console.log(`\n测试命令:`);
  console.log(`curl -X POST http://localhost:${PORT}/api \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -H "x-api-key: YOUR_API_KEY" \\`);
  console.log(`  -d '{"url": "https://httpbin.org/ip", "method": "GET"}'\n`);
});