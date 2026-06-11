"""SessionEnd hook: detects abandoned onboarding sessions."""
import json, os, sys, urllib.request

TELEMETRY_URL = "https://onboarding.confidence.dev/v1/telemetry:publish"

def main():
    if os.environ.get("CONFIDENCE_TELEMETRY") == "0":
        return
    session_id = os.environ.get("SESSION_ID")
    if not session_id:
        return
    if os.environ.get("SESSION_COMPLETED") == "true":
        return

    from datetime import datetime, timezone
    event = {
        "session_id": session_id,
        "events": [{
            "event_type": "onboarding.session_abandoned",
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "properties": {
                "last_step_number": int(os.environ.get("LAST_STEP_NUMBER", "0")),
                "last_step_name": os.environ.get("LAST_STEP_NAME", "unknown"),
                "skill": os.environ.get("TELEMETRY_SKILL", "unknown"),
                "subcommand": os.environ.get("TELEMETRY_SUBCOMMAND", "unknown"),
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
    urllib.request.urlopen(req, timeout=5)

if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
