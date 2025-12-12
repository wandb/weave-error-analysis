"""
Error Analysis CLI

Usage:
    uv run ea              # Start everything
    uv run ea --port 3001  # Custom frontend port
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
AGENT_DIR = ROOT_DIR / "agent"
DATA_DIR = ROOT_DIR / "data"

# Load .env from project root
load_dotenv(ROOT_DIR / ".env")


def ensure_node_deps():
    """Install frontend dependencies if needed."""
    node_modules = FRONTEND_DIR / "node_modules"
    if not node_modules.exists():
        console.print("[yellow]Installing frontend dependencies...[/]")
        pkg_manager = "pnpm" if shutil.which("pnpm") else "npm"
        subprocess.run([pkg_manager, "install"], cwd=FRONTEND_DIR, check=True)


def init_database():
    """Copy example database if no database exists or if empty."""
    import sqlite3
    
    db_path = BACKEND_DIR / "taxonomy.db"
    example_db = DATA_DIR / "taxonomy_example.db"
    
    should_init = False
    
    if not db_path.exists():
        should_init = True
    elif example_db.exists():
        # Check if existing database has no agents (empty/fresh)
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.execute("SELECT COUNT(*) FROM agents")
            count = cursor.fetchone()[0]
            conn.close()
            if count == 0:
                should_init = True
        except:
            should_init = True
    
    if should_init and example_db.exists():
        console.print("[yellow]Initializing database with example data...[/]")
        shutil.copy(example_db, db_path)
        console.print("[green]✓[/] Database ready with Example Agent")




def start_agent(port: int):
    """Start example agent server."""
    env = os.environ.copy()
    env["PYTHONPATH"] = str(AGENT_DIR)
    
    # Agent uses OPENAI_API_KEY from environment (set in .env file)
    # The env.copy() above already includes it if set
    
    return subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "agent_server:app", 
         "--host", "0.0.0.0", "--port", str(port)],
        cwd=AGENT_DIR,
        env=env,
    )


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
    agent_port: int = typer.Option(9000, "--agent-port", "-a", help="Example agent port"),
    no_browser: bool = typer.Option(False, "--no-browser", help="Don't open browser"),
    no_agent: bool = typer.Option(False, "--no-agent", help="Don't start example agent"),
):
    """Start the Error Analysis tool."""
    console.print(Panel.fit(
        "[bold cyan]Error Analysis[/]\n"
        "Failure mode discovery for AI agents",
        border_style="cyan"
    ))
    
    # Setup
    ensure_node_deps()
    init_database()
    
    # Start servers
    console.print(f"\n[bold]Starting...[/]")
    
    # Start example agent (optional)
    agent_proc = None
    if not no_agent:
        agent_proc = start_agent(agent_port)
        console.print(f"  Agent:    http://localhost:{agent_port} [dim](Example Agent)[/]")
    
    backend_proc = start_backend(backend_port)
    console.print(f"  Backend:  http://localhost:{backend_port}")
    
    frontend_proc = start_frontend(port, backend_port)
    console.print(f"  Frontend: http://localhost:{port}")
    
    # Open browser
    if not no_browser:
        time.sleep(3)
        webbrowser.open(f"http://localhost:{port}")
    
    console.print(f"\n[bold green]Ready![/] http://localhost:{port}")
    console.print("[dim]Ctrl+C to stop[/]\n")
    
    try:
        backend_proc.wait()
    except KeyboardInterrupt:
        console.print("\n[yellow]Stopping...[/]")
        if agent_proc:
            agent_proc.terminate()
        backend_proc.terminate()
        frontend_proc.terminate()


if __name__ == "__main__":
    app()
