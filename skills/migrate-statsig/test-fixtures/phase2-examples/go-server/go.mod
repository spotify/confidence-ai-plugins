// Reference fixture (doc-verified, not built here). Versions illustrative;
// the Confidence Go local-resolve provider requires Go 1.24+ and the
// OpenFeature Go SDK 1.16.0+.
module example.com/statsig-to-confidence-go-server

go 1.24

require (
	github.com/open-feature/go-sdk v1.16.0
	github.com/spotify/confidence-resolver/openfeature-provider/go v0.0.0
)
