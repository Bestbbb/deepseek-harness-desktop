//! Supervision for the bundled Node Harness runtime.

use std::{
    io::{BufRead, BufReader},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc},
    thread,
    time::{Duration, Instant},
};
use url::Url;

const SHUTDOWN_GRACE: Duration = Duration::from_secs(3);
const RESTART_DELAY: Duration = Duration::from_millis(500);
const POLL_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Clone)]
pub struct RuntimeConfig {
    pub node: PathBuf,
    pub entry: PathBuf,
    pub patch: PathBuf,
    pub working_directory: PathBuf,
    pub desktop_native_entry: PathBuf,
    pub dsh_home: PathBuf,
    pub bridge_url: String,
    pub bridge_token: String,
}

pub enum RuntimeEvent {
    Ready(Url),
    Error(String),
    Log(String),
}

enum SupervisorCommand {
    Shutdown(mpsc::Sender<()>),
}

pub struct RuntimeSupervisor {
    commands: mpsc::Sender<SupervisorCommand>,
    join: Option<thread::JoinHandle<()>>,
}

impl RuntimeSupervisor {
    pub fn start(
        config: RuntimeConfig,
        publish: Arc<dyn Fn(RuntimeEvent) + Send + Sync + 'static>,
    ) -> Self {
        let (commands, receiver) = mpsc::channel();
        let join = thread::spawn(move || supervise(config, receiver, publish));
        Self {
            commands,
            join: Some(join),
        }
    }

