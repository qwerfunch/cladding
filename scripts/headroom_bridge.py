#!/usr/bin/env python3
"""Headroom one-shot bridge for the Cladding TS harness (F-6aebb9 / AC-f408c8).

Reads a JSON request on stdin, runs the in-process Headroom pipeline (Rust
core, NO proxy / NO server), writes a camelCased CompressResult on stdout.

Request  : {"messages": [...], "model": "...", "config": {...}}
Response : {"messages": [...], "tokensBefore": int, "tokensAfter": int,
            "tokensSaved": int, "compressionRatio": float,
            "transformsApplied": [str], "ccrHashes": [str], "compressed": bool}

On any failure the script exits non-zero and writes {"error": "..."} to
stderr; the TS seam (src/optimizer/headroom.ts) turns that into passthrough,
so a missing/broken Headroom install degrades cost but never correctness.

This is invoked per call as `python3 scripts/headroom_bridge.py`. It is
deliberately serverless: it starts, compresses once, and exits.
"""
from __future__ import annotations

import json
import sys


def _fail(message: str, code: int) -> int:
    json.dump({"error": message}, sys.stderr)
    return code


def main() -> int:
    try:
        request = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        return _fail(f"bad request json: {exc}", 2)

    messages = request.get("messages")
    if not isinstance(messages, list):
        return _fail("request.messages must be a list", 2)

    try:
        # In-process compression — no proxy, no config server. The import
        # itself pulls in the compiled Rust extension (headroom._core).
        from headroom import CompressConfig, compress
    except ImportError as exc:
        return _fail(f"headroom not installed: {exc}", 3)

    cfg_in = request.get("config") or {}
    config = CompressConfig(
        compress_user_messages=cfg_in.get("compress_user_messages", False),
        compress_system_messages=cfg_in.get("compress_system_messages", True),
        protect_recent=cfg_in.get("protect_recent", 4),
        protect_analysis_context=cfg_in.get("protect_analysis_context", True),
        target_ratio=cfg_in.get("target_ratio"),
        min_tokens_to_compress=cfg_in.get("min_tokens_to_compress", 250),
    )

    try:
        result = compress(
            messages,
            model=request.get("model", "claude-sonnet-4-5-20250929"),
            config=config,
        )
    except Exception as exc:  # noqa: BLE001 — any pipeline error → caller falls back
        return _fail(f"compress failed: {exc}", 4)

    json.dump(
        {
            "messages": result.messages,
            "tokensBefore": result.tokens_before,
            "tokensAfter": result.tokens_after,
            "tokensSaved": result.tokens_saved,
            "compressionRatio": result.compression_ratio,
            "transformsApplied": list(result.transforms_applied),
            "ccrHashes": list(getattr(result, "ccr_hashes", []) or []),
            "compressed": result.tokens_saved > 0,
        },
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
