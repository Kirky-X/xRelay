<template>
  <div class="home">
    <!-- 背景动画 -->
    <div class="bg-animation"></div>

    <!-- 头部 -->
    <header>
      <div class="container">
        <nav class="nav">
          <a href="https://github.com/Kirky-X/xRelay" target="_blank" class="repo-link-small">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
          </a>
        </nav>
      </div>
    </header>

    <!-- Hero 区域 -->
    <main class="hero">
      <div class="container">
        <!-- Logo -->
        <div class="logo-container">
          <img src="/docs/asset/xRelay.png" alt="xRelay Logo" />
          <div class="logo-text">xRelay</div>
        </div>

        <!-- 打字机效果 -->
        <div class="typing-container">
          <span class="typing-text">{{ typingText }}</span>
          <span class="cursor"></span>
        </div>

        <!-- 代码示例 -->
        <div class="code-section">
          <div class="code-cards">
            <div class="code-card">
              <div class="code-header">
                <div class="code-dot red"></div>
                <div class="code-dot yellow"></div>
                <div class="code-dot green"></div>
                <span class="code-title">basic-request.sh</span>
              </div>
              <pre class="code-content" @click="copyCode(0)" title="点击复制代码"><code>{{ codeExample1 }}</code></pre>
            </div>
            <div class="code-card">
              <div class="code-header">
                <div class="code-dot red"></div>
                <div class="code-dot yellow"></div>
                <div class="code-dot green"></div>
                <span class="code-title">advanced-request.sh</span>
              </div>
              <pre class="code-content" @click="copyCode(1)" title="点击复制代码"><code>{{ codeExample2 }}</code></pre>
            </div>
          </div>
        </div>

        <!-- 特性卡片 -->
        <div class="features">
          <div class="feature-card">
            <div class="feature-icon">🛡️</div>
            <h3 class="feature-title">安全可靠</h3>
            <p class="feature-description">API Key 身份验证，请求限流，内网地址拦截，全方位保护您的服务安全。</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">⚡</div>
            <h3 class="feature-title">高性能</h3>
            <p class="feature-description">基于 Vercel Edge Function，全球边缘节点部署，毫秒级响应速度。</p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">💾</div>
            <h3 class="feature-title">智能缓存</h3>
            <p class="feature-description">基于 Vercel KV 的分布式缓存，减少重复请求，提升响应效率。</p>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const typingText = ref('');
const fullText = '安全、快速、免费的代理转发服务';
const codeExample1 = `# 基本请求示例
curl -X POST https://x-relay.vercel.app/api \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY" \\
  -d '{
    "url": "https://api.example.com/data",
    "method": "GET"
  }'`;

const codeExample2 = `# 带自定义头部的请求
curl -X POST https://x-relay.vercel.app/api \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY" \\
  -d '{
    "url": "https://api.example.com/data",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer token123"
    },
    "body": "{\\"key\\": \\"value\\"}"
  }'`;

// 打字机效果
const typeText = () => {
  let index = 0;
  const interval = setInterval(() => {
    if (index < fullText.length) {
      typingText.value += fullText.charAt(index);
      index++;
    } else {
      clearInterval(interval);
    }
  }, 100);
};

// 复制代码
const copyCode = (index: number) => {
  const code = index === 0 ? codeExample1 : codeExample2;
  navigator.clipboard.writeText(code).then(() => {
    alert('代码已复制到剪贴板！');
  });
};

onMounted(() => {
  setTimeout(typeText, 500);
});
</script>

<style scoped>
.home {
  position: relative;
  min-height: 100vh;
  width: 100%;
}

/* 背景动画 */
.bg-animation {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: -1;
  overflow: hidden;
}

.bg-animation::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: transparent;
  animation: bgRotate 20s linear infinite;
}

@keyframes bgRotate {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* 主容器 */
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 2rem;
}

/* 头部 */
header {
  padding: 2rem 0;
}

.nav {
  display: flex;
  justify-content: flex-end;
  align-items: center;
}

.logo-text {
  font-weight: 700;
  font-size: 1.25rem;
}

