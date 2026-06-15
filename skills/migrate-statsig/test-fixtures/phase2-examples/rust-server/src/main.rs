// AFTER - migrated request handler (Confidence Rust LOCAL-resolve / in-process).
//
// Doc-verified against the Confidence Rust provider README
// (spotify-confidence-openfeature-provider-local). Not compiled here (no Rust
// toolchain in this environment).
//
// Transform points exercised:
//   - Flag keys -> Confidence struct dot-paths, normalized to [a-z0-9-]:
//       check_gate("new_checkout")                      -> "new-checkout.enabled"
//       get_dynamic_config("homepage_config").get_*(p)  -> "homepage-config.<p>"
//       get_experiment("checkout_button_experiment")    -> "checkout-button-experiment.<p>"
//   - Statsig getters -> OpenFeature async getters with unwrap_or default:
//       check_gate -> get_bool_value; get_string -> get_string_value;
//       get_f64 -> get_float_value (get_int_value for ints).
//   - Server SDK => evaluation context built PER CALL (StatsigUser -> EvaluationContext);
//     user_id -> targeting key; email/country/plan -> custom fields (omit None).
//   - statsig.initialize().await readiness removed -> set_provider (provider
//     fetches initial state on construction).

use open_feature::{EvaluationContext, OpenFeature};
use spotify_confidence_openfeature_provider_local::{ConfidenceProvider, ProviderOptions};

pub struct RequestUser {
    pub user_id: String,
    pub email: Option<String>,
    pub country: Option<String>,
    pub plan: Option<String>,
}

fn to_context(u: &RequestUser) -> EvaluationContext {
    // StatsigUser -> Confidence evaluation context; include only present attributes.
    let mut ctx = EvaluationContext::default().with_targeting_key(u.user_id.clone());
    if let Some(e) = &u.email {
        ctx = ctx.with_custom_field("email", e.clone());
    }
    if let Some(c) = &u.country {
        ctx = ctx.with_custom_field("country", c.clone());
    }
    if let Some(p) = &u.plan {
        ctx = ctx.with_custom_field("plan", p.clone());
    }
    ctx
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let options = ProviderOptions::new(&std::env::var("CONFIDENCE_FLAG_CLIENT_SECRET")?);
    let provider = ConfidenceProvider::new(options)?;
    OpenFeature::singleton_mut().await.set_provider(provider).await;
    let client = OpenFeature::singleton().await.create_client();

    let user = RequestUser {
        user_id: "user-123".to_string(),
        email: None,
        country: Some("US".to_string()),
        plan: Some("premium".to_string()),
    };
    let context = to_context(&user);

    let new_checkout = client
        .get_bool_value("new-checkout.enabled", Some(&context), None)
        .await
        .unwrap_or(false);
    let title = client
        .get_string_value("homepage-config.title", Some(&context), None)
        .await
        .unwrap_or_else(|_| "Welcome".to_string());
    let max_items = client
        .get_int_value("homepage-config.maxItems", Some(&context), None)
        .await
        .unwrap_or(10);
    let button_color = client
        .get_string_value("checkout-button-experiment.buttonColor", Some(&context), None)
        .await
        .unwrap_or_else(|_| "blue".to_string());

    println!("{new_checkout} {title} {max_items} {button_color}");
    Ok(())
}