    pub fn shutdown(&mut self) {
        let (settled, receiver) = mpsc::channel();
        if self
            .commands
            .send(SupervisorCommand::Shutdown(settled))
            .is_ok()
        {
            let _ = receiver.recv_timeout(SHUTDOWN_GRACE + Duration::from_secs(2));
        }
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

impl Drop for RuntimeSupervisor {
    fn drop(&mut self) {
        self.shutdown();
    }
}

enum OutputEvent {
    Stdout(String),
    Stderr(String),
}

fn supervise(
    config: RuntimeConfig,
    commands: mpsc::Receiver<SupervisorCommand>,
    publish: Arc<dyn Fn(RuntimeEvent) + Send + Sync + 'static>,
) {
    let mut stable_port: Option<u16> = None;
    loop {
        let port = stable_port.unwrap_or(0);
        let (mut child, output) = match spawn_runtime(&config, port) {
            Ok(value) => value,
            Err(error) => {
                publish(RuntimeEvent::Error(error));
                if wait_for_restart_or_shutdown(&commands) {
                    return;
                }
                continue;
            }
        };
        let mut ready = false;
        let mut pending_url = None;
        let mut shutdown_reply = None;
        let mut channel_disconnected = false;
        loop {
            match commands.try_recv() {
                Ok(SupervisorCommand::Shutdown(reply)) => {
                    shutdown_reply = Some(reply);
                    break;
                }
                Err(mpsc::TryRecvError::Disconnected) => {
                    channel_disconnected = true;
                    break;
                }
                Err(mpsc::TryRecvError::Empty) => {}
            }
            while let Ok(event) = output.try_recv() {
                match event {
                    OutputEvent::Stdout(line) => {
                        publish(RuntimeEvent::Log(super::diagnostics::redact(&line, None)));
                        if let Some(url) = parse_readiness(&line) {
                            stable_port = url.port();
                            pending_url = Some(url);
                        }
                    }
                    OutputEvent::Stderr(line) => {
                        publish(RuntimeEvent::Log(super::diagnostics::redact(&line, None)))
                    }
                }
            }
            if !ready && pending_url.as_ref().is_some_and(listener_open) {
                ready = true;
                if let Some(url) = pending_url.take() {
                    publish(RuntimeEvent::Ready(url));
                }
            }
            match child.child.try_wait() {
                Ok(Some(status)) => {
                    if !ready {
                        publish(RuntimeEvent::Error(format!(
                            "The Harness runtime exited before it became ready ({status}).",
                        )));
                    }
                    break;
                }
                Ok(None) => thread::sleep(POLL_INTERVAL),
                Err(error) => {
                    publish(RuntimeEvent::Error(format!(
                        "Could not inspect the Harness runtime: {error}"
                    )));
                    break;
                }
            }
        }
        if let Some(reply) = shutdown_reply {
            child.terminate();
            let _ = reply.send(());
            return;
        }
        child.terminate();
        if channel_disconnected {
            return;
        }
        if wait_for_restart_or_shutdown(&commands) {
            return;
        }
    }
}

fn listener_open(url: &Url) -> bool {
    let Some(port) = url.port() else { return false };
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    TcpStream::connect_timeout(&address, Duration::from_millis(20)).is_ok()
}

fn wait_for_restart_or_shutdown(commands: &mpsc::Receiver<SupervisorCommand>) -> bool {
    match commands.recv_timeout(RESTART_DELAY) {
        Ok(SupervisorCommand::Shutdown(reply)) => {
            let _ = reply.send(());
            true
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => true,
        Err(mpsc::RecvTimeoutError::Timeout) => false,
    }
}

fn spawn_runtime(
    config: &RuntimeConfig,
    port: u16,
) -> Result<(ManagedChild, mpsc::Receiver<OutputEvent>), String> {
    let patch = materialize_patch(config)?;
    let mut command = Command::new(&config.node);
    command
        .arg(&config.entry)
        .arg("web")
        .arg("--patch")
        .arg(patch)
        .arg("--port")
        .arg(port.to_string())
        .arg("--no-open")
        .current_dir(&config.working_directory)
        .env("DSH_HOME", &config.dsh_home)
        .env("DSH_DESKTOP_BRIDGE_URL", &config.bridge_url)
        .env("DSH_DESKTOP_BRIDGE_TOKEN", &config.bridge_token)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    let mut child = command.spawn().map_err(|error| {
        format!(
            "Could not start the bundled Harness runtime at {}: {error}",
            config.node.display()
        )
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Harness runtime stdout was not captured".to_owned())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Harness runtime stderr was not captured".to_owned())?;
    let (sender, receiver) = mpsc::channel();
    pump_lines(stdout, sender.clone(), OutputEvent::Stdout);
    pump_lines(stderr, sender, OutputEvent::Stderr);
    Ok((ManagedChild::new(child)?, receiver))
}

fn materialize_patch(config: &RuntimeConfig) -> Result<PathBuf, String> {
    let template = std::fs::read_to_string(&config.patch).map_err(|error| {
        format!(
            "Could not read desktop runtime patch {}: {error}",
            config.patch.display()
        )
    })?;
    let entries = [("__DSH_DESKTOP_NATIVE_ENTRY__", &config.desktop_native_entry)];
    let mut rendered = template;
    for (placeholder, path) in entries {
        let absolute = path.canonicalize().map_err(|error| {
            format!(
                "Could not resolve desktop module {}: {error}",
                path.display()
            )
        })?;
        let module_url = module_file_url(&absolute)?;
        let yaml_string = serde_json::to_string(module_url.as_str())
            .map_err(|error| format!("Could not encode desktop module path: {error}"))?;
        rendered = rendered.replace(placeholder, &yaml_string);
    }
    let output = config.dsh_home.join("desktop.cordis.yml");
    std::fs::write(&output, rendered).map_err(|error| {
        format!(
            "Could not write desktop runtime patch {}: {error}",
            output.display()
        )
    })?;
    Ok(output)
}

fn module_file_url(path: &Path) -> Result<Url, String> {
    Url::from_file_path(path).map_err(|_| {
        format!(
            "Could not encode desktop module {} as a file URL",
            path.display()
        )
    })
}

fn pump_lines<R, F>(reader: R, sender: mpsc::Sender<OutputEvent>, wrap: F)
where
    R: std::io::Read + Send + 'static,
    F: Fn(String) -> OutputEvent + Send + 'static,
{
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if sender.send(wrap(line)).is_err() {
                break;
            }
        }
    });
}

pub fn parse_readiness(line: &str) -> Option<Url> {
    let raw = line.strip_prefix("dsh web: ")?.split_whitespace().next()?;
    let url = Url::parse(raw).ok()?;
    if url.scheme() != "http" || url.host_str()? != "127.0.0.1" || url.port().is_none() {
        return None;
    }
    Some(url)
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(windows)]
fn configure_process_group(_command: &mut Command) {}

struct ManagedChild {
    child: Child,
    #[cfg(windows)]
    job: windows_sys::Win32::Foundation::HANDLE,
}

impl ManagedChild {
    fn new(child: Child) -> Result<Self, String> {
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::{
                Foundation::CloseHandle,
                System::JobObjects::{
                    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                },
            };
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return Err("Could not create the Windows runtime Job Object".to_owned());
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let configured = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                let assigned = configured != 0
                    && AssignProcessToJobObject(job, child.as_raw_handle() as _) != 0;
                if !assigned {
                    CloseHandle(job);
                    return Err(
                        "Could not assign the Harness runtime to its Windows Job Object".to_owned(),
                    );
                }
                return Ok(Self { child, job });
            }
        }
        #[cfg(not(windows))]
        Ok(Self { child })
    }

    #[cfg(unix)]
    fn terminate(&mut self) {
        let process_group = self.child.id() as i32;
        unsafe {
            libc::kill(-process_group, libc::SIGTERM);
        }
        let deadline = Instant::now() + SHUTDOWN_GRACE;
        while Instant::now() < deadline {
            let _ = self.child.try_wait();
            if !process_group_alive(process_group) {
                return;
            }
            thread::sleep(POLL_INTERVAL);
        }
        unsafe {
            libc::kill(-process_group, libc::SIGKILL);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }

    #[cfg(windows)]
    fn terminate(&mut self) {
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.job, 1);
        }
        let deadline = Instant::now() + SHUTDOWN_GRACE;
        while Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(POLL_INTERVAL);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(unix)]
