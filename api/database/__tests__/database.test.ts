/**
 * Copyright (c) 2026 Kirky-x
 * License: MIT
 */

/**
 * Database Tests - 数据库模块测试
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  initDatabase,
  closeDatabase,
  isDatabaseReady,
  getDatabaseStatus,
} from "../connection.js";
import {
  upsertProxy,
  getAllProxies,
  getProxyCount,
  incrementFailureCount,
  incrementSuccessCount,
  deleteProxy,
  batchInsertProxies,
  getWeightedProxies,
} from "../available-proxies-dao.js";
import {
  insertDeprecatedProxy,
  isProxyDeprecated,
  getAllDeprecatedProxies,
  getDeprecatedProxyCount,
  deleteExpiredDeprecatedProxies,
  getDeprecatedProxyStats,
} from "../deprecated-proxies-dao.js";

describe("Database Module", () => {
  beforeAll(async () => {
    // 只有配置了 DATABASE_URL 才运行测试
    if (!process.env.DATABASE_URL) {
      console.log("Skipping database tests: DATABASE_URL not configured");
      return;
    }
    await initDatabase();
  });

  afterAll(async () => {
    if (isDatabaseReady()) {
      await closeDatabase();
    }
  });

  describe("Connection", () => {
    it("should initialize database connection", async () => {
      if (!process.env.DATABASE_URL) {
        expect(true).toBe(true); // Skip test
        return;
      }

      const status = getDatabaseStatus();
      expect(status.enabled).toBe(true);
      expect(status.connected).toBe(true);
    });

    it("should return database status", async () => {
      if (!process.env.DATABASE_URL) {
        expect(true).toBe(true); // Skip test
        return;
      }

      const status = getDatabaseStatus();
      expect(status).toHaveProperty("enabled");
      expect(status).toHaveProperty("connected");
    });
  });

  describe("Available Proxies DAO", () => {
    const testProxy = {
      ip: "192.168.1.1",
      port: 8080,
      source: "test",
      failure_count: 0,
      success_count: 0,
    };

    it("should insert a proxy", async () => {
      if (!isDatabaseReady()) {
        expect(true).toBe(true); // Skip test
        return;
      }

      const result = await upsertProxy(testProxy);
      expect(result).toHaveProperty("id");
      expect(result.ip).toBe(testProxy.ip);
      expect(result.port).toBe(testProxy.port);
    });

    it("should get all proxies", async () => {
      if (!isDatabaseReady()) {
        expect(true).toBe(true); // Skip test
        return;
      }

      const proxies = await getAllProxies();
      expect(Array.isArray(proxies)).toBe(true);
    });

    it("should get proxy count", async () => {
      if (!isDatabaseReady()) {
        expect(true).toBe(true); // Skip test
        return;
      }

      const count = await getProxyCount();
      expect(typeof count).toBe("number");
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it("should increment failure count", async () => {
      if (!isDatabaseReady()) {
        expect(true).toBe(true); // Skip test
        return;
      }

      const result = await incrementFailureCount(testProxy.ip, testProxy.port);
      expect(result).not.toBeNull();
      expect(result!.failure_count).toBeGreaterThan(0);
    });

    it("should increment success count", async () => {
      if (!isDatabaseReady()) {
        expect(true).toBe(true); // Skip test
        return;
      }

      const result = await incrementSuccessCount(testProxy.ip, testProxy.port);
      expect(result).not.toBeNull();
      expect(result!.success_count).toBeGreaterThan(0);
    });

    it("should get weighted proxies", async () => {
      if (!isDatabaseReady()) {
        expect(true).toBe(true); // Skip test
        return;
      }

      const proxies = await getWeightedProxies(5);
      expect(Array.isArray(proxies)).toBe(true);
      expect(proxies.length).toBeLessThanOrEqual(5);
    });

    it("should delete a proxy", async () => {
      if (!isDatabaseReady()) {
        expect(true).toBe(true); // Skip test
        return;
      }

      const deleted = await deleteProxy(testProxy.ip, testProxy.port);
      expect(deleted).toBe(true);
    });
  });

  describe("Deprecated Proxies DAO", () => {
    const testDeprecatedProxy = {
      ip: "192.168.1.2",
      port: 8080,
      source: "test",
      protocol: "http",
      failure_count: 11,
      created_at: new Date(),
    };

    it("should insert a deprecated proxy", async () => {
      if (!isDatabaseReady()) {
        expect(true).toBe(true); // Skip test
        return;
      }

      const result = await insertDeprecatedProxy(testDeprecatedProxy);
      expect(result).toHaveProperty("id");
      expect(result.ip).toBe(testDeprecatedProxy.ip);
    });

    it("should check if proxy is deprecated", async () => {
      if (!isDatabaseReady()) {
        expect(true).toBe(true); // Skip test
        return;
      }

      const isDeprecated = await isProxyDeprecated(
        testDeprecatedProxy.ip,
        testDeprecatedProxy.port,
      );
      expect(isDeprecated).toBe(true);
    });

    it("should get all deprecated proxies", async () => {
      if (!isDatabaseReady()) {
        expect(true).toBe(true); // Skip test
        return;
      }

      const proxies = await getAllDeprecatedProxies();
      expect(Array.isArray(proxies)).toBe(true);
    });

    it("should get deprecated proxy count", async () => {
      if (!isDatabaseReady()) {
        expect(true).toBe(true); // Skip test
        return;
      }

      const count = await getDeprecatedProxyCount();
      expect(typeof count).toBe("number");
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it("should get deprecated proxy stats", async () => {
      if (!isDatabaseReady()) {
        expect(true).toBe(true); // Skip test
        return;
      }

      const stats = await getDeprecatedProxyStats();
      expect(stats).toHaveProperty("total");
      expect(stats).toHaveProperty("expired");
      expect(stats).toHaveProperty("recent");
    });
  });
});