#!/bin/bash

# xRelay Docker 部署测试脚本

set -e

# 切换到脚本所在目录（docker/），使 compose 文件路径相对此目录解析
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "🚀 xRelay Docker 部署测试"
echo "========================"

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker 未安装，请先安装 Docker${NC}"
    exit 1
fi

# 检查 Docker Compose 是否安装
# 优先使用新版 `docker compose`（plugin），回退到旧版 `docker-compose`（standalone）
if docker compose version &> /dev/null; then
    COMPOSE_CMD=(docker compose)
elif command -v docker-compose &> /dev/null; then
    COMPOSE_CMD=(docker-compose)
else
    echo -e "${RED}❌ Docker Compose 未安装，请先安装 Docker Compose${NC}"
    exit 1
fi

# 项目根目录（compose 中 build.context: .. 指向这里，.env 也在这里）
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 显示菜单
show_menu() {
    echo ""
    echo "请选择操作："
    echo "1) 启动生产环境"
    echo "2) 启动开发环境"
    echo "3) 停止所有服务"
    echo "4) 查看日志"
    echo "5) 重启服务"
    echo "6) 清理所有容器和数据"
    echo "7) 进入 PostgreSQL 容器"
    echo "8) 测试 API"
    echo "9) 退出"
    echo ""
    read -p "请输入选项 (1-9): " choice
}

# 启动生产环境
start_production() {
    echo -e "${GREEN}🏗️  启动生产环境...${NC}"
    "${COMPOSE_CMD[@]}" -f docker-compose.yml --env-file "$PROJECT_ROOT/.env" up -d
    echo -e "${GREEN}✅ 生产环境已启动${NC}"
    echo ""
    echo "服务地址（主机端口 → 容器端口）："
    echo "  - 应用: http://localhost:13000 → :3000"
    echo "  - PostgreSQL: localhost:15432 → :5432"
    echo "  - Redis: localhost:16379 → :6379"
}

# 启动开发环境
start_development() {
    echo -e "${YELLOW}🔧 启动开发环境...${NC}"
    "${COMPOSE_CMD[@]}" -f docker-compose.dev.yml --env-file "$PROJECT_ROOT/.env" up -d
    echo -e "${YELLOW}✅ 开发环境已启动${NC}"
    echo ""
    echo "服务地址（主机端口 → 容器端口）："
    echo "  - 应用: http://localhost:13000 → :3000"
    echo "  - PostgreSQL: localhost:15432 → :5432"
    echo "  - Redis: localhost:16379 → :6379"
}

# 停止所有服务
stop_services() {
    echo -e "${RED}⏹️  停止所有服务...${NC}"
    "${COMPOSE_CMD[@]}" -f docker-compose.yml down
    "${COMPOSE_CMD[@]}" -f docker-compose.dev.yml down
    echo -e "${GREEN}✅ 所有服务已停止${NC}"
}

# 查看日志
view_logs() {
    echo "选择要查看的服务日志："
    echo "1) 应用"
    echo "2) PostgreSQL"
    echo "3) Redis"
    echo "4) 所有服务"
    read -p "请输入选项 (1-4): " log_choice

    case $log_choice in
        1)
            "${COMPOSE_CMD[@]}" -f docker-compose.yml logs -f app
            ;;
        2)
            "${COMPOSE_CMD[@]}" -f docker-compose.yml logs -f postgres
            ;;
        3)
            "${COMPOSE_CMD[@]}" -f docker-compose.yml logs -f redis
            ;;
        4)
            "${COMPOSE_CMD[@]}" -f docker-compose.yml logs -f
            ;;
        *)
            echo "无效选项"
            ;;
    esac
}

# 重启服务
restart_services() {
    echo "选择要重启的环境："
    echo "1) 生产环境"
    echo "2) 开发环境"
    read -p "请输入选项 (1-2): " restart_choice

    case $restart_choice in
        1)
            echo -e "${YELLOW}🔄 重启生产环境...${NC}"
            "${COMPOSE_CMD[@]}" -f docker-compose.yml restart
            echo -e "${GREEN}✅ 生产环境已重启${NC}"
            ;;
        2)
            echo -e "${YELLOW}🔄 重启开发环境...${NC}"
            "${COMPOSE_CMD[@]}" -f docker-compose.dev.yml restart
            echo -e "${GREEN}✅ 开发环境已重启${NC}"
            ;;
        *)
            echo "无效选项"
            ;;
    esac
}

# 清理所有容器和数据
cleanup() {
    echo -e "${RED}⚠️  警告：这将删除所有容器和数据！${NC}"
    read -p "确定要继续吗？: " confirm

    if [[ $confirm == "y" || $confirm == "Y" ]]; then
        echo -e "${RED}🗑️  清理所有容器和数据...${NC}"
        "${COMPOSE_CMD[@]}" -f docker-compose.yml down -v
        "${COMPOSE_CMD[@]}" -f docker-compose.dev.yml down -v
        docker system prune -f
        echo -e "${GREEN}✅ 清理完成${NC}"
    else
        echo "已取消"
    fi
}

# 进入 PostgreSQL 容器
enter_postgres() {
    echo "进入 PostgreSQL 容器..."
    docker exec -it xrelay-postgres psql -U xrelay -d xrelay
}

# 测试 API
test_api() {
    echo -e "${GREEN}🧪 测试 API...${NC}"
    echo ""

    # 检查应用是否运行
    if ! docker ps | grep -q xrelay-app; then
        echo -e "${RED}❌ 应用未运行，请先启动服务${NC}"
        return
    fi

    # 主机端口 13000 映射到容器内 3000
    local api_url="http://localhost:13000/api"

    echo "测试 1: 检查应用状态"
    echo "GET $api_url"
    echo ""

    # 等待应用启动
    sleep 2

    # 测试代理请求
    echo ""
    echo "测试 2: 发送代理请求"
    echo "POST $api_url"
    echo ""
    curl -X POST "$api_url" \
        -H "Content-Type: application/json" \
        -d '{
            "url": "https://httpbin.org/ip",
            "method": "GET"
        }' \
        -w "\n\n状态码: %{http_code}\n" \
        -s | head -20

    echo ""
    echo -e "${GREEN}✅ API 测试完成${NC}"
}

# 主循环
while true; do
    show_menu
    
    case $choice in
        1)
            start_production
            ;;
        2)
            start_development
            ;;
        3)
            stop_services
            ;;
        4)
            view_logs
            ;;
        5)
            restart_services
            ;;
        6)
            cleanup
            ;;
        7)
            enter_postgres
            ;;
        8)
            test_api
            ;;
        9)
            echo -e "${GREEN}👋 再见！${NC}"
            exit 0
            ;;
        *)
            echo -e "${RED}❌ 无效选项，请重新选择${NC}"
            ;;
    esac
done