// BEFORE - original Statsig usage (Statsig Rust server SDK, `statsig` crate).
//
// Migration INPUT. Lives outside src/ so Cargo never builds it (Statsig deps
// aren't in Cargo.toml); kept for the before/after diff.
//
// Resolve mode: Statsig server SDK = in-process eval. Target: Confidence Rust
// local-resolve = in-process too -> NO resolve-mode change.

use std::collections::HashMap;
use statsig::{Statsig, StatsigOptions, StatsigUser};

pub struct RequestUser {
    pub user_id: String,
    pub email: Option<String>,
    pub country: Option<String>,
    pub plan: Option<String>,
}

pub async fn handle_request(req: &RequestUser) -> (bool, String, f64, String) {
    let statsig = Statsig::new(
        &std::env::var("STATSIG_SERVER_SECRET").unwrap(),
        StatsigOptions::default(),
    );
    statsig.initialize().await.unwrap();

    let mut custom = HashMap::new();
    if let Some(c) = &req.country {
        custom.insert("country".to_string(), c.clone());
    }
    if let Some(p) = &req.plan {
        custom.insert("plan".to_string(), p.clone());
    }
    let user = StatsigUser::with_user_id(req.user_id.clone())
        .with_email(req.email.clone())
        .with_custom(Some(custom));

    // Boolean feature gate.
    let new_checkout = statsig.check_gate(&user, "new_checkout");

    // Dynamic config - typed parameter reads with defaults.
    let homepage = statsig.get_dynamic_config(&user, "homepage_config");
    let title = homepage.get_string("title".to_string(), "Welcome".to_string());
    let max_items = homepage.get_f64("maxItems".to_string(), 10.0);

    // Experiment - typed parameter read with default.
    let experiment = statsig.get_experiment(&user, "checkout_button_experiment");
    let button_color = experiment.get_string("buttonColor".to_string(), "blue".to_string());

    (new_checkout, title, max_items, button_color)
}
