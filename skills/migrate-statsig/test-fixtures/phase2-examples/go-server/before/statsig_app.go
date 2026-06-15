//go:build ignore

// BEFORE - original Statsig usage (Statsig Go server SDK, github.com/statsig-io/go-sdk).
//
// Migration INPUT. The //go:build ignore tag keeps it out of `go build ./...`
// (Statsig deps aren't in go.mod); kept for the before/after diff.
//
// Resolve mode: Statsig server SDK = in-process eval. Target: Confidence Go
// local-resolve = in-process too -> NO resolve-mode change.

package main

import (
	"os"

	"github.com/statsig-io/go-sdk"
)

type RequestUser struct {
	UserID  string
	Email   string
	Country string
	Plan    string
}

func handleRequest(req RequestUser) (bool, string, float64, string) {
	statsig.Initialize(os.Getenv("STATSIG_SERVER_SECRET"))
	defer statsig.Shutdown()

	user := statsig.User{
		UserID: req.UserID,
		Email:  req.Email,
		Custom: map[string]interface{}{"country": req.Country, "plan": req.Plan},
	}

	// Boolean feature gate.
	newCheckout := statsig.CheckGate(user, "new_checkout")

	// Dynamic config - typed parameter reads with defaults.
	homepage := statsig.GetConfig(user, "homepage_config")
	title := homepage.GetString("title", "Welcome")
	maxItems := homepage.GetNumber("maxItems", 10)

	// Experiment - typed parameter read with default.
	experiment := statsig.GetExperiment(user, "checkout_button_experiment")
	buttonColor := experiment.GetString("buttonColor", "blue")

	return newCheckout, title, maxItems, buttonColor
}
