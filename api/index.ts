/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Vercel Edge Function - 入口文件
 * 重新导出 src/index.ts 以满足 Vercel 的目录结构要求
 */

export { config, default } from "../src/index.js";
