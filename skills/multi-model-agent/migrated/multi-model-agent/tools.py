"""
Tool adapters for the multi-model-agent migration.

These adapters intentionally avoid real network or credential usage.
They model the shape of LiteLLM health, model info, and spend APIs so the
graph can be extended later without changing its state semantics.
"""
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import re
from typing import Dict, List, Optional, Tuple


@dataclass
class AdapterEndpoints:
    """Static endpoint metadata for the adapter."""
    model_info: str = "http://localhost:4000/model/info"
    spend_logs: str = "http://localhost:4000/spend/logs"
    health: str = "http://localhost:4000/health"

    @classmethod
    def from_env(cls) -> "AdapterEndpoints":
        """Build endpoints from environment variables when present."""
        base_url = os.environ.get("LITELLM_BASE_URL", "http://localhost:4000").rstrip("/")
        return cls(
            model_info=os.environ.get("LITELLM_MODEL_INFO_URL", f"{base_url}/model/info"),
            spend_logs=os.environ.get("LITELLM_SPEND_LOGS_URL", f"{base_url}/spend/logs"),
            health=os.environ.get("LITELLM_HEALTH_URL", f"{base_url}/health"),
        )


def discover_litellm_config_path(explicit_path: Optional[str] = None) -> Tuple[Optional[Path], List[str]]:
    """
    Discover a LiteLLM config file for a fresh environment.

    Search order:
    1. Explicit function argument
    2. Environment variables
    3. Current working directory
    4. `~/.claude/`
    5. Home directory fallback
    """

    notes: List[str] = []
    candidates: List[Tuple[str, Path]] = []

    if explicit_path:
        candidates.append(("explicit", Path(explicit_path).expanduser()))

    env_keys = [
        "LITELLM_CONFIG_PATH",
        "LITELLM_CONFIG",
        "MULTI_MODEL_AGENT_LITELLM_CONFIG",
    ]
    for key in env_keys:
        value = os.environ.get(key)
        if value:
            candidates.append((f"env:{key}", Path(value).expanduser()))

    cwd = Path.cwd()
    candidates.extend(
        [
            ("cwd", cwd / "litellm-config.yaml"),
            ("cwd", cwd / ".claude" / "litellm-config.yaml"),
            ("home", Path.home() / ".claude" / "litellm-config.yaml"),
            ("home", Path.home() / "litellm-config.yaml"),
        ]
    )

    seen: set[Path] = set()
    for source, candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        if candidate.exists():
            notes.append(f"Discovered LiteLLM config via {source}: {candidate}")
            return candidate, notes

    notes.append("No LiteLLM config discovered; adapter will fall back to local model matrix.")
    return None, notes


class LiteLLMAdapter:
    """Small local adapter that mirrors LiteLLM concepts without live calls."""

    def __init__(
        self,
        config_path: Optional[str] = None,
        endpoints: Optional[AdapterEndpoints] = None,
    ):
        discovered_path, discovery_notes = discover_litellm_config_path(config_path)
        self.config_path = discovered_path
        self.discovery_notes = discovery_notes
        self.endpoints = endpoints or AdapterEndpoints.from_env()

    def load_available_models(self, known_models: Optional[List[str]] = None) -> List[str]:
        """
        Return locally discoverable model names.

        If a config file is unavailable, the adapter falls back to the known matrix.
        """
        if self.config_path and self.config_path.exists():
            text = self.config_path.read_text(encoding="utf-8")
            matches = re.findall(r"model_name:\s*([A-Za-z0-9_.-]+)", text)
            if matches:
                return matches
        env_model_list = os.environ.get("LITELLM_MODEL_LIST")
        if env_model_list:
            return [item.strip() for item in env_model_list.split(",") if item.strip()]
        return list(known_models or [])

    def get_health_snapshot(self) -> Dict[str, object]:
        """Return a stubbed health payload."""
        return {
            "endpoint": self.endpoints.health,
            "healthy": True,
            "notes": self.discovery_notes + ["Stubbed local adapter; no live network call was made."],
        }

    def get_model_info_snapshot(self, available_models: List[str]) -> Dict[str, object]:
        """Return a model-info shaped payload."""
        return {
            "endpoint": self.endpoints.model_info,
            "models": available_models,
            "notes": self.discovery_notes + ["Model info derived from local state/config fallback."],
        }

    def get_spend_snapshot(self, selected_model: str, estimated_turns: int) -> Dict[str, object]:
        """Return a spend-log shaped payload."""
        estimated_tokens = max(estimated_turns, 1) * 1200
        return {
            "endpoint": self.endpoints.spend_logs,
            "selected_model": selected_model,
            "estimated_tokens": estimated_tokens,
            "notes": self.discovery_notes + ["Spend is estimated only in MVP mode."],
        }


def get_litellm_adapter(config_path: Optional[str] = None) -> LiteLLMAdapter:
    """Build the default adapter."""
    return LiteLLMAdapter(config_path=config_path)
