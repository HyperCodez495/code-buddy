#!/usr/bin/env python3
"""Stable Code Buddy entry point for the isolated PanoWorld runner."""

from __future__ import annotations

import os
from pathlib import Path
import sys


RUNNER = Path(__file__).with_name("panoworld-runner.py")


if __name__ == "__main__":
    os.execv(sys.executable, [sys.executable, str(RUNNER), *sys.argv[1:]])
