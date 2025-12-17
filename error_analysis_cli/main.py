"""
Error Analysis CLI

Usage:
    uv run ea              # Start backend + frontend
    uv run ea --port 3001  # Custom frontend port
    
The Example Agent is started from the UI (Agents tab), not the CLI.
This allows users to configure their API key in Settings first.
"""

import os
import sys
import subprocess
import shutil
import webbrowser
import time
from pathlib import Path

import typer
from rich.console import Console
from rich.panel import Panel
from dotenv import load_dotenv

app = typer.Typer(help="Error Analysis Tool for AI Agents")
console = Console()

ROOT_DIR = Path(__file__).parent.parent
BACKEND_DIR = ROOT_DIR / "backend"
FRONTEND_DIR = ROOT_DIR / "frontend"
DATA_DIR = ROOT_DIR / "data"

# Load .env from project root (for developer use only)
load_dotenv(ROOT_DIR / ".env")


def ensure_node_deps():
    """Install frontend dependencies if needed."""
    node_modules = FRONTEND_DIR / "node_modules"
    if not node_modules.exists():
        console.print("[yellow]Installing frontend dependencies...[/]")
        pkg_manager = "pnpm" if shutil.which("pnpm") else "npm"
        subprocess.run([pkg_manager, "install"], cwd=FRONTEND_DIR, check=True)


def init_database():
    """
    Initialize the database if it doesn't exist.
    
    The database schema is auto-created by the backend on startup.
    We just ensure the directory exists and optionally register the 
    Example Agent so it appears in the Agents tab.
    """
    db_path = BACKEND_DIR / "taxonomy.db"
    
    if not db_path.exists():
        console.print("[dim]Database will be initialized on first request[/]")



def start_backend(port: int):
    """Start FastAPI backend."""
    env = os.environ.copy()
    env["PYTHONPATH"] = str(BACKEND_DIR)
    
    return subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", 
         "--host", "0.0.0.0", "--port", str(port)],
        cwd=BACKEND_DIR,
        env=env,
    )


def start_frontend(port: int, backend_port: int):
    """Start Next.js frontend."""
    env = os.environ.copy()
    env["PORT"] = str(port)
    env["NEXT_PUBLIC_BACKEND_PORT"] = str(backend_port)
    
    pkg_manager = "pnpm" if shutil.which("pnpm") else "npm"
    return subprocess.Popen(
        [pkg_manager, "run", "dev"],
        cwd=FRONTEND_DIR,
        env=env,
    )


@app.command()
def start(
    port: int = typer.Option(3000, "--port", "-p", help="Frontend port"),
    backend_port: int = typer.Option(8000, "--backend-port", "-b", help="Backend port"),
    no_browser: bool = typer.Option(False, "--no-browser", help="Don't open browser"),
):
    """
    Start the Error Analysis tool.
    
    Launches the backend API server and frontend UI.
    The Example Agent can be started from the Agents tab after
    configuring your API key in Settings.
    """
    console.print(Panel.fit(
        "[bold cyan]Error Analysis[/]\n"
        "Failure mode discovery for AI agents",
        border_style="cyan"
    ))
    
    # Setup
    ensure_node_deps()
    init_database()
    
    # Start servers (no agent - lazy loaded via UI)
    console.print(f"\n[bold]Starting...[/]")
    
    backend_proc = start_backend(backend_port)
    console.print(f"  Backend:  http://localhost:{backend_port}")
    
    frontend_proc = start_frontend(port, backend_port)
    console.print(f"  Frontend: http://localhost:{port}")
    
    console.print(f"\n[bold green]Ready![/] http://localhost:{port}")
    console.print("[dim]Configure Settings, then start Example Agent from Agents tab[/]")
    console.print("[dim]Ctrl+C to stop[/]\n")
    
    # Open browser
    if not no_browser:
        time.sleep(3)
        webbrowser.open(f"http://localhost:{port}")
    
    try:
        backend_proc.wait()
    except KeyboardInterrupt:
        console.print("\n[yellow]Stopping...[/]")
        backend_proc.terminate()
        frontend_proc.terminate()


if __name__ == "__main__":
    app()
