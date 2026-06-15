"""Verify the migrated python-server fixture targets the real Confidence
local-resolve provider API.

Checks symbol/signature existence against the installed packages — it does NOT
resolve flags (no client secret / network). Run after installing requirements:

    pip install --target /tmp/pylocal "confidence-openfeature-provider>=0.7.1"
    PYTHONPATH=/tmp/pylocal python3 verify_api.py
"""

import inspect

from openfeature import api
from openfeature.evaluation_context import EvaluationContext
from confidence import ConfidenceProvider


def main() -> None:
    sig = inspect.signature(ConfidenceProvider.__init__)
    assert "client_secret" in sig.parameters, sig

    assert hasattr(api, "set_provider_and_wait") and hasattr(api, "get_client")

    ctx = EvaluationContext(
        targeting_key="user-123", attributes={"country": "US", "plan": "premium"}
    )
    assert ctx.targeting_key == "user-123"
    assert ctx.attributes["plan"] == "premium"

    client = api.get_client()
    for method in (
        "get_boolean_value",
        "get_string_value",
        "get_integer_value",
        "get_float_value",
        "get_object_value",
    ):
        fn = getattr(client, method, None)
        assert callable(fn), method
        params = list(inspect.signature(fn).parameters)
        assert params[:3] == ["flag_key", "default_value", "evaluation_context"], (
            method,
            params,
        )

    print("ALL PYTHON LOCAL-RESOLVE API CHECKS PASSED")


if __name__ == "__main__":
    main()
