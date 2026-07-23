/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Stealth 脚本模块 - 反自动化检测
 *
 * 通过 page.evaluateOnNewDocument 注入浏览器上下文，隐藏 puppeteer 痕迹：
 * - navigator.webdriver = undefined（最关键的反检测项）
 * - navigator.plugins / mimeTypes 模拟真实 Chrome（3 个常见插件）
 * - navigator.languages 设置为常见值
 * - WebGL vendor/renderer 掩码（隐藏 HeadlessChrome 字符串）
 * - window.chrome 运行时模拟
 * - Notification.permission / Permissions API 模拟
 *
 * 设计原则：
 * - 纯字符串脚本，无外部依赖，跨 Vercel/本地/容器环境兼容
 * - 脚本在浏览器上下文执行，不影响 Node.js 运行时
 * - 与 @sparticuz/chromium 兼容（仅依赖 CDP 协议）
 *
 * 为什么不用 puppeteer-extra-plugin-stealth：
 * - 该插件 patch puppeteer 内部，与 @sparticuz/chromium 在 serverless 下有兼容性风险
 * - 手动实现可定制、可测试、零依赖、覆盖核心检测项
 */

/**
 * 单条 stealth 脚本
 */
export interface StealthScript {
  /** 脚本名称（用于日志和调试） */
  name: string;
  /** 在浏览器上下文执行的 JS 代码（IIFE 字符串） */
  code: string;
}

/**
 * 隐藏 navigator.webdriver 标志（最关键的反检测项）
 * Chrome Headless 默认设置 navigator.webdriver = true，目标站可据此识别
 */
const hideWebdriver: StealthScript = {
  name: 'hide-webdriver',
  code: `
Object.defineProperty(navigator, 'webdriver', {
  get: () => undefined,
  configurable: true,
});
`.trim(),
};

/**
 * 模拟真实 Chrome 的 navigator.plugins（3 个常见插件）
 * HeadlessChrome 默认 plugins 为空数组，是常见检测点
 */
const mockPlugins: StealthScript = {
  name: 'mock-plugins',
  code: `
Object.defineProperty(navigator, 'plugins', {
  get: () => {
    const makePlugin = (name, filename, description) => ({
      name,
      filename,
      description,
      length: 1,
      item: (i) => i === 0 ? { type: 'application/pdf', suffixes: 'pdf', description: '' } : null,
      namedItem: (n) => n === name ? { type: 'application/pdf', suffixes: 'pdf', description: '' } : null,
    });
    const plugins = [
      makePlugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      makePlugin('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      makePlugin('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
    ];
    plugins.item = (i) => plugins[i] || null;
    plugins.namedItem = (n) => plugins.find(p => p.name === n) || null;
    return plugins;
  },
  configurable: true,
});
`.trim(),
};

/**
 * 设置 navigator.languages 为常见值
 * HeadlessChrome 默认为空数组
 */
const mockLanguages: StealthScript = {
  name: 'mock-languages',
  code: `
Object.defineProperty(navigator, 'languages', {
  get: () => ['en-US', 'en'],
  configurable: true,
});
`.trim(),
};

/**
 * WebGL vendor/renderer 掩码
 * HeadlessChrome 的 WebGL renderer 通常含 "SwiftShader" 或 "HeadlessChrome" 字样
 */
const maskWebgl: StealthScript = {
  name: 'mask-webgl',
  code: `
const getParameter = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(parameter) {
  if (parameter === 37445) return 'Intel Inc.';
  if (parameter === 37446) return 'Intel Iris OpenGL Engine';
  return getParameter.call(this, parameter);
};
if (typeof WebGL2RenderingContext !== 'undefined') {
  const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
  WebGL2RenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) return 'Intel Inc.';
    if (parameter === 37446) return 'Intel Iris OpenGL Engine';
    return getParameter2.call(this, parameter);
  };
}
`.trim(),
};

/**
 * 模拟 window.chrome 运行时（普通 Chrome 都有此对象）
 * HeadlessChrome 默认缺失或为空
 * 注意：不模拟枚举字段（OnInstalledReason 等），因为空枚举对象会被严格检测识别
 */
const mockChromeRuntime: StealthScript = {
  name: 'mock-chrome-runtime',
  code: `
if (!window.chrome) {
  window.chrome = {};
}
if (!window.chrome.runtime) {
  window.chrome.runtime = {
    connect: () => {},
    sendMessage: () => {},
  };
}
`.trim(),
};

/**
 * 模拟 Notification.permission（默认为 'default'，与普通 Chrome 一致）
 */
const mockNotificationPermission: StealthScript = {
  name: 'mock-notification-permission',
  code: `
if (typeof Notification !== 'undefined') {
  Object.defineProperty(Notification, 'permission', {
    get: () => 'default',
    configurable: true,
  });
}
`.trim(),
};

/**
 * 模拟 Permissions API 查询（防止 permissions.query 报错或返回异常）
 */
const mockPermissions: StealthScript = {
  name: 'mock-permissions',
  code: `
if (navigator.permissions && navigator.permissions.query) {
  const originalQuery = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (parameters) => {
    if (parameters.name === 'notifications') {
      return Promise.resolve({ state: 'default', onchange: null });
    }
    return originalQuery(parameters);
  };
}
`.trim(),
};

/**
 * 全部 stealth 脚本（按依赖顺序）
 * 深冻结：数组及其元素都不可变，防止运行时污染
 */
export const STEALTH_SCRIPTS: readonly StealthScript[] = Object.freeze(
  [hideWebdriver, mockPlugins, mockLanguages, maskWebgl, mockChromeRuntime, mockNotificationPermission, mockPermissions]
    .map((s) => Object.freeze({ ...s }))
);

/**
 * 缓存的脚本代码数组（避免每次调用重新分配）
 * 合并为单个 IIFE 字符串，减少 CDP 调用次数（7 次 → 1 次）
 */
const STEALTH_SCRIPT_COMBINED_CODE: string = STEALTH_SCRIPTS
  .map((s) => `(function(){${s.code}})();`)
  .join('\n');

/**
 * 获取合并后的 stealth 脚本代码（用于单次 page.evaluateOnNewDocument 注入）
 * 合并调用减少 CDP 往返次数，在 Vercel serverless 下可节省 30-120ms 首字节延迟
 */
export function getStealthScriptCode(): string {
  return STEALTH_SCRIPT_COMBINED_CODE;
}
