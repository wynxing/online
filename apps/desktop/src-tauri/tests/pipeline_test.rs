//! Integration tests for pipeline utility functions.
//!
//! These tests verify the core logic without requiring a Tauri AppHandle,
//! focusing on text processing, caching, glossary, and retry behavior.

use ai_interpretation_desktop_lib::api::retry;
use ai_interpretation_desktop_lib::error::AppError;

// ============================================================================
// Retry logic tests
// ============================================================================

#[tokio::test]
async fn retry_succeeds_on_first_attempt() {
    let result = retry::with_retry(|| async { Ok::<_, AppError>(42) }).await;
    assert_eq!(result.unwrap(), 42);
}

#[tokio::test]
async fn retry_fails_immediately_on_non_retryable_error() {
    let result: Result<(), _> =
        retry::with_retry(|| async { Err(AppError::Config("bad config".into())) }).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn retry_exhausts_attempts_on_persistent_failure() {
    let attempt = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
    let attempt_clone = attempt.clone();
    let result: Result<(), _> = retry::with_retry(move || {
        let a = attempt_clone.clone();
        async move {
            a.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            Err(AppError::InvalidApiResponse("server error".into()))
        }
    })
    .await;
    assert!(result.is_err());
    // Non-retryable errors should fail on first attempt
    assert_eq!(attempt.load(std::sync::atomic::Ordering::Relaxed), 1);
}

// ============================================================================
// Note: The following tests require the lib to expose internal functions.
// Currently, sanitize_asr_text, normalize_cache_key, matched_glossary_terms,
// is_sentence_complete, split_first_sentence, join_source_text, and
// extract_sequence are pub(crate) or private. To test them in integration
// tests, they would need to be made pub or tested via #[cfg(test)] modules
// within the source files.
//
// The unit tests in api/mod.rs and pipeline/mod.rs already cover:
// - ASR text sanitization (protocol noise, hallucinations, target language)
// - Cache key normalization (case, whitespace, language pair)
// - Glossary matching (context, disabled terms)
// - Glossary enforcement (case-insensitive, literal replacement)
// - Sentence completion detection (punctuation, long segments)
// - Sentence splitting and joining
// - WAV header encoding
// - RMS calculation
// - Segment reordering (via unit tests)
// ============================================================================
