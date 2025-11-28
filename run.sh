#!/bin/bash

# Error Analysis Workflow Runner
# This script helps you start all components

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

print_header() {
    echo ""
    echo "=============================================="
    echo "  $1"
    echo "=============================================="
}

case "$1" in
    "setup")
        print_header "Setting up all components"
        
        echo "Setting up agent..."
        cd "$SCRIPT_DIR/agent"
        python -m venv .venv
        source .venv/bin/activate
        pip install -r requirements.txt
        deactivate
        
        echo "Setting up backend..."
        cd "$SCRIPT_DIR/backend"
        python -m venv .venv
        source .venv/bin/activate
        pip install -r requirements.txt
        deactivate
        
        echo "Setting up frontend..."
        cd "$SCRIPT_DIR/frontend"
        pnpm install
        
        echo ""
        echo "✅ Setup complete!"
        echo ""
        echo "Next steps:"
        echo "1. Create a .env file with your API keys"
        echo "2. Run: ./run.sh generate-traces"
        echo "3. Run: ./run.sh backend"
        echo "4. Run: ./run.sh frontend"
        ;;
        
    "generate-traces")
        print_header "Generating traces"
        cd "$SCRIPT_DIR/agent"
        source .venv/bin/activate
        python generate_traces.py
        ;;
        
    "agent")
        print_header "Starting interactive agent"
        cd "$SCRIPT_DIR/agent"
        source .venv/bin/activate
        python travel_planner.py
        ;;
        
    "backend")
        print_header "Starting backend server"
        cd "$SCRIPT_DIR/backend"
        source .venv/bin/activate
        uvicorn main:app --reload --port 8000
        ;;
        
    "frontend")
        print_header "Starting frontend"
        cd "$SCRIPT_DIR/frontend"
        pnpm dev
        ;;
        
    *)
        echo "Usage: ./run.sh [command]"
        echo ""
        echo "Commands:"
        echo "  setup           - Install all dependencies"
        echo "  generate-traces - Generate sample traces"
        echo "  agent           - Run interactive agent"
        echo "  backend         - Start backend server (port 8000)"
        echo "  frontend        - Start frontend dev server (port 3000)"
        echo ""
        echo "Typical workflow:"
        echo "  1. ./run.sh setup"
        echo "  2. ./run.sh generate-traces"
        echo "  3. ./run.sh backend    # Terminal 1"
        echo "  4. ./run.sh frontend   # Terminal 2"
        echo "  5. Open http://localhost:3000"
        ;;
esac

