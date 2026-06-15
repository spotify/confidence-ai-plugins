"""Live end-to-end resolve check for the migrated Confidence Python setup.

Unlike `verify_api.py` (which only checks symbols/signatures offline), this
actually initializes the local-resolve provider against a real Confidence
project, downloads resolver state, and resolves a flag — proving the migrated
code path works at runtime.

It is NOT part of CI: it needs a real **backend** client secret and an existing
flag enabled for that client.

Usage:
    pip install --target /tmp/pylocal -r requirements.txt
    export CONFIDENCE_FLAG_CLIENT_SECRET=<backend client secret>
    export E2E_FLAG_PATH=my-flag.enabled        # a flag.property on that client
    export E2E_ENTITY_FIELD=user_id             # the Phase 1 entity field
    PYTHONPATH=/tmp/pylocal:src python3 e2e_resolve.py

Key lesson baked in: the evaluation context sets the **entity field** (the field
Phase 1's rules bucket by, e.g. `user_id`), not just `targeting_key`. With only
`targeting_key`, the local resolver returns DEFAULT for every flag.
"""

import os

from openfeature import api
from openfeature.evaluation_context import EvaluationContext
from confidence import ConfidenceProvider

FLAG_PATH = os.environ.get("E2E_FLAG_PATH", "my-flag.enabled")
ENTITY_FIELD = os.environ.get("E2E_ENTITY_FIELD", "user_id")


def main() -> None:
    secret = os.environ["CONFIDENCE_FLAG_CLIENT_SECRET"]
    api.set_provider_and_wait(ConfidenceProvider(client_secret=secret))
    client = api.get_client()

    user_id = "e2e-user-1"
    context = EvaluationContext(
        targeting_key=user_id,
        # The entity field is REQUIRED — targeting_key alone resolves to DEFAULT.
        attributes={ENTITY_FIELD: user_id},
    )

    details = client.get_boolean_details(FLAG_PATH, False, context)
    print(
        f"{FLAG_PATH}: value={details.value} reason={details.reason} "
        f"variant={details.variant} error={details.error_code}"
    )
    if str(details.reason) == "DEFAULT":
        print(
            "NOTE: DEFAULT — the flag wasn't matched. Check the flag exists/is "
            f"enabled for this client and that '{ENTITY_FIELD}' is the entity "
            "field its rules bucket by."
        )


if __name__ == "__main__":
    main()
