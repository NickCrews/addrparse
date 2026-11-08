# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb==1.4.1"]
# ///
"""Writes the distinct US addresses in APOC's campaign finance tables to a JSON-lines file:
{"address", "city", "state", "zip", "n"}, where n is how many rows have it.

    uv run scripts/ak-apoc/extract.py <release tag> <out.jsonl>

Reads the raw CSVs of a release of https://github.com/NickCrews/apoc-data, e.g. 20261106-191557.
"""

import json
import sys

import duckdb

TABLES = [
    "income",
    "expenditures",
    "debt",
    "candidate_registration",
    "group_registration",
    "entity_registration",
]

tag, out_path = sys.argv[1:]
base = f"https://github.com/NickCrews/apoc-data/releases/download/{tag}"
con = duckdb.connect()
con.sql("INSTALL httpfs; LOAD httpfs;")
# The transaction's own columns come first; the filer's, after a "--------" column, never
# include an address, so these names are the transaction's.
union = " UNION ALL ".join(
    f"""SELECT trim("Address") AS address, trim("City") AS city, trim("State") AS state,
        trim("Zip") AS zip, trim("Country") AS country
        FROM read_csv('{base}/{t}.csv', all_varchar = true)"""
    for t in TABLES
)
rows = con.sql(
    f"""
    SELECT address, city, state, zip, count(*) AS n
    FROM ({union})
    WHERE country = 'USA' AND coalesce(address, '') <> ''
    GROUP BY ALL
    ORDER BY n DESC, address, city, state, zip
    """
).fetchall()
with open(out_path, "w") as f:
    for address, city, state, zip_, n in rows:
        f.write(
            json.dumps({"address": address, "city": city, "state": state, "zip": zip_, "n": n})
            + "\n"
        )
print(f"{len(rows):,} addresses from release {tag}", file=sys.stderr)
