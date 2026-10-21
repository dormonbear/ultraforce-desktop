use sf_core::{CommandRunner, ProcessRunner, SfError};
use std::io::{ErrorKind, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::time::Duration;

// Run this same test executable as the direct child: no shell, Python, external
// CLI, or platform-specific process lookup is needed. Extra libtest filters carry
// only synthetic fixture arguments and match no additional tests.
// 使用当前测试可执行文件作为直接子进程，无需外部工具；附加测试筛选参数仅传递合成数据。
fn child_args(mode: &str) -> (String, Vec<String>) {
    (
        std::env::current_exe().unwrap().to_str().unwrap().into(),
        vec![
            "--exact".into(),
            "--ignored".into(),
            "--nocapture".into(),
            "cli_child_fixture".into(),
            mode.into(),
        ],
    )
}

#[test]
#[ignore = "bounded subprocess fixture, invoked explicitly below / 有界子进程夹具，由下方测试显式调用"]
fn cli_child_fixture() {
    for flag in [
        "SF_DISABLE_TELEMETRY",
        "SFDX_DISABLE_TELEMETRY",
        "SF_DISABLE_LOG_FILE",
        "SFDX_DISABLE_LOG_FILE",
    ] {
        assert_eq!(std::env::var(flag).as_deref(), Ok("true"), "{flag}");
    }
    let args: Vec<_> = std::env::args().collect();
    if let Some(address) = args.iter().find_map(|arg| arg.parse::<SocketAddr>().ok()) {
        assert!(address.ip().is_loopback());
        let mut socket = TcpStream::connect(address).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        socket.write_all(b"R").unwrap();
        // Even a failing RED test cannot leave this child running indefinitely.
        // 即使回归测试失败，也不会让子进程无限存活。
        let _ = socket.read(&mut [0]);
    }
    println!("synthetic-stdout");
    eprintln!("synthetic-stderr");
    if args.iter().any(|arg| arg == "fixture-nonzero") {
        std::process::exit(17);
    }
}

fn listener() -> TcpListener {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
    listener.set_nonblocking(true).unwrap();
    listener
}

async fn started(listener: &TcpListener) -> TcpStream {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match listener.accept() {
                Ok((mut socket, _)) => {
                    socket
                        .set_read_timeout(Some(Duration::from_secs(1)))
                        .unwrap();
                    let mut ready = [0];
                    socket.read_exact(&mut ready).unwrap();
                    assert_eq!(&ready, b"R");
                    socket.set_nonblocking(true).unwrap();
                    return socket;
                }
                Err(e) if e.kind() == ErrorKind::WouldBlock => {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
                Err(e) => panic!("fixture accept failed: {e}"),
            }
        }
    })
    .await
    .expect("direct child must demonstrably start before cancellation")
}

async fn closed(socket: &mut TcpStream) -> bool {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            match socket.read(&mut [0]) {
                Ok(0) => return,
                Err(e) if e.kind() == ErrorKind::ConnectionReset => return,
                Err(e) if e.kind() == ErrorKind::WouldBlock => {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
                result => panic!("unexpected fixture socket result: {result:?}"),
            }
        }
    })
    .await
    .is_ok()
}

async fn assert_terminated(mut socket: TcpStream) {
    let terminated = closed(&mut socket).await;
    if !terminated {
        // Clean up the original implementation's leaked child BEFORE asserting.
        // 断言前先清理原实现泄漏的子进程。
        socket.write_all(b"X").unwrap();
        assert!(closed(&mut socket).await, "fixture cleanup must finish");
    }
    assert!(
        terminated,
        "owned direct child survived timeout/cancellation"
    );
}

#[tokio::test]
async fn timeout_terminates_started_direct_child() {
    let listener = listener();
    let (program, args) = child_args(&listener.local_addr().unwrap().to_string());
    let timeout = Duration::from_secs(2);
    let task = tokio::spawn(async move { ProcessRunner.run(&program, &args, timeout).await });
    let socket = started(&listener).await;
    let result = task.await.unwrap();
    assert!(matches!(result, Err(SfError::Timeout(d)) if d == timeout));
    assert_terminated(socket).await;
}

#[tokio::test]
async fn cancelling_run_terminates_started_direct_child() {
    let listener = listener();
    let (program, args) = child_args(&listener.local_addr().unwrap().to_string());
    let task = tokio::spawn(async move {
        ProcessRunner
            .run(&program, &args, Duration::from_secs(30))
            .await
    });
    let socket = started(&listener).await;
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert_terminated(socket).await;
}

#[tokio::test]
async fn completion_preserves_output_status_and_privacy_flags() {
    for (mode, status) in [("fixture-success", 0), ("fixture-nonzero", 17)] {
        let (program, args) = child_args(mode);
        let out = ProcessRunner
            .run(&program, &args, Duration::from_secs(5))
            .await
            .unwrap();
        assert_eq!(out.status, status);
        assert!(out.stdout.contains("synthetic-stdout"));
        assert!(out.stderr.contains("synthetic-stderr"));
    }
}
