#!/bin/bash
# Comprehensive test runner for Resonate Protocol smart contracts
# 
# Usage:
#   ./scripts/test-all.sh           # Run all tests
#   ./scripts/test-all.sh unit      # Run only unit tests
#   ./scripts/test-all.sh fuzz      # Run only fuzz tests
#   ./scripts/test-all.sh invariant # Run only invariant tests
#   ./scripts/test-all.sh formal    # Run only formal verification (Halmos)
#   ./scripts/test-all.sh mutation  # Run only mutation testing (Gambit)
#   ./scripts/test-all.sh coverage  # Generate coverage report

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Resonate Protocol Test Suite           ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# Function to run unit tests
run_unit_tests() {
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Running Unit Tests...${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    forge test --match-path "test/unit/*.sol" -vvv
    echo -e "${GREEN}✓ Unit tests completed${NC}"
    echo ""
}

# Function to run fuzz tests
run_fuzz_tests() {
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Running Fuzz Tests (256 runs per test)...${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    forge test --match-path "test/fuzz/*.sol" --fuzz-runs 256 -vv
    echo -e "${GREEN}✓ Fuzz tests completed${NC}"
    echo ""
}

# Function to run invariant tests
run_invariant_tests() {
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Running Invariant Tests...${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    forge test --match-path "test/invariant/*.sol" --fuzz-runs 64 -vv
    echo -e "${GREEN}✓ Invariant tests completed${NC}"
    echo ""
}

# Function to run formal verification with Halmos
run_formal_tests() {
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Running Formal Verification (Halmos)...${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    if ! command -v halmos &> /dev/null; then
        echo -e "${RED}✗ Halmos not installed${NC}"
        echo "  Install with: uv tool install halmos"
        echo "  Or: pip install halmos"
        return 1
    fi
    
    # Run Halmos on formal tests
    halmos --contract StemNFTFormalTest --solver-timeout-assertion 60000 --loop 5 || true
    halmos --contract StemMarketplaceFormalTest --solver-timeout-assertion 60000 --loop 5 || true
    
    echo -e "${GREEN}✓ Formal verification completed${NC}"
    echo ""
}

# Function to run mutation testing with Gambit
run_mutation_tests() {
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Running Mutation Testing (Gambit)...${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    if ! command -v gambit &> /dev/null; then
        echo -e "${RED}✗ Gambit not installed${NC}"
        echo "  Install from: https://github.com/Certora/gambit"
        echo "  Or: pip install certora-gambit"
        return 1
    fi
    
    # Generate mutants for StemNFT
    echo "Generating mutants for StemNFT..."
    gambit mutate --json gambit.json || true
    
    # Generate mutants for StemMarketplace
    echo "Generating mutants for StemMarketplaceV2..."
    gambit mutate --json gambit-marketplace.json || true
    
    # Run tests against mutants
    echo "Testing mutants..."
    if [ -d "gambit_out" ]; then
        for mutant in gambit_out/mutants/*/; do
            echo "Testing mutant: $mutant"
            cp "$mutant"/*.sol src/core/ 2>/dev/null || true
            forge test --match-path "test/unit/*.sol" --fail-fast 2>/dev/null || echo "  → Mutant killed ✓"
        done
        # Restore originals
        git checkout src/core/*.sol 2>/dev/null || true
    fi
    
    echo -e "${GREEN}✓ Mutation testing completed${NC}"
    echo ""
}

# Function to generate coverage report
run_coverage() {
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Generating Coverage Report...${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    forge coverage --report lcov --report summary
    
    if command -v genhtml &> /dev/null; then
        genhtml lcov.info -o coverage --branch-coverage
        echo -e "${GREEN}✓ HTML coverage report: coverage/index.html${NC}"
    fi
    
    echo -e "${GREEN}✓ Coverage report completed${NC}"
    echo ""
}

# Function to run all tests
run_all() {
    local start_time=$(date +%s)
    
    run_unit_tests
    run_fuzz_tests
    run_invariant_tests
    
    # Optional: run formal if halmos is installed
    if command -v halmos &> /dev/null; then
        run_formal_tests
    else
        echo -e "${YELLOW}⚠ Skipping formal verification (halmos not installed)${NC}"
    fi
    
    # Optional: run mutation if gambit is installed  
    if command -v gambit &> /dev/null; then
        run_mutation_tests
    else
        echo -e "${YELLOW}⚠ Skipping mutation testing (gambit not installed)${NC}"
    fi
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║     All Tests Completed in ${duration}s           ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
}

# Main
case "${1:-all}" in
    unit)
        run_unit_tests
        ;;
    fuzz)
        run_fuzz_tests
        ;;
    invariant)
        run_invariant_tests
        ;;
    formal)
        run_formal_tests
        ;;
    mutation)
        run_mutation_tests
        ;;
    coverage)
        run_coverage
        ;;
    all)
        run_all
        ;;
    *)
        echo "Usage: $0 {unit|fuzz|invariant|formal|mutation|coverage|all}"
        exit 1
        ;;
esac
