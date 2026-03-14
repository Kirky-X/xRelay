#!/bin/bash

# xRelay Binary Build Script
# 使用 Bun 将项目编译成独立可执行文件

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   xRelay Binary Build Script${NC}"
echo -e "${BLUE}========================================${NC}"

# 检查 Bun 是否安装
if ! command -v bun &> /dev/null; then
    echo -e "${RED}错误: Bun 未安装${NC}"
    echo -e "${YELLOW}请访问 https://bun.sh 安装 Bun${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Bun 版本: $(bun --version)${NC}"

# 设置变量
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENTRY_FILE="$PROJECT_ROOT/src/standalone.ts"
OUTPUT_DIR="$PROJECT_ROOT/dist-binary"
BINARY_NAME="xrelay"

# 解析命令行参数
TARGET_OS=""
TARGET_ARCH=""
CLEAN_BUILD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --os)
            TARGET_OS="$2"
            shift 2
            ;;
        --arch)
            TARGET_ARCH="$2"
            shift 2
            ;;
        --clean)
            CLEAN_BUILD=true
            shift
            ;;
        --help)
            echo "用法: $0 [选项]"
            echo ""
            echo "选项:"
            echo "  --os <os>       目标操作系统 (linux, macos, windows)"
            echo "  --arch <arch>   目标架构 (x64, arm64)"
            echo "  --clean         清理后重新构建"
            echo "  --help          显示帮助信息"
            echo ""
            echo "示例:"
            echo "  $0                          # 构建当前平台的二进制"
            echo "  $0 --os linux --arch x64    # 构建 Linux x64 二进制"
            echo "  $0 --os macos --arch arm64  # 构建 macOS ARM64 二进制"
            echo "  $0 --os windows --arch x64  # 构建 Windows x64 二进制"
            exit 0
            ;;
        *)
            echo -e "${RED}未知参数: $1${NC}"
            exit 1
            ;;
    esac
done

# 切换到项目根目录
cd "$PROJECT_ROOT"

# 清理旧的构建
if [ "$CLEAN_BUILD" = true ]; then
    echo -e "${YELLOW}清理旧的构建文件...${NC}"
    rm -rf "$OUTPUT_DIR"
fi

# 创建输出目录
mkdir -p "$OUTPUT_DIR"

# 检查入口文件是否存在
if [ ! -f "$ENTRY_FILE" ]; then
    echo -e "${RED}错误: 入口文件不存在: $ENTRY_FILE${NC}"
    exit 1
fi

echo -e "${GREEN}✓ 入口文件: $ENTRY_FILE${NC}"

# 构建 Bun 编译命令（添加压缩优化）
BUILD_CMD="bun build $ENTRY_FILE --compile --minify --no-compile-autoload-dotenv --no-compile-autoload-bunfig"

# 添加目标平台参数
if [ -n "$TARGET_OS" ] || [ -n "$TARGET_ARCH" ]; then
    if [ -z "$TARGET_OS" ] || [ -z "$TARGET_ARCH" ]; then
        echo -e "${RED}错误: 必须同时指定 --os 和 --arch${NC}"
        exit 1
    fi
    
    # 转换目标格式
    case "$TARGET_OS" in
        linux)
            TARGET="linux-$TARGET_ARCH"
            ;;
        macos)
            TARGET="darwin-$TARGET_ARCH"
            ;;
        windows)
            TARGET="windows-$TARGET_ARCH"
            BINARY_NAME="xrelay.exe"
            ;;
        *)
            echo -e "${RED}错误: 不支持的操作系统: $TARGET_OS${NC}"
            echo -e "${YELLOW}支持的操作系统: linux, macos, windows${NC}"
            exit 1
            ;;
    esac
    
    BUILD_CMD="$BUILD_CMD --target=$TARGET"
    OUTPUT_FILE="$OUTPUT_DIR/xrelay-$TARGET_OS-$TARGET_ARCH"
    
    if [ "$TARGET_OS" = "windows" ]; then
        OUTPUT_FILE="$OUTPUT_FILE.exe"
    fi
else
    # 本地构建
    OUTPUT_FILE="$OUTPUT_DIR/$BINARY_NAME"
fi

echo -e "${BLUE}构建命令: $BUILD_CMD --outfile=$OUTPUT_FILE${NC}"

# 执行构建
echo -e "${YELLOW}开始构建二进制文件...${NC}"
$BUILD_CMD --outfile="$OUTPUT_FILE"

# 注意：UPX 压缩不兼容 Bun 编译的二进制文件
# Bun 二进制包含特殊内部结构，UPX 压缩会导致运行失败

# 检查构建结果
if [ -f "$OUTPUT_FILE" ]; then
    FILE_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}✓ 构建成功!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo -e "${BLUE}输出文件: $OUTPUT_FILE${NC}"
    echo -e "${BLUE}文件大小: $FILE_SIZE${NC}"
    
    # 设置可执行权限
    chmod +x "$OUTPUT_FILE"
    
    echo ""
    echo -e "${YELLOW}运行方式:${NC}"
    echo -e "  $OUTPUT_FILE"
    echo ""
    echo -e "${YELLOW}环境变量配置:${NC}"
    echo -e "  PORT=3000                    # 服务端口 (默认: 3000)"
    echo -e "  HOST=0.0.0.0                 # 监听地址 (默认: 0.0.0.0)"
    echo -e "  API_KEYS=your-api-key        # API 密钥 (多个用逗号分隔)"
    echo -e "  ENABLE_API_KEY=true          # 启用 API 密钥验证"
    echo -e "  ENABLE_CACHE=true            # 启用缓存"
    echo -e "  ENABLE_RATE_LIMIT=true       # 启用限流"
    echo -e "  ENABLE_FALLBACK=true         # 启用直连回退"
    echo ""
    echo -e "${YELLOW}测试命令:${NC}"
    echo -e "  curl -X POST http://localhost:3000/api \\"
    echo -e "    -H \"Content-Type: application/json\" \\"
    echo -e "    -d '{\"url\": \"https://httpbin.org/ip\", \"method\": \"GET\"}'"
else
    echo -e "${RED}构建失败!${NC}"
    exit 1
fi
