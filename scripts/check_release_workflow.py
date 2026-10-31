# -*- coding: utf-8 -*-
"""Structural invariants for .github/workflows/release.yml.

These catch the class of regression where an edit silently drops a step or
leaves a step consuming a variable that nothing produces (which previously
published a release with an empty body).
"""
import re
import sys
import os
import yaml

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WF = os.path.join(ROOT, ".github", "workflows", "release.yml")

REQUIRED_STEPS = [
    "Checkout Repository",
    "Resolve Version",
    "Build Tauri Production App",
    "Prepare Artifacts & Calculate Hashes",
    "Write Release Manifest (version.json)",
    "Extract Release Notes",
    "Publish GitHub Release",
    "Verify Published Release Integrity",
    "Commit and Push Version Manifests to main",
    "Purge jsDelivr CDN Cache",
]

# Steps that must run strictly in this relative order.
ORDERED = [
    "Write Release Manifest (version.json)",
    "Extract Release Notes",
    "Publish GitHub Release",
    "Verify Published Release Integrity",
    "Commit and Push Version Manifests to main",
]


def main() -> int:
    with open(WF, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    steps = doc["jobs"]["build-and-release"]["steps"]
    names = [s.get("name", "") for s in steps]
    failures = []

    for required in REQUIRED_STEPS:
        if required not in names:
            failures.append(f"missing required step: {required}")

    idx = {n: i for i, n in enumerate(names)}
    for a, b in zip(ORDERED, ORDERED[1:]):
        if a in idx and b in idx and idx[a] >= idx[b]:
            failures.append(f"step order wrong: '{a}' must come before '{b}'")

    # Every var consumed from GITHUB_ENV must be produced somewhere.
    raw = open(WF, encoding="utf-8").read()
    produced = set(re.findall(r'\b([A-Z][A-Z0-9_]{2,})=', raw)) | set(re.findall(r'^\s*"?([A-Z_]+)=', raw, re.M))
    consumed = set(re.findall(r'\$env:([A-Z_]+)', raw)) | set(re.findall(r'env\.([A-Z_]+)', raw))
    builtins = {"GITHUB_ENV", "RUNNER_TEMP", "GITHUB_REF", "GITHUB_REF_NAME"}
    for var in sorted(consumed - produced - builtins):
        failures.append(f"consumed but never produced: {var}")

    if "Update version.json with Release SHA256" in raw:
        failures.append("stale CDN-reading manifest step is back")

    if failures:
        for f in failures:
            print(f"::error::{f}")
        return 1
    print(f"release.yml invariants OK ({len(steps)} steps)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
