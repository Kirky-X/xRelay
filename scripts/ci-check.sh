#!/bin/bash

# =============================================================================
# xRelay - Local CI Check Script
# =============================================================================
# This script runs all CI checks locally before pushing to the repository.
# Usage: ./scripts/ci-check.sh [options]
#
# Options:
#   --skip-install    Skip npm install step
#   --skip-tests      Skip test execution
#   --skip-build      Skip build step
#   --fix             Attempt to fix issues automatically
#   --verbose         Enable verbose output
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERBOSE=false
SKIP_INSTALL=false
SKIP_TESTS=false
SKIP_BUILD=false
FIX_MODE=false

# Counters
PASSED=0
FAILED=0
WARNINGS=0

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-install)
            SKIP_INSTALL=true
            shift
            ;;
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --fix)
            FIX_MODE=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --skip-install    Skip npm install step"
            echo "  --skip-tests      Skip test execution"
            echo "  --skip-build      Skip build step"
            echo "  --fix             Attempt to fix issues automatically"
            echo "  --verbose         Enable verbose output"
            echo "  -h, --help        Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Utility functions
log_header() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

log_step() {
    echo -e "${BLUE}▶ $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
    ((PASSED++))
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
    ((FAILED++))
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
    ((WARNINGS++))
}

log_info() {
    if [[ "$VERBOSE" == true ]]; then
        echo -e "${BLUE}ℹ️  $1${NC}"
    fi
}

check_command() {
    if command -v "$1" &> /dev/null; then
        return 0
    else
        return 1
    fi
}

# Change to project root
cd "$PROJECT_ROOT"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                    xRelay - Local CI Check                           ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "📁 Project Root: ${BLUE}$PROJECT_ROOT${NC}"
echo -e "📅 Started at:   ${BLUE}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo ""

# =============================================================================
# Step 1: Environment Check
# =============================================================================
log_header "Step 1: Environment Check"

log_step "Checking Node.js..."
if check_command node; then
    NODE_VERSION=$(node --version)
    log_success "Node.js $NODE_VERSION is installed"
else
    log_error "Node.js is not installed"
    exit 1
fi

log_step "Checking npm..."
if check_command npm; then
    NPM_VERSION=$(npm --version)
    log_success "npm $NPM_VERSION is installed"
else
    log_error "npm is not installed"
    exit 1
fi

log_step "Checking package.json..."
if [[ -f "package.json" ]]; then
    log_success "package.json found"
else
    log_error "package.json not found"
    exit 1
fi

# =============================================================================
# Step 2: Install Dependencies
# =============================================================================
if [[ "$SKIP_INSTALL" == false ]]; then
    log_header "Step 2: Install Dependencies"
    
    log_step "Installing npm dependencies..."
    if npm ci --prefer-offline --no-audit 2>&1 | while read -r line; do
        if [[ "$VERBOSE" == true ]]; then
            echo "  $line"
        fi
    done; then
        log_success "Dependencies installed successfully"
    else
        log_error "Failed to install dependencies"
        exit 1
    fi
else
    log_header "Step 2: Install Dependencies (Skipped)"
    log_warning "Skipping dependency installation"
fi

# =============================================================================
# Step 3: TypeScript Type Check
# =============================================================================
log_header "Step 3: TypeScript Type Check"

log_step "Running TypeScript compiler..."
if npx tsc --noEmit --project config/tsconfig.json 2>&1; then
    log_success "TypeScript type check passed"
else
    log_error "TypeScript type check failed"
    if [[ "$FIX_MODE" == true ]]; then
        log_info "Attempting to fix TypeScript issues..."
    fi
fi

# =============================================================================
# Step 4: ESLint Check
# =============================================================================
log_header "Step 4: ESLint Check"

log_step "Running ESLint..."
ESLINT_OUTPUT=$(npx eslint . --ext .ts,.tsx,.vue --format stylish 2>&1 || true)

if [[ -z "$ESLINT_OUTPUT" || "$ESLINT_OUTPUT" == *"0 problems"* ]]; then
    log_success "ESLint check passed"
else
    if [[ "$ESLINT_OUTPUT" == *"0 errors"* ]]; then
        log_warning "ESLint found warnings (no errors)"
        if [[ "$VERBOSE" == true ]]; then
            echo "$ESLINT_OUTPUT"
        fi
    else
        log_error "ESLint check failed"
        echo "$ESLINT_OUTPUT"
        
        if [[ "$FIX_MODE" == true ]]; then
            log_info "Attempting to fix ESLint issues..."
            npx eslint . --ext .ts,.tsx,.vue --fix 2>&1 || true
        fi
    fi
