#!/bin/bash

# you.md Personalization Evaluation using PromptLens
#
# Requires:
#   - PromptLens installed: pip install promptlens
#   - ANTHROPIC_API_KEY set
#
# Usage:
#   cd eval/promptlens && ./run_eval.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "  you.md Personalization Eval (PromptLens)"
echo "=========================================="
echo ""

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "Error: ANTHROPIC_API_KEY environment variable required"
    exit 1
fi

# Create results directories
mkdir -p results/baseline results/expert results/beginner

echo "Running 3 evaluation profiles..."
echo ""

# Run baseline evaluation
echo "[1/3] Running BASELINE evaluation (no profile)..."
python3 -m promptlens run config_baseline.yaml
echo "     Done. Results in results/baseline/"
echo ""

# Run expert evaluation
echo "[2/3] Running EXPERT profile evaluation..."
python3 -m promptlens run config_expert.yaml
echo "     Done. Results in results/expert/"
echo ""

# Run beginner evaluation
echo "[3/3] Running BEGINNER profile evaluation..."
python3 -m promptlens run config_beginner.yaml
echo "     Done. Results in results/beginner/"
echo ""

echo "=========================================="
echo "  Evaluation Complete!"
echo "=========================================="
echo ""
echo "Results:"
echo "  - Baseline: results/baseline/report.html"
echo "  - Expert:   results/expert/report.html"
echo "  - Beginner: results/beginner/report.html"
echo ""
echo "Compare the HTML reports to see how you.md personalization"
echo "affects response quality and appropriateness."
