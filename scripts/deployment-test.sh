#!/bin/bash

# xRelay 部署后测试脚本
# 使用方法: ./scripts/deployment-test.sh [API_KEY]

set -e

BASE_URL="https://x-relay.vercel.app"
API_KEY="${1:-}"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 测试结果统计
PASS=0
FAIL=0

# 测试函数
test_case() {
    local name="$1"
    local expected_status="$2"
    local actual_status="$3"
    local response="$4"
    
    if [ "$actual_status" == "$expected_status" ]; then
        echo -e "${GREEN}[PASS]${NC} $name"
        echo "  Status: $actual_status"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}[FAIL]${NC} $name"
        echo "  Expected: $expected_status, Got: $actual_status"
        echo "  Response: $response"
        FAIL=$((FAIL + 1))
    fi
}

echo "=========================================="
echo "xRelay 部署后测试"
echo "=========================================="
echo "Base URL: $BASE_URL"
echo "API Key: ${API_KEY:-未设置}"
echo ""

# 1. 健康检查端点测试
echo "=========================================="
echo "1. 健康检查端点测试"
echo "=========================================="

echo "测试 /api/health..."
response=$(curl -s -w "\n%{http_code}" --max-time 30 "${BASE_URL}/api/health" 2>/dev/null)
status=$(echo "$response" | tail -1)
body=$(echo "$response" | sed '$d')
test_case "健康检查端点" "200" "$status" "$body"

echo "测试 /api/ready..."
response=$(curl -s -w "\n%{http_code}" --max-time 30 "${BASE_URL}/api/ready" 2>/dev/null)
status=$(echo "$response" | tail -1)
body=$(echo "$response" | sed '$d')
test_case "就绪检查端点" "200" "$status" "$body"

# 2. 安全响应头验证
echo ""
echo "=========================================="
echo "2. 安全响应头验证"
echo "=========================================="

headers=$(curl -s -I --max-time 30 "${BASE_URL}/api/health" 2>/dev/null)

echo "检查安全响应头..."
if echo "$headers" | grep -qi "X-Content-Type-Options"; then
    echo -e "${GREEN}[PASS]${NC} X-Content-Type-Options 存在"
    PASS=$((PASS + 1))
else
    echo -e "${RED}[FAIL]${NC} X-Content-Type-Options 缺失"
    FAIL=$((FAIL + 1))
fi

if echo "$headers" | grep -qi "X-Frame-Options"; then
    echo -e "${GREEN}[PASS]${NC} X-Frame-Options 存在"
    PASS=$((PASS + 1))
else
    echo -e "${RED}[FAIL]${NC} X-Frame-Options 缺失"
    FAIL=$((FAIL + 1))
fi

if echo "$headers" | grep -qi "Strict-Transport-Security"; then
    echo -e "${GREEN}[PASS]${NC} Strict-Transport-Security 存在"
    PASS=$((PASS + 1))
else
    echo -e "${RED}[FAIL]${NC} Strict-Transport-Security 缺失"
    FAIL=$((FAIL + 1))
fi

if echo "$headers" | grep -qi "X-Request-Id"; then
    echo -e "${GREEN}[PASS]${NC} X-Request-Id 存在 (请求追踪)"
    PASS=$((PASS + 1))
else
    echo -e "${YELLOW}[WARN]${NC} X-Request-Id 缺失"
fi

# 3. API Key 验证测试
echo ""
echo "=========================================="
echo "3. API Key 验证测试"
echo "=========================================="

