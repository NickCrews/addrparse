# /// script
# requires-python = "==3.12.*"
# dependencies = ["postal==1.1.10"]
# ///
"""Reads one JSON string per stdin line; writes libpostal's parse_address [[value, label], ...]
or {"error": message} per stdout line. Needs the libpostal C library and its data directory
(LIBPOSTAL_DATA_DIR); see CONTRIBUTING.md."""

import json
import sys

from postal.parser import parse_address

for line in sys.stdin:
    text = json.loads(line)
    try:
        out = [list(pair) for pair in parse_address(text)]
    except Exception as e:  # noqa: BLE001 - one bad text shouldn't stop the batch
        out = {"error": f"{type(e).__name__}: {e}"}
    sys.stdout.write(json.dumps(out) + "\n")
