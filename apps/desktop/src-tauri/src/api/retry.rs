//! HTTP retry logic with exponential backoff for transient failures.

use std::time::Duration;

use crate::error::{AppError, AppResult};

/// Maximum number of retry attempts (total calls = MAX_RETRIES + 1).
const MAX_RETRIES: u32 = 3;

/// Base delay between retries. Actual delay = BASE * 2^attempt.
const BASE_DELAY: Duration = Duration::from_millis(500);

/// Determines whether an HTTP error is transient and worth retrying.
fn is_retryable(err: &reqwest::Error) -> bool {
    err.is_timeout()
        || err.is_connect()
        || err
            .status()
            .is_some_and(|s| s.is_server_error() || s == reqwest::StatusCode::TOO_MANY_REQUESTS)
}

/// Execute an async request function with exponential backoff retries.
///
/// Only retries on transient errors (timeout, connection, 5xx, 429).
/// Client errors (4xx except 429) are not retried.
pub async fn with_retry<F, Fut, T>(request_fn: F) -> AppResult<T>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = AppResult<T>>,
{
    let mut last_err = None;
    for attempt in 0..=MAX_RETRIES {
        match request_fn().await {
            Ok(result) => return Ok(result),
            Err(AppError::Http(e)) if attempt < MAX_RETRIES && is_retryable(&e) => {
                let delay = BASE_DELAY * 2u32.pow(attempt);
                tracing::warn!(
                    attempt = attempt + 1,
                    max = MAX_RETRIES,
                    delay_ms = delay.as_millis() as u64,
                    error = %e,
                    "HTTP request failed, retrying"
                );
                tokio::time::sleep(delay).await;
                last_err = Some(AppError::Http(e));
            }
            Err(e) => return Err(e),
        }
    }
    Err(last_err.unwrap_or_else(|| AppError::InvalidApiResponse("retry exhausted".into())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn succeeds_on_first_try() {
        let result = with_retry(|| async { Ok::<_, AppError>(42) }).await;
        assert_eq!(result.unwrap(), 42);
    }

    #[tokio::test]
    async fn retries_on_timeout_then_succeeds() {
        let attempt = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
        let attempt_clone = attempt.clone();
        let result = with_retry(move || {
            let a = attempt_clone.clone();
            async move {
                if a.fetch_add(1, std::sync::atomic::Ordering::Relaxed) == 0 {
                    Err(AppError::Http(
                        reqwest::Client::new()
                            .get("http://192.0.2.1:1") // non-routable → timeout
                            .timeout(Duration::from_millis(50))
                            .send()
                            .await
                            .unwrap_err(),
                    ))
                } else {
                    Ok(42)
                }
            }
        })
        .await;
        assert_eq!(result.unwrap(), 42);
    }

    #[tokio::test]
    async fn does_not_retry_on_client_error() {
        let result: AppResult<String> =
            with_retry(|| async { Err(AppError::InvalidApiResponse("bad request".into())) }).await;
        assert!(result.is_err());
    }
}
