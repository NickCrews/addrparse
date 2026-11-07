# /// script
# requires-python = "==3.12.*"
# dependencies = ["usaddress==0.5.16"]
# ///
"""Reads one JSON string per stdin line; writes usaddress.parse's [[token, label], ...] or
{"error": message} per stdout line."""

import json
import sys

import usaddress

for line in sys.stdin:
    text = json.loads(line)
    try:
        out = [list(pair) for pair in usaddress.parse(text)]
    except Exception as e:  # noqa: BLE001 - one bad text shouldn't stop the batch
        out = {"error": f"{type(e).__name__}: {e}"}
    sys.stdout.write(json.dumps(out) + "\n")
