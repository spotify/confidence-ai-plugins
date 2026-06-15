// AFTER - migrated request handler (Confidence Go LOCAL-resolve / in-process).
//
// Doc-verified against the Confidence Go provider README
// (github.com/spotify/confidence-resolver/openfeature-provider/go). Not compiled
// here (no Go toolchain in this environment).
//
// Transform points exercised:
//   - Flag keys -> Confidence struct dot-paths, normalized to [a-z0-9-]:
//       CheckGate("new_checkout")                     -> "new-checkout.enabled"
//       GetConfig("homepage_config").GetString(p,d)   -> "homepage-config.<p>"
//       GetExperiment("checkout_button_experiment")   -> "checkout-button-experiment.<p>"
//   - Statsig typed getters -> OpenFeature typed getters (Go: PascalCase,
//     ctx-FIRST, context-LAST): GetString -> StringValue, GetNumber -> IntValue
//     or FloatValue, CheckGate -> BooleanValue.
//   - Server SDK => evaluation context built PER CALL (statsig.User -> evalCtx);
//     UserID -> targeting key; email/country/plan -> attributes (omit empties).
//   - statsig.Initialize() readiness removed -> openfeature.SetProviderAndWait.

package main

import (
	"context"
	"log"
	"os"

	"github.com/open-feature/go-sdk/openfeature"
	"github.com/spotify/confidence-resolver/openfeature-provider/go/confidence"
)

type RequestUser struct {
	UserID  string
	Email   string
	Country string
	Plan    string
}

var client *openfeature.Client

func setup(ctx context.Context) error {
	provider, err := confidence.NewProvider(ctx, confidence.ProviderConfig{
		ClientSecret: os.Getenv("CONFIDENCE_FLAG_CLIENT_SECRET"),
	})
	if err != nil {
		return err
	}
	openfeature.SetProviderAndWait(provider)
	client = openfeature.NewClient("my-app")
	return nil
}

func toContext(u RequestUser) openfeature.EvaluationContext {
	// statsig.User -> Confidence evaluation context; include only present attributes.
	// IMPORTANT: set the Phase 1 ENTITY FIELD (here "user_id") — that is the field
	// the migrated targeting rules bucket by. The targeting key alone is NOT
	// aliased to it by the local resolver, so a context with only the targeting
	// key resolves to DEFAULT. (Verified end-to-end against a real project.)
	attrs := map[string]interface{}{"user_id": u.UserID}
	if u.Email != "" {
		attrs["email"] = u.Email
	}
	if u.Country != "" {
		attrs["country"] = u.Country
	}
	if u.Plan != "" {
		attrs["plan"] = u.Plan
	}
	return openfeature.NewEvaluationContext(u.UserID, attrs)
}

func handleRequest(ctx context.Context, u RequestUser) (bool, string, int64, string) {
	evalCtx := toContext(u)

	newCheckout, _ := client.BooleanValue(ctx, "new-checkout.enabled", false, evalCtx)
	title, _ := client.StringValue(ctx, "homepage-config.title", "Welcome", evalCtx)
	maxItems, _ := client.IntValue(ctx, "homepage-config.maxItems", 10, evalCtx)
	buttonColor, _ := client.StringValue(ctx, "checkout-button-experiment.buttonColor", "blue", evalCtx)

	return newCheckout, title, maxItems, buttonColor
}

func main() {
	ctx := context.Background()
	if err := setup(ctx); err != nil {
		log.Fatalf("setup failed: %v", err)
	}
	defer openfeature.Shutdown()

	log.Println(handleRequest(ctx, RequestUser{UserID: "user-123", Country: "US", Plan: "premium"}))
}
