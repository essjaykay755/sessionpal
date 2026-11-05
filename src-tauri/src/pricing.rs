struct Price {
    id: &'static str,
    input: f64,
    output: f64,
    cache_read: f64,
    cache_write: f64,
}

/// Published API list prices, USD per million tokens.
/// These values mirror `src/lib/pricing.ts` and are used only for local estimates.
// Standard, short-context API rates. Cache writes assume the shortest standard TTL.
// Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
// OpenAI: https://developers.openai.com/api/docs/pricing
const PRICES: [Price; 17] = [
    Price { id: "claude-opus-5-5", input: 4.0, output: 20.0, cache_read: 0.2, cache_write: 5.0 },
    Price { id: "claude-sonnet-5-5", input: 2.0, output: 10.0, cache_read: 0.1, cache_write: 2.5 },
    Price { id: "gpt-6.1-sol", input: 2.0, output: 10.0, cache_read: 0.1, cache_write: 2.5 },
    Price { id: "gpt-6.1-terra", input: 1.0, output: 5.0, cache_read: 0.05, cache_write: 1.25 },
    Price { id: "gpt-6-luna", input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125 },
    Price { id: "gpt-6-astra", input: 10.0, output: 50.0, cache_read: 1.0, cache_write: 12.5 },
    Price { id: "gpt-6-sol", input: 2.0, output: 10.0, cache_read: 0.2, cache_write: 2.5 },
    Price {
        id: "claude-opus-4-5",
        input: 5.0,
        output: 25.0,
        cache_read: 0.5,
        cache_write: 6.25,
    },
    Price {
        id: "claude-sonnet-4-5",
        input: 3.0,
        output: 15.0,
        cache_read: 0.3,
        cache_write: 3.75,
    },
    Price {
        id: "claude-haiku-4-5",
        input: 1.0,
        output: 5.0,
        cache_read: 0.1,
        cache_write: 1.25,
    },
    Price {
        id: "gpt-5.1-codex",
        input: 1.25,
        output: 10.0,
        cache_read: 0.125,
        cache_write: 1.25,
    },
    Price {
        id: "gpt-5.1-codex-mini",
        input: 0.25,
        output: 2.0,
        cache_read: 0.025,
        cache_write: 0.25,
    },
    Price {
        id: "gpt-5.1",
        input: 1.25,
        output: 10.0,
        cache_read: 0.125,
        cache_write: 1.25,
    },
    Price {
        id: "composer-1",
        input: 0.5,
        output: 2.5,
        cache_read: 0.05,
        cache_write: 0.5,
    },
    Price {
        id: "claude-4.5-sonnet",
        input: 3.0,
        output: 15.0,
        cache_read: 0.3,
        cache_write: 3.75,
    },
    Price {
        id: "kimi-k2",
        input: 0.6,
        output: 2.5,
        cache_read: 0.15,
        cache_write: 0.6,
    },
    Price {
        id: "qwen3-coder",
        input: 0.3,
        output: 1.2,
        cache_read: 0.03,
        cache_write: 0.3,
    },
];

fn price_for(model: &str) -> Option<&'static Price> {
    let model = crate::util::normalize_model(model);
    PRICES.iter().find(|price| {
        model == price.id || model.strip_prefix(price.id)
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