fn process_group_alive(process_group: i32) -> bool {
    unsafe { libc::kill(-process_group, 0) == 0 }
}

#[cfg(windows)]
impl Drop for ManagedChild {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.job);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{module_file_url, parse_readiness};

    #[cfg(unix)]
    use super::{configure_process_group, ManagedChild};

    #[cfg(unix)]
    use std::{process::Command, thread, time::Duration};

    #[test]
    fn accepts_the_exact_loopback_readiness_line() {
        let url = parse_readiness("dsh web: http://127.0.0.1:43123").expect("readiness URL");
        assert_eq!(url.port(), Some(43123));
    }

    #[test]
    fn rejects_non_loopback_and_unrelated_output() {
        assert!(parse_readiness("dsh web: http://localhost:43123").is_none());
        assert!(parse_readiness("listening on http://127.0.0.1:43123").is_none());
    }

    #[test]
    fn encodes_desktop_modules_as_file_urls() {
        let module = std::env::current_dir()
            .expect("current directory")
            .join("desktop-native.js");
        let url = module_file_url(&module).expect("module file URL");

        assert_eq!(url.scheme(), "file");
        assert_eq!(url.to_file_path().expect("file URL path"), module);
        #[cfg(windows)]
        assert!(url.as_str().starts_with("file:///"));
    }

    #[cfg(unix)]
    #[test]
    fn terminates_the_managed_process_group() {
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 30 & wait"]);
        configure_process_group(&mut command);
        let child = command.spawn().expect("spawn process group");
        let process_group = child.id() as i32;
        let mut managed = ManagedChild::new(child).expect("manage child");

        managed.terminate();
        thread::sleep(Duration::from_millis(50));

        let alive = unsafe { libc::kill(-process_group, 0) } == 0;
        assert!(!alive, "managed process group survived termination");
    }

    #[cfg(unix)]
    #[test]
    fn terminates_descendants_after_the_group_leader_exits() {
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 30 & exit 0"]);
        configure_process_group(&mut command);
        let mut child = command.spawn().expect("spawn process group");
        let process_group = child.id() as i32;
        child.wait().expect("wait for group leader");
        assert!(
            unsafe { libc::kill(-process_group, 0) } == 0,
            "fixture descendant did not survive its group leader"
        );
        let mut managed = ManagedChild::new(child).expect("manage exited leader");

        managed.terminate();
        thread::sleep(Duration::from_millis(50));

        let alive = unsafe { libc::kill(-process_group, 0) } == 0;
        assert!(!alive, "descendant survived after its group leader exited");
    }
}
