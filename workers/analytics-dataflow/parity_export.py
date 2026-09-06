"""Dependency-free test bridge for comparing the streaming and backend contracts."""
import json
import sys
from dataclasses import asdict
from analytics_transform import process_batch

if __name__ == "__main__":
    request = json.load(sys.stdin)
    json.dump(asdict(process_batch(request["events"], received_at=request["generatedAt"])), sys.stdout)
