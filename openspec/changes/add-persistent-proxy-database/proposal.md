# Change: Add Persistent Proxy Database

## Why
当前代理池使用内存存储，存在以下问题：
1. 服务重启后代理状态丢失，需要重新测试所有代理
2. 失败代理的黑名单仅在内存中，无法跨实例共享
3. 无法追踪代理的历史使用情况和失败次数
4. 多实例部署时每个实例维护独立的代理池，造成资源浪费

引入 PostgreSQL 持久化存储可以：
- 保存代理状态，服务重启后快速恢复
- 跨实例共享代理状态，提高整体效率
- 记录代理失败次数，智能筛选高可用代理
- 支持代理权重机制，优先使用成功率高的代理

## What Changes
- 新增 PostgreSQL 数据库支持（通过 DATABASE_URL 环境变量配置）
- 创建两张表：
  - `available_proxies`: 存储可用代理及其状态（失败次数、权重等）
  - `deprecated_proxies`: 存储废弃代理（失败次数超过阈值）
- 修改代理管理逻辑：
  - 项目启动时从代理池加载 IP 并存入数据库
  - 代理使用失败时失败次数 +1，超过 10 次移入废弃表
  - 根据权重选取代理（成功率高的权重更高）
  - 可用代理 < 5 个时，重新获取代理池数据（过滤废弃表中的 IP）
  - IP 废弃 30 天后自动从废弃表删除
  - 使用 IP 前先检测可达性，不可达直接移入废弃表
  - 每次请求选 5 个 IP，依次回退尝试

## Impact
- Affected specs: `proxy-database` (新增)
- Affected code:
  - `api/proxy-manager.ts` - 修改代理池管理逻辑
  - `api/proxy-tester.ts` - 修改代理测试逻辑
  - `api/config.ts` - 新增数据库配置
  - 新增 `api/database/` 目录 - 数据库相关模块
- Breaking changes: 无（向后兼容，DATABASE_URL 未配置时使用内存模式）
- Dependencies: 新增 PostgreSQL 客户端库（如 `pg` 或 `@neondatabase/serverless`）