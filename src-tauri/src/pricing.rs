use std::sync::{OnceLock, RwLock};
use std::hash::{Hash, Hasher};

use serde::Deserialize;

/// Published API list prices, USD per million tokens, used only for local
/// estimates. The catalog is the same file the frontend reads
/// (`src/lib/pricing-catalog.json`), so the two can never disagree.
const CATALOG_JSON: &str = include_str!("../../src/lib/pricing-catalog.json");

#[derive(Deserialize)]
struct Catalog {
    models: Vec<Price>,
}

#[derive(Clone, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Price {
    id: String,
    input: f64,
    output: f64,
    cache_read: f64,
    cache_write: f64,
}

fn prices() -> &'static [Price] {
    static PRICES: OnceLock<Vec<Price>> = OnceLock::new();
    PRICES.get_or_init(|| {
        serde_json::from_str::<Catalog>(CATALOG_JSON)
            .map(|catalog| catalog.models)
            .expect("the bundled pricing catalog is valid JSON")
    })
}

fn dynamic_prices() -> &'static RwLock<Vec<Price>> {
    static DYNAMIC: OnceLock<RwLock<Vec<Price>>> = OnceLock::new();
    DYNAMIC.get_or_init(|| RwLock::new(Vec::new()))
}

pub fn set_dynamic(prices: Vec<Price>) -> Result<(), String> {
    if prices.len() > 50000 || prices.iter().any(|p| p.id.is_empty() || p.id.len() > 300 || [p.input, p.output, p.cache_read, p.cache_write].iter().any(|v| !v.is_finite() || *v < 0.0 || *v > 1_000_000.0)) {
        return Err("Invalid pricing catalog".into());
    }
    *dynamic_prices().write().map_err(|e| e.to_string())? = prices;
    Ok(())
}

pub fn revision() -> u64 {
    let prices = dynamic_prices().read().unwrap();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    if let Ok(data) = serde_json::to_vec(&*prices) { data.hash(&mut hasher); }
    hasher.finish()
}

fn price_for(model: &str) -> Option<Price> {
    let model = crate::util::normalize_model(model);
    let matches = |price: &&Price| {
        model == price.id
            || model
                .strip_prefix(price.id.as_str())
                .and_then(|suffix| suffix.strip_prefix('-'))
                .is_some_and(|date| date.len() == 8 && date.bytes().all(|c| c.is_ascii_digit()))
    };
    let dynamic = dynamic_prices().read().ok()?;
    dynamic.iter().find(|p| p.id == model).cloned()
        .or_else(|| prices().iter().find(|p| p.id == model).cloned())
        .or_else(|| dynamic.iter().find(matches).cloned())
        .or_else(|| prices().iter().find(matches).cloned())
}

/// Preserve the recorded model identifier; pricing must never rename a model.
pub fn canonical_model(model: &str) -> String {
    crate::util::normalize_model(model)
}

pub fn estimate(
    model: &str,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
) -> Option<f64> {
    let price = price_for(model)?;
    let cost = (input as f64 * price.input
        + output as f64 * price.output
        + cache_read as f64 * price.cache_read
        + cache_write as f64 * price.cache_write)
        / 1_000_000.0;
    Some(cost)
}

/// OpenCode's explicitly named free offering is distinct from its paid model.
pub fn estimate_opencode(
    model: &str,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
) -> Option<f64> {
    estimate(model, input, output, cache_read, cache_write)
}

#[cfg(test)]
pub(crate) fn catalog_len() -> usize {
    prices().len()
}
