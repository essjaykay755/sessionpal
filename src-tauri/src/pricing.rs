use std::sync::OnceLock;

use serde::Deserialize;

/// Published API list prices, USD per million tokens, used only for local
/// estimates. The catalog is the same file the frontend reads
/// (`src/lib/pricing-catalog.json`), so the two can never disagree.
const CATALOG_JSON: &str = include_str!("../../src/lib/pricing-catalog.json");

#[derive(Deserialize)]
struct Catalog {
    models: Vec<Price>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Price {
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

fn price_for(model: &str) -> Option<&'static Price> {
    let model = crate::util::normalize_model(model);
    prices().iter().find(|price| {
        model == price.id
            || model
                .strip_prefix(price.id.as_str())
                .and_then(|suffix| suffix.strip_prefix('-'))
                .is_some_and(|date| date.len() == 8 && date.bytes().all(|c| c.is_ascii_digit()))
    })
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

#[cfg(test)]
pub(crate) fn catalog_len() -> usize {
    prices().len()
}
