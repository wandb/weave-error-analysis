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
import socket
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


def is_port_available(port: int) -> bool:
    """Check if a port is available for binding."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def find_available_port(start_port: int, max_attempts: int = 10) -> int | None:
    """
    Find an available port starting from start_port.
    
    Returns the first available port, or None if no port is found
    within max_attempts.
    """
    for offset in range(max_attempts):
        port = start_port + offset
        if is_port_available(port):
            return port
    return None


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
    port: int = typer.Option(3000, "--port", "-p", help="Frontend port (auto-detects if in use)"),
    backend_port: int = typer.Option(8000, "--backend-port", "-b", help="Backend port (auto-detects if in use)"),
    no_browser: bool = typer.Option(False, "--no-browser", help="Don't open browser"),
    strict_ports: bool = typer.Option(False, "--strict-ports", help="Fail if specified ports are not available"),
):
    """
    Start the Error Analysis tool.
    
    Launches the backend API server and frontend UI.
    The Example Agent can be started from the Agents tab after
    configuring your API key in Settings.
    
    By default, if the specified ports are in use, the CLI will automatically
    find available ports. Use --strict-ports to disable this behavior.
    """
    console.print(Panel.fit(
        "[bold cyan]Error Analysis[/]\n"
        "Failure mode discovery for AI agents",
        border_style="cyan"
    ))
    
    # Check and auto-detect ports
    actual_backend_port = backend_port
    actual_frontend_port = port
    
    if not is_port_available(backend_port):
        if strict_ports:
            console.print(f"[red]Error:[/] Backend port {backend_port} is already in use.")
            console.print(f"[dim]Try a different port with --backend-port or stop the process using port {backend_port}[/]")
            raise typer.Exit(1)
        
        actual_backend_port = find_available_port(backend_port)
        if actual_backend_port is None:
            console.print(f"[red]Error:[/] Could not find an available port for backend (tried {backend_port}-{backend_port + 9})")
            raise typer.Exit(1)
        console.print(f"[yellow]Port {backend_port} in use, using {actual_backend_port} for backend[/]")
    
    if not is_port_available(port):
        if strict_ports:
            console.print(f"[red]Error:[/] Frontend port {port} is already in use.")
            console.print(f"[dim]Try a different port with --port or stop the process using port {port}[/]")
            raise typer.Exit(1)
        
        actual_frontend_port = find_available_port(port)
        if actual_frontend_port is None:
            console.print(f"[red]Error:[/] Could not find an available port for frontend (tried {port}-{port + 9})")
            raise typer.Exit(1)
        console.print(f"[yellow]Port {port} in use, using {actual_frontend_port} for frontend[/]")
    
    # Setup
    ensure_node_deps()
    init_database()
    
    # Start servers (no agent - lazy loaded via UI)
    console.print(f"\n[bold]Starting...[/]")
    
    backend_proc = start_backend(actual_backend_port)
    console.print(f"  Backend:  http://localhost:{actual_backend_port}")
    
    frontend_proc = start_frontend(actual_frontend_port, actual_backend_port)
    console.print(f"  Frontend: http://localhost:{actual_frontend_port}")
    
    console.print(f"\n[bold green]Ready![/] http://localhost:{actual_frontend_port}")
    console.print("[dim]Configure Settings, then start Example Agent from Agents tab[/]")
    console.print("[dim]Ctrl+C to stop[/]\n")
    
    # Open browser
    if not no_browser:
        time.sleep(3)
        webbrowser.open(f"http://localhost:{actual_frontend_port}")
    
    try:
        backend_proc.wait()
    except KeyboardInterrupt:
        console.print("\n[yellow]Stopping...[/]")
        backend_proc.terminate()
        frontend_proc.terminate()


if __name__ == "__main__":
    app()
