//! Synthetic executable forwarding argv without a command shell. / 无命令外壳、直接转发参数的合成可执行程序。
#![cfg_attr(windows, windows_subsystem = "windows")]

use std::{env, process::Command};

fn main() {
    let python = env::var_os("UF_NATIVE_PYTHON").expect("Missing fixture Python / 缺少夹具 Python");
    let script = env::current_exe()
        .expect("Missing fixture executable / 缺少夹具可执行程序")
        .with_file_name("sf_fixture.py");
    let mut command = Command::new(python);
    command.arg(script).args(env::args_os().skip(1));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let status = command
        .status()
        .expect("Fixture Python failed / 夹具 Python 启动失败");
    std::process::exit(status.code().unwrap_or(1));
}
