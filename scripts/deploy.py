#!/usr/bin/env python3
"""Deploy big-east-conference-rankings to Vercel via direct file upload (one attempt).

Requires the Vercel CLI tool (`vercel call-tool`) to be connected.
After deploying, still set BLOB_READ_WRITE_TOKEN + ADMIN_PASSWORD in the
Vercel dashboard and disable Deployment Protection (see README.md).
"""
import json
import os
import subprocess
import sys

BASE = os.path.expanduser("~/workspace/big-east-rankings")
PATHS = [
    "index.html",
    "teams.json",
    "api/_lib.js",
    "api/submit.js",
    "api/composite.js",
    "api/admin.js",
    "package.json",
    "vercel.json",
    "README.md",
]

def main():
    files = []
    total = 0
    for p in PATHS:
        with open(os.path.join(BASE, p)) as f:
            data = f.read()
        total += len(data.encode())
        files.append({"file": p, "data": data, "encoding": "utf-8"})
    print(f"payload bytes: {total}")
    args = {
        "requestBody": {
            "name": "big-east-rankings",
            "target": "production",
            "files": files,
            "projectSettings": {
                "framework": None,
                "buildCommand": None,
                "devCommand": None,
                "installCommand": None,
                "outputDirectory": None,
                "rootDirectory": None,
            },
        }
    }
    payload = json.dumps(args)
    print(f"json arg bytes: {len(payload.encode())}")
    r = subprocess.run(
        ["vercel", "call-tool", "--name", "create_deployment",
         "--arguments-json", payload],
        capture_output=True, text=True, timeout=300,
    )
    d = json.loads(r.stdout)
    content = d["result"]["content"][0]
    text = content.get("text", "")
    if content.get("isError") or '"error"' in text:
        print("DEPLOY FAILED:", text[:1500], file=sys.stderr)
        sys.exit(1)
    dep = json.loads(text)["result"]["deployment"]
    print(f"Deployed {dep['id']} -> https://{dep['url']} (state {dep['readyState']})")

if __name__ == "__main__":
    main()
