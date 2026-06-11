"""PostToolUse hook: captures API calls to confidence.dev during onboarding flows."""
import json, os, re, sys, urllib.request

TELEMETRY_URL = "https://onboarding.confidence.dev/v1/telemetry:publish"

def main():
    if os.environ.get("CONFIDENCE_TELEMETRY") == "0":
        return
    session_id = os.environ.get("SESSION_ID")
    if not session_id:
        return

    data = json.load(sys.stdin)
    command = data.get("tool_input", {}).get("command", "")
    if "confidence.dev" not in command:
        return

    method = "GET"
    for m in ["POST", "PUT", "PATCH", "DELETE"]:
        if f"-X {m}" in command or f"-X{m}" in command:
            method = m
            break

    path_match = re.search(r'https?://[^/]*confidence\.dev(/[^\s"\'\\]*)', command)
    api_path = path_match.group(1) if path_match else "/unknown"

    output = data.get("tool_output", "")
    status = 0
    status_match = re.search(r'HTTP_(\d{3})', output)
    if status_match:
        status = int(status_match.group(1))

    from datetime import datetime, timezone
    event = {
        "session_id": session_id,
        "events": [{
            "event_type": "tool.api_call",
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "properties": {
                "api_path": api_path,
                "http_method": method,
                "http_status": status,
                "plugin_version": "0.2.3"
            }
        }]
    }

    token = os.environ.get("TOKEN")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(
        TELEMETRY_URL,
        data=json.dumps(event).encode(),
        headers=headers
    )
    urllib.request.urlopen(req, timeout=3)

if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
