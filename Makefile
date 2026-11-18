# shellcheck shell=bash disable=SC1091  # shellcheck hint; make ignores this line
SHELL := /bin/bash

.PHONY: run run-realsense demo setup test lint

# Serve the dashboard from the default webcam (camera.source in config.yaml);
# falls back to the synthetic demo when no webcam opens.
run:
	@source .venv/bin/activate && python -m posture_guard.dashboard.serve

# Intel RealSense D400 color + depth.
run-realsense:
	@source .venv/bin/activate && python -m posture_guard.dashboard.serve --camera realsense

# No camera: scripted good/slouch demo (headless demos, judging).
demo:
	@source .venv/bin/activate && python -m posture_guard.dashboard.serve --camera synthetic

setup:
	./setup.sh

test:
	@source .venv/bin/activate && pytest

lint:
	@source .venv/bin/activate && ruff check .