fi

# =============================================================================
# Step 5: Unit Tests
# =============================================================================
if [[ "$SKIP_TESTS" == false ]]; then
    log_header "Step 5: Unit Tests"
    
    log_step "Running unit tests..."
    if npm run test 2>&1 | while read -r line; do
        if [[ "$VERBOSE" == true || "$line" == *"passed"* || "$line" == *"failed"* ]]; then
            echo "  $line"
        fi
    done; then
        log_success "All tests passed"
    else
        log_error "Some tests failed"
    fi
else
    log_header "Step 5: Unit Tests (Skipped)"
    log_warning "Skipping test execution"
fi

# =============================================================================
# Step 6: Build
# =============================================================================
if [[ "$SKIP_BUILD" == false ]]; then
    log_header "Step 6: Build"
    
    log_step "Building project..."
    if npm run build 2>&1 | while read -r line; do
        if [[ "$VERBOSE" == true ]]; then
            echo "  $line"
        fi
    done; then
        log_success "Build completed successfully"
    else
        log_error "Build failed"
    fi
else
    log_header "Step 6: Build (Skipped)"
    log_warning "Skipping build step"
fi

# =============================================================================
# Step 7: Security Audit
# =============================================================================
log_header "Step 7: Security Audit"

log_step "Running npm audit..."
AUDIT_OUTPUT=$(npm audit --audit-level=moderate --json 2>&1 || true)

CRITICAL=$(echo "$AUDIT_OUTPUT" | node -e "
    const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
    console.log(data.metadata?.vulnerabilities?.critical || 0);
" 2>/dev/null || echo "0")

HIGH=$(echo "$AUDIT_OUTPUT" | node -e "
    const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
    console.log(data.metadata?.vulnerabilities?.high || 0);
" 2>/dev/null || echo "0")

MODERATE=$(echo "$AUDIT_OUTPUT" | node -e "
    const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
    console.log(data.metadata?.vulnerabilities?.moderate || 0);
" 2>/dev/null || echo "0")

echo ""
echo "  Vulnerability Summary:"
echo "  ┌─────────────┬───────┐"
echo "  │ Severity    │ Count │"
echo "  ├─────────────┼───────┤"
echo "  │ Critical    │   $CRITICAL   │"
echo "  │ High        │   $HIGH   │"
echo "  │ Moderate    │   $MODERATE   │"
echo "  └─────────────┴───────┘"
echo ""

if [[ "$CRITICAL" -gt 0 || "$HIGH" -gt 0 ]]; then
    log_error "Found $CRITICAL critical and $HIGH high vulnerabilities"
else
    log_success "No critical or high vulnerabilities found"
fi

# =============================================================================
# Step 8: File Structure Check
# =============================================================================
log_header "Step 8: File Structure Check"

log_step "Checking essential files..."
ESSENTIAL_FILES=(
    "package.json"
    "tsconfig.json"
    "config/tsconfig.json"
    "src/index.ts"
    "api/index.ts"
)

for file in "${ESSENTIAL_FILES[@]}"; do
    if [[ -f "$file" ]]; then
        log_success "$file exists"
    else
        log_warning "$file is missing"
    fi
done

# =============================================================================
# Final Summary
# =============================================================================
log_header "CI Check Summary"

echo ""
echo -e "┌────────────────────────────────────────────────────────────────────────┐"
echo -e "│                         Results Summary                                │"
echo -e "├────────────────────────────────────────────────────────────────────────┤"
echo -e "│  ${GREEN}Passed:   $PASSED${NC}                                                              │"
echo -e "│  ${RED}Failed:   $FAILED${NC}                                                              │"
echo -e "│  ${YELLOW}Warnings: $WARNINGS${NC}                                                              │"
echo -e "└────────────────────────────────────────────────────────────────────────┘"
echo ""

if [[ $FAILED -gt 0 ]]; then
    echo -e "${RED}╔══════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                    CI Check Failed!                                   ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════════════╝${NC}"
    exit 1
else
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                 All CI Checks Passed! ✅                              ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "📅 Completed at: ${BLUE}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
    exit 0
fi
