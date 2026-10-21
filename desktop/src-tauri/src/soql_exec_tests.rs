//! Synthetic cancellation regressions. / 合成取消回归测试。

use super::*;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

struct PendingAuth {
    entered: Arc<tokio::sync::Notify>,
    dropped: Arc<AtomicBool>,
}

struct DropSignal(Arc<AtomicBool>);

impl Drop for DropSignal {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

#[async_trait::async_trait]
impl sf_core::CommandRunner for PendingAuth {
    async fn run(
        &self,
        program: &str,
        args: &[String],
        _timeout: Duration,
    ) -> Result<sf_core::RawOutput, sf_core::SfError> {
        assert_eq!(program, "sf");
        assert_eq!(&args[..2], &["org", "display"]);
        let _signal = DropSignal(self.dropped.clone());
        self.entered.notify_one();
        std::future::pending().await
    }
}

fn state(runner: Arc<dyn sf_core::CommandRunner>) -> AppState {
    AppState {
        invoker: sf_core::SfInvoker::new(runner),
        selected_org: Default::default(),
        index: crate::index_coordinator::IndexCoordinator::new(),
        apex: features::apex_complete::ApexCompleter::new(
            std::env::temp_dir().join("uf-unused-soql-test-cache"),
        ),
        query_cancels: Default::default(),
        auth_cache: Default::default(),
        log_cache: Default::default(),
    }
}

#[tokio::test]
async fn cancel_during_expired_session_refresh_drops_auth_fetch() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    listener.set_nonblocking(true).unwrap();
    let server = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(Instant::now() < deadline);
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(error) => panic!("{error}"),
            }
        };
        stream.set_nonblocking(false).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            assert_eq!(stream.read(&mut byte).unwrap(), 1);
            request.push(byte[0]);
            assert!(request.len() < 8192);
        }
        let body = r#"[{"errorCode":"INVALID_SESSION_ID","message":"Synthetic expired session / 合成过期会话"}]"#;
        write!(
            stream,
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
    });
    let entered = Arc::new(tokio::sync::Notify::new());
    let dropped = Arc::new(AtomicBool::new(false));
    let state = state(Arc::new(PendingAuth {
        entered: entered.clone(),
        dropped: dropped.clone(),
    }));
    state.auth_cache.lock().unwrap().insert(
        "synthetic".into(),
        sf_core::AuthInfo {
            instance_url: format!("http://{address}"),
            access_token: "synthetic-expired-token".into(),
            api_version: Some("60.0".into()),
        },
    );
    let query = count_soql(
        "SELECT Id FROM Account".into(),
        None,
        "synthetic-query".into(),
        Some("synthetic".into()),
        &state,
    );
    tokio::pin!(query);
    tokio::select! {
        _ = &mut query => panic!("Refresh must remain pending / 刷新应保持等待"),
        result = tokio::time::timeout(Duration::from_secs(5), entered.notified()) => result.unwrap(),
    }
    cancel_soql("synthetic-query", &state);
    assert!(state.query_cancels.lock().unwrap()["synthetic-query"].load(Ordering::Relaxed));
    let result = tokio::time::timeout(Duration::from_millis(500), query).await;
    server.join().unwrap();
    let result = result
        .expect("Cancellation must interrupt token refresh / 取消须中断令牌刷新")
        .unwrap();
    assert!(result.is_none());
    assert!(state.query_cancels.lock().unwrap().is_empty());
    assert!(dropped.load(Ordering::SeqCst));
    assert!(!state.auth_cache.lock().unwrap().contains_key("synthetic"));
}

#[tokio::test]
async fn cancel_during_initial_auth_drops_fetch_and_clears_registry() {
    let entered = Arc::new(tokio::sync::Notify::new());
    let dropped = Arc::new(AtomicBool::new(false));
    let state = state(Arc::new(PendingAuth {
        entered: entered.clone(),
        dropped: dropped.clone(),
    }));
    let query = count_soql(
        "SELECT Id FROM Account".into(),
        None,
        "synthetic-query".into(),
        Some("synthetic".into()),
        &state,
    );
    tokio::pin!(query);
    tokio::select! {
        _ = &mut query => panic!("Fetch must remain pending / 获取应保持等待"),
        result = tokio::time::timeout(Duration::from_secs(5), entered.notified()) => result.unwrap(),
    }
    cancel_soql("synthetic-query", &state);
    let result = tokio::time::timeout(Duration::from_millis(500), query)
        .await
        .expect("Cancellation must interrupt initial auth / 取消须中断首次认证")
        .unwrap();
    assert!(result.is_none());
    assert!(dropped.load(Ordering::SeqCst));
    assert!(state.query_cancels.lock().unwrap().is_empty());
    assert!(state.auth_cache.lock().unwrap().is_empty());
}
