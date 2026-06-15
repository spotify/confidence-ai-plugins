"""AFTER - migrated Confidence setup (Python LOCAL-resolve / in-process).

Uses the Confidence local-resolve OpenFeature provider
(`confidence-openfeature-provider`, from spotify/confidence-resolver), which
evaluates locally via WASM. `set_provider_and_wait` blocks until the initial
resolver state is fetched, replacing Statsig's `statsig.initialize(secret)`.
"""

import os

from openfeature import api
from confidence import ConfidenceProvider

_client = None


def get_client():
    global _client
    if _client is None:
        provider = ConfidenceProvider(
            client_secret=os.environ["CONFIDENCE_FLAG_CLIENT_SECRET"]
        )
        api.set_provider_and_wait(provider)
        _client = api.get_client()
    return _client