echo "测试无 API Key 请求..."
response=$(curl -s -w "\n%{http_code}" --max-time 30 -X POST "${BASE_URL}/api" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://httpbin.org/get"}' 2>/dev/null)
status=$(echo "$response" | tail -1)
test_case "无 API Key 拒绝" "401" "$status" "$(echo "$response" | sed '$d')"

echo "测试无效 API Key..."
response=$(curl -s -w "\n%{http_code}" --max-time 30 -X POST "${BASE_URL}/api" \
  -H "Content-Type: application/json" \
  -H "x-api-key: invalid-key-12345" \
  -d '{"url": "https://httpbin.org/get"}' 2>/dev/null)
status=$(echo "$response" | tail -1)
test_case "无效 API Key 拒绝" "401" "$status" "$(echo "$response" | sed '$d')"

# 4. SSRF 防护测试
echo ""
echo "=========================================="
echo "4. SSRF 防护测试"
echo "=========================================="

if [ -n "$API_KEY" ]; then
    echo "测试内网地址拦截 (127.0.0.1)..."
    response=$(curl -s -w "\n%{http_code}" --max-time 30 -X POST "${BASE_URL}/api" \
      -H "Content-Type: application/json" \
      -H "x-api-key: ${API_KEY}" \
      -d '{"url": "http://127.0.0.1/admin"}' 2>/dev/null)
    status=$(echo "$response" | tail -1)
    test_case "127.0.0.1 拦截" "400" "$status" "$(echo "$response" | sed '$d')"

    echo "测试内网地址拦截 (192.168.x.x)..."
    response=$(curl -s -w "\n%{http_code}" --max-time 30 -X POST "${BASE_URL}/api" \
      -H "Content-Type: application/json" \
      -H "x-api-key: ${API_KEY}" \
      -d '{"url": "http://192.168.1.1/admin"}' 2>/dev/null)
    status=$(echo "$response" | tail -1)
    test_case "192.168.x.x 拦截" "400" "$status" "$(echo "$response" | sed '$d')"

    echo "测试 IPv6 loopback..."
    response=$(curl -s -w "\n%{http_code}" --max-time 30 -X POST "${BASE_URL}/api" \
      -H "Content-Type: application/json" \
      -H "x-api-key: ${API_KEY}" \
      -d '{"url": "http://[::1]/admin"}' 2>/dev/null)
    status=$(echo "$response" | tail -1)
    test_case "IPv6 loopback 拦截" "400" "$status" "$(echo "$response" | sed '$d')"
else
    echo -e "${YELLOW}[SKIP]${NC} SSRF 测试需要 API Key"
fi

# 5. 正常代理请求测试
echo ""
echo "=========================================="
echo "5. 正常代理请求测试"
echo "=========================================="

if [ -n "$API_KEY" ]; then
    echo "测试正常 GET 请求..."
    response=$(curl -s -w "\n%{http_code}" --max-time 60 -X POST "${BASE_URL}/api" \
      -H "Content-Type: application/json" \
      -H "x-api-key: ${API_KEY}" \
      -d '{"url": "https://httpbin.org/get", "method": "GET"}' 2>/dev/null)
    status=$(echo "$response" | tail -1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$status" == "200" ]; then
        if echo "$body" | grep -q "success.*true"; then
            echo -e "${GREEN}[PASS]${NC} 正常 GET 请求"
            echo "  Status: $status"
            PASS=$((PASS + 1))
        else
            echo -e "${RED}[FAIL]${NC} 正常 GET 请求 - 响应格式错误"
            echo "  Response: $body"
            FAIL=$((FAIL + 1))
        fi
    else
        echo -e "${RED}[FAIL]${NC} 正常 GET 请求"
        echo "  Status: $status"
        echo "  Response: $body"
        FAIL=$((FAIL + 1))
    fi
else
    echo -e "${YELLOW}[SKIP]${NC} 正常请求测试需要 API Key"
fi

# 6. 错误处理测试
echo ""
echo "=========================================="
echo "6. 错误处理测试"
echo "=========================================="

if [ -n "$API_KEY" ]; then
    echo "测试无效 URL..."
    response=$(curl -s -w "\n%{http_code}" --max-time 30 -X POST "${BASE_URL}/api" \
      -H "Content-Type: application/json" \
      -H "x-api-key: ${API_KEY}" \
      -d '{"url": "not-a-valid-url"}' 2>/dev/null)
    status=$(echo "$response" | tail -1)
    test_case "无效 URL 拒绝" "400" "$status" "$(echo "$response" | sed '$d')"

    echo "测试缺少 URL..."
    response=$(curl -s -w "\n%{http_code}" --max-time 30 -X POST "${BASE_URL}/api" \
      -H "Content-Type: application/json" \
      -H "x-api-key: ${API_KEY}" \
      -d '{}' 2>/dev/null)
    status=$(echo "$response" | tail -1)
    test_case "缺少 URL 拒绝" "400" "$status" "$(echo "$response" | sed '$d')"
else
    echo -e "${YELLOW}[SKIP]${NC} 错误处理测试需要 API Key"
fi

# 7. CORS 配置测试
echo ""
echo "=========================================="
echo "7. CORS 配置测试"
echo "=========================================="

echo "测试 OPTIONS 预检请求..."
response=$(curl -s -w "\n%{http_code}" --max-time 30 -X OPTIONS "${BASE_URL}/api" \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: POST" 2>/dev/null)
status=$(echo "$response" | tail -1)
test_case "OPTIONS 预检请求" "204" "$status" "$(echo "$response" | sed '$d')"

# 测试总结
echo ""
echo "=========================================="
echo "测试总结"
echo "=========================================="
echo -e "通过: ${GREEN}$PASS${NC}"
echo -e "失败: ${RED}$FAIL${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}所有测试通过！${NC}"
    exit 0
else
    echo -e "${RED}有 $FAIL 个测试失败${NC}"
    exit 1
fi
