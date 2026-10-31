use app_v2_lib::translator::{MultiTierPipeline, TranslationResult};
use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;

/// Drain the complete JSON request before closing a mock response. Closing a
/// socket with an unread request body can reset the connection on Windows and
/// make an intended HTTP status test report a transport failure instead.
pub async fn read_http_request(socket: &mut TcpStream) -> std::io::Result<Vec<u8>> {
    let mut request = Vec::new();
    let mut buffer = [0u8; 4096];
    let header_end = loop {
        let count = socket.read(&mut buffer).await?;
        if count == 0 {
            return Err(std::io::ErrorKind::UnexpectedEof.into());
        }
        request.extend_from_slice(&buffer[..count]);
        if let Some(index) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
            break index + 4;
        }
        if request.len() > 64 * 1024 {
            return Err(std::io::ErrorKind::InvalidData.into());
        }
    };
    let headers = String::from_utf8_lossy(&request[..header_end]);
    let content_length = headers.lines().filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.trim().parse::<usize>().ok()).unwrap_or(0);
    if content_length > 1024 * 1024 {
        return Err(std::io::ErrorKind::InvalidData.into());
    }
    while request.len() < header_end + content_length {
        let count = socket.read(&mut buffer).await?;
        if count == 0 {
            return Err(std::io::ErrorKind::UnexpectedEof.into());
        }
        request.extend_from_slice(&buffer[..count]);
    }
    Ok(request)
}

/// Public online engines may be unreachable on a developer/CI machine. Their
/// final failure must remain explicit and retryable, never a cached translation.
pub fn assert_online_fallback_or_retry(pipeline: &MultiTierPipeline, result: &TranslationResult) {
    match result.source_tier.as_str() {
        "Online Fallback" | "Fallback API" | "多引擎竞速" => {
            assert!(!result.translated.trim().is_empty());
            assert_ne!(result.translated, result.original);
        }
        "翻译失败·点击重试" => {
            assert_eq!(result.translated, result.original);
            assert!(pipeline.cache.retrieve(&result.original).is_none());
        }
        tier => panic!("Unexpected fallback tier: {tier}"),
    }
}
