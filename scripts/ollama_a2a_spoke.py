#!/usr/bin/env python3
"""
Ollama A2A Spoke — Transform Ollama into a fleet participant

Exposes Ollama models as A2A-compatible skills to the Code Buddy hub.
Registers as a spoke at hub (100.98.18.76:3000) and routes task requests to Ollama.

Usage:
  python ollama_a2a_spoke.py
  or: python ollama_a2a_spoke.py --hub http://100.98.18.76:3000 --port 3002
"""

import os
import sys
import json
import requests
import argparse
import subprocess
from typing import Optional
from datetime import datetime
from pathlib import Path

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.responses import JSONResponse
    import uvicorn
except ImportError:
    print("FastAPI required. Install with: pip install fastapi uvicorn requests")
    sys.exit(1)


class OllamaSpoke:
    def __init__(self, ollama_url: str = "http://127.0.0.1:11434",
                 hub_url: str = "http://100.98.18.76:3000",
                 port: int = 3002,
                 host: str = "0.0.0.0"):
        self.ollama_url = ollama_url
        self.hub_url = hub_url
        self.port = port
        self.host = host
        self.app = FastAPI(title="Ollama A2A Spoke")
        self.models = {}
        self.hostname = subprocess.check_output(['hostname', '-s']).decode().strip()

        # Setup routes
        self._setup_routes()

    def _setup_routes(self):
        @self.app.get("/api/a2a/.well-known/agent.json")
        async def discovery():
            """A2A discovery endpoint — return AgentCard for this Ollama spoke"""
            return {
                "name": f"Ollama / {self.hostname}",
                "description": "Local Ollama instance exposing LLM models as A2A skills",
                "url": f"http://{self.hostname}:3002",
                "version": "1.0.0",
                "skills": [
                    {
                        "id": f"ollama-{model['name'].replace(':', '-')}",
                        "name": f"Generate ({model['name']})",
                        "description": f"Generate text using {model['name']} ({model['size']})",
                        "inputModes": ["text/plain"],
                        "outputModes": ["text/plain"]
                    }
                    for model in self.models.values()
                ],
                "capabilities": {
                    "streaming": False,
                    "pushNotifications": False
                }
            }

        @self.app.post("/api/a2a/tasks/execute")
        async def execute_task(task: dict):
            """Execute a task (LLM generation) via Ollama"""
            try:
                model = task.get("model")
                prompt = task.get("prompt")

                if not model or not prompt:
                    raise HTTPException(status_code=400, detail="model and prompt required")

                # Call Ollama
                response = requests.post(
                    f"{self.ollama_url}/api/generate",
                    json={
                        "model": model,
                        "prompt": prompt,
                        "stream": False
                    },
                    timeout=300
                )
                response.raise_for_status()
                result = response.json()

                return {
                    "task_id": task.get("id", "unknown"),
                    "status": "completed",
                    "result": result.get("response", ""),
                    "timestamp": datetime.utcnow().isoformat()
                }
            except Exception as e:
                return JSONResponse(
                    status_code=500,
                    content={"error": str(e), "task_id": task.get("id")}
                )

        @self.app.get("/health")
        async def health():
            """Health check"""
            try:
                resp = requests.get(f"{self.ollama_url}/api/tags", timeout=5)
                return {"status": "ok", "ollama": "connected"}
            except:
                return JSONResponse(
                    status_code=503,
                    content={"status": "error", "ollama": "disconnected"}
                )

    def discover_models(self):
        """Fetch available models from Ollama"""
        try:
            resp = requests.get(f"{self.ollama_url}/api/tags", timeout=5)
            resp.raise_for_status()
            data = resp.json()
            self.models = {m["name"]: m for m in data.get("models", [])}
            print(f"✅ Discovered {len(self.models)} models:")
            for name, meta in self.models.items():
                print(f"   - {name} ({meta.get('size', 'unknown')})")
            return True
        except Exception as e:
            print(f"⚠️  Failed to discover models: {e}")
            return False

    def discover_hub(self) -> bool:
        """Verify hub is reachable and get its AgentCard"""
        try:
            resp = requests.get(
                f"{self.hub_url}/api/a2a/.well-known/agent.json",
                timeout=5
            )
            resp.raise_for_status()
            agent = resp.json()
            print(f"✅ Hub discovered: {agent.get('name')} @ {self.hub_url}")
            print(f"   Skills: {len(agent.get('skills', []))} available")
            return True
        except Exception as e:
            print(f"⚠️  Hub unreachable: {e}")
            return False

    def register_at_hub(self) -> bool:
        """Register this spoke at the hub (POC Level 1 — not yet implemented in Code Buddy)"""
        try:
            agent_card = {
                "name": f"Ollama / {self.hostname}",
                "description": "Local Ollama instance",
                "url": f"http://{self.hostname}:3002",
                "version": "1.0.0",
                "skills": list(self.models.keys()),
                "tailscale_ip": "100.98.18.76",  # Will be autodiscovered later
            }

            # Try to register (endpoint doesn't exist yet, will fail gracefully)
            resp = requests.post(
                f"{self.hub_url}/api/a2a/agents/register",
                json=agent_card,
                timeout=5
            )

            if resp.status_code == 404:
                print("⏳ Hub registration endpoint not ready (POC Level 1 pending)")
                return False
            elif resp.status_code in [200, 201]:
                print(f"✅ Registered at hub: {resp.json()}")
                return True
            else:
                print(f"⚠️  Registration failed: {resp.status_code} {resp.text}")
                return False

        except requests.exceptions.Timeout:
            print("⏳ Hub registration timeout (endpoint not ready)")
            return False
        except Exception as e:
            print(f"⚠️  Registration error: {e}")
            return False

    def run(self):
        """Start the spoke server"""
        print(f"\n🚀 Ollama A2A Spoke starting")
        print(f"   Hostname: {self.hostname}")
        print(f"   Ollama: {self.ollama_url}")
        print(f"   Hub: {self.hub_url}")
        print(f"   Listen: {self.host}:{self.port}\n")

        # Discover models
        if not self.discover_models():
            print("⚠️  No models available. Start Ollama first.")
            sys.exit(1)

        print()

        # Try to discover hub
        self.discover_hub()

        # Try to register (will fail gracefully if endpoint not ready)
        self.register_at_hub()

        print(f"\n📡 Endpoints ready:")
        print(f"   Discovery: http://{self.hostname}:3002/api/a2a/.well-known/agent.json")
        print(f"   Health: http://{self.hostname}:3002/health")
        print(f"   Tasks: POST http://{self.hostname}:3002/api/a2a/tasks/execute")
        print()

        # Start server
        uvicorn.run(self.app, host=self.host, port=self.port, log_level="info")


def main():
    parser = argparse.ArgumentParser(description="Ollama A2A Spoke")
    parser.add_argument("--ollama", default="http://127.0.0.1:11434",
                       help="Ollama URL (default: http://127.0.0.1:11434)")
    parser.add_argument("--hub", default="http://100.98.18.76:3000",
                       help="Hub URL (default: http://100.98.18.76:3000)")
    parser.add_argument("--port", type=int, default=3002,
                       help="Port to listen on (default: 3002)")
    parser.add_argument("--host", default="0.0.0.0",
                       help="Host to bind to (default: 0.0.0.0)")

    args = parser.parse_args()

    spoke = OllamaSpoke(
        ollama_url=args.ollama,
        hub_url=args.hub,
        port=args.port,
        host=args.host
    )
    spoke.run()


if __name__ == "__main__":
    main()
