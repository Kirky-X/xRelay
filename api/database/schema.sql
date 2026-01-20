-- xRelay Proxy Database Schema
-- Version: 1.0.0

-- 创建 xrelay schema
CREATE SCHEMA IF NOT EXISTS xrelay;

-- 迁移记录表
CREATE TABLE IF NOT EXISTS xrelay.migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 可用代理表
CREATE TABLE IF NOT EXISTS xrelay.available_proxies (
  id SERIAL PRIMARY KEY,
  ip VARCHAR(45) NOT NULL,
  port INTEGER NOT NULL,
  source VARCHAR(100) NOT NULL,
  failure_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMP,
  last_checked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ip, port)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_available_proxies_failure_count ON xrelay.available_proxies(failure_count);
CREATE INDEX IF NOT EXISTS idx_available_proxies_last_used ON xrelay.available_proxies(last_used_at);
CREATE INDEX IF NOT EXISTS idx_available_proxies_ip_port ON xrelay.available_proxies(ip, port);

-- 废弃代理表
CREATE TABLE IF NOT EXISTS xrelay.deprecated_proxies (
  id SERIAL PRIMARY KEY,
  ip VARCHAR(45) NOT NULL,
  port INTEGER NOT NULL,
  source VARCHAR(100),
  protocol VARCHAR(10) DEFAULT 'http',
  failure_count INTEGER NOT NULL,
  deprecated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  UNIQUE(ip, port)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_deprecated_proxies_deprecated_at ON xrelay.deprecated_proxies(deprecated_at);
CREATE INDEX IF NOT EXISTS idx_deprecated_proxies_ip_port ON xrelay.deprecated_proxies(ip, port);

-- 添加注释
COMMENT ON SCHEMA xrelay IS 'xRelay 代理数据库 schema';
COMMENT ON TABLE xrelay.migrations IS '数据库迁移记录表';
COMMENT ON TABLE xrelay.available_proxies IS '存储可用代理及其状态';
COMMENT ON TABLE xrelay.deprecated_proxies IS '存储废弃代理（失败次数超过阈值）';