/* Hero 区域 */
.hero {
  min-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 0;
  text-align: center;
}

/* Logo 动画 */
.logo-container {
  margin-bottom: 3rem;
  animation: float 3s ease-in-out infinite;
}

.logo-container img {
  width: 280px;
  height: auto;
  filter: drop-shadow(0 0 30px var(--glow-color));
}

.logo-text {
  margin-top: 1rem;
  font-size: 3.5rem;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 0.1em;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-20px);
  }
}

/* 打字机效果 */
.typing-container {
  margin-bottom: 4rem;
  min-height: 80px;
}

.typing-text {
  font-size: 2.5rem;
  font-weight: 700;
  color: #e0e0e0;
  display: inline;
}

.cursor {
  display: inline-block;
  width: 3px;
  height: 2.5rem;
  background: #e0e0e0;
  margin-left: 0.5rem;
  animation: blink 1s step-end infinite;
  vertical-align: middle;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* 代码块区域 */
.code-section {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto 4rem auto;
}

.code-cards {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.code-cards .code-card:first-child {
  width: 100%;
}

.code-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 2rem;
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3),
              0 0 0 1px rgba(255, 255, 255, 0.05);
  transition: all 0.3s ease;
}

.code-card:hover {
  border-color: rgba(255, 250, 240, 0.3);
  box-shadow: 0 12px 48px rgba(255, 250, 240, 0.2),
              0 0 0 1px rgba(255, 255, 255, 0.1);
  transform: translateY(-4px);
}

.code-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
}

.code-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.code-dot.red { background: #ff5f57; }
.code-dot.yellow { background: #febc2e; }
.code-dot.green { background: #28c840; }

.code-title {
  font-size: 0.875rem;
  color: var(--text-secondary);
  font-weight: 500;
  margin-left: 1rem;
}

.code-content {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  padding: 1.5rem;
  overflow-x: auto;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 0.875rem;
  line-height: 1.6;
  color: #e2e8f0;
  cursor: pointer;
  transition: background 0.3s ease;
  text-align: left;
}

.code-content:hover {
  background: rgba(0, 0, 0, 0.5);
}

/* 仓库链接 */
.repo-link {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 2rem;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  color: var(--text-primary);
  text-decoration: none;
  font-weight: 500;
  font-size: 1rem;
  backdrop-filter: blur(10px);
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

.repo-link::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: var(--primary-gradient);
  transition: left 0.3s ease;
  z-index: -1;
}

.repo-link:hover {
  border-color: transparent;
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(255, 250, 240, 0.3);
}

.repo-link:hover::before {
  left: 0;
}

.repo-link svg {
  width: 24px;
  height: 24px;
  transition: transform 0.3s ease;
}

.repo-link:hover svg {
  transform: scale(1.1);
}

/* Header 中的 GitHub 链接 */
.repo-link-small {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  text-decoration: none;
  backdrop-filter: blur(10px);
  transition: all 0.3s ease;
}

.repo-link-small:hover {
  border-color: rgba(255, 250, 240, 0.5);
  background: rgba(255, 250, 240, 0.1);
  transform: translateY(-2px);
}

.repo-link-small svg {
  width: 20px;
  height: 20px;
  transition: transform 0.3s ease;
}

.repo-link-small:hover svg {
  transform: scale(1.1);
}

/* 特性卡片 */
.features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
  margin-top: 4rem;
  width: 100%;
  max-width: 1000px;
}

.feature-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 2rem;
  backdrop-filter: blur(10px);
  transition: all 0.3s ease;
  text-align: center;
}

.feature-card:hover {
  border-color: rgba(255, 250, 240, 0.3);
  transform: translateY(-4px);
}

.feature-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 1rem auto;
  font-size: 2rem;
}

.feature-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.feature-description {
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.6;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .typing-text {
    font-size: 1.75rem;
  }

  .cursor {
    height: 1.75rem;
  }

  .code-cards {
    grid-template-columns: 1fr;
  }

  .logo-container img {
    width: 200px;
  }

  .code-card {
    padding: 1.5rem;
  }

  .code-content {
    padding: 1rem;
    font-size: 0.75rem;
  }
}
</style>