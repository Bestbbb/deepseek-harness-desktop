//! Native next-launch selection; Bundle preparation and trust remain Harness responsibilities.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

const STATE_FILE: &str = "desktop-profile-selection.json";
const MAX_STATE_BYTES: u64 = 64 * 1024;
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Candidate {
    pub profile: String,
    pub previous_profile: String,
    pub manifest_sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum FailureReason {
    Interrupted,
    StartupFailed,
    InvalidCandidate,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Failure {
    candidate: Candidate,
    reason: FailureReason,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Selection {
    schema_version: u32,
    pub active_profile: String,
    previous_profile: Option<String>,
    pending: Option<Candidate>,
    trial: Option<Candidate>,
    last_failure: Option<Failure>,
}

impl Default for Selection {
    fn default() -> Self {
        Self {
            schema_version: 1,
            active_profile: "web".into(),
            previous_profile: None,
            pending: None,
            trial: None,
            last_failure: None,
        }
    }
}

#[derive(Default)]
struct LaunchState {
    started: bool,
    // A failed write must be retried before another child can start.
    rejected: Option<String>,
}

/// One owner per single-instance desktop process. All mutations serialize through this owner.
pub(crate) struct ProfileControl {
    home: PathBuf,
    launch: Mutex<LaunchState>,
}

impl ProfileControl {
    pub fn new(home: PathBuf) -> Self {
        Self {
            home,
            launch: Mutex::new(LaunchState::default()),
        }
    }

    pub fn selection(&self) -> Result<Selection, String> {
        let _guard = self.launch.lock().map_err(|_| locked())?;
        self.read()
    }

    /// Queueing never stops a runtime. An identical pending request is safe to repeat.
    pub fn queue(&self, candidate: Candidate) -> Result<(), String> {
        let _guard = self.launch.lock().map_err(|_| locked())?;
        validate_candidate(&candidate)?;
        let mut state = self.read()?;
        if state.trial.is_some() || candidate.previous_profile != state.active_profile {
            return Err("Profile selection changed; refresh before queueing.".into());
        }
        if let Some(pending) = &state.pending {
            if pending != &candidate {
                return Err("Another Profile is already awaiting application restart.".into());
            }
        }
        self.check_candidate(&candidate)?;
        state.pending = Some(candidate);
        self.write(&state)
    }

    /// Cancel only the named pending selection; never remove Profile files.
    pub fn cancel(&self, profile: &str) -> Result<(), String> {
        let _guard = self.launch.lock().map_err(|_| locked())?;
        let mut state = self.read()?;
        if !state
            .pending
            .as_ref()
            .is_some_and(|entry| entry.profile == profile)
        {
            return Err("The requested Profile is not awaiting application restart.".into());
        }
        state.pending = None;
        self.write(&state)
    }

    /// Consume a queue only on this owner's first launch, never on Runtime Retry or crash recovery.
    pub fn launch_profile(&self) -> Result<String, String> {
        let mut launch = self.launch.lock().map_err(|_| locked())?;
        let mut state = self.read()?;
        if let Some(profile) = &launch.rejected {
            reject_trial(&mut state, profile, FailureReason::StartupFailed)?;
            self.write(&state)?;
            launch.rejected = None;
        }
        if !launch.started {
            let mut changed = false;
            if let Some(trial) = state.trial.take() {
                state.last_failure = Some(Failure {
                    candidate: trial,
                    reason: FailureReason::Interrupted,
                });
                changed = true;
            }
            if let Some(candidate) = state.pending.take() {
                if self.check_candidate(&candidate).is_ok() {
                    state.trial = Some(candidate);
                } else {
                    state.last_failure = Some(Failure {
                        candidate,
                        reason: FailureReason::InvalidCandidate,
                    });
                }
                changed = true;
            }
            if changed {
                self.write(&state)?;
            }
            launch.started = true;
        }
        Ok(state.trial.as_ref().map_or_else(
            || state.active_profile.clone(),
            |candidate| candidate.profile.clone(),
        ))
    }

    /// Called only after the matching child's launcher acknowledgement and listener readiness.
    pub fn commit(&self, profile: &str) -> Result<(), String> {
        let launch = self.launch.lock().map_err(|_| locked())?;
        if !launch.started || launch.rejected.is_some() {
            return Err("Profile startup is not eligible for confirmation.".into());
        }
        let mut state = self.read()?;
        if let Some(candidate) = state.trial.take() {
            if candidate.profile != profile {
                return Err(
                    "Profile startup confirmation does not match the current trial.".into(),
                );
            }
            self.check_candidate(&candidate)?;
            state.previous_profile = Some(state.active_profile);
            state.active_profile = candidate.profile;
            state.last_failure = None;
            self.write(&state)
        } else if state.active_profile == profile {
            Ok(())
        } else {
            Err("Profile startup confirmation does not match the active Profile.".into())
        }
    }

    /// Called after child termination. Failure to persist blocks the next launch until retried.
    pub fn reject(&self, profile: &str) -> Result<(), String> {
        let mut launch = self.launch.lock().map_err(|_| locked())?;
        launch.rejected = Some(profile.to_owned());
        let mut state = self.read()?;
        reject_trial(&mut state, profile, FailureReason::StartupFailed)?;
        self.write(&state)?;
        launch.rejected = None;
        Ok(())
    }

    fn read(&self) -> Result<Selection, String> {
        let bytes = match read_regular(&self.home.join(STATE_FILE), MAX_STATE_BYTES) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Selection::default());
            }
            Err(_) => {
                return Err(
                    "Could not read the desktop Profile selection; preserve it for recovery."
                        .into(),
                )
            }
        };
        let state: Selection = serde_json::from_slice(&bytes).map_err(|_| {
            "Desktop Profile selection is malformed; preserve it for recovery.".to_owned()
        })?;
        if state.schema_version != 1
            || !valid_profile(&state.active_profile)
            || state
                .previous_profile
                .as_ref()
                .is_some_and(|name| !valid_profile(name))
            || (state.pending.is_some() && state.trial.is_some())
        {
            return Err("Desktop Profile selection has unsupported or inconsistent fields.".into());
        }
        for candidate in [state.pending.as_ref(), state.trial.as_ref()]
            .into_iter()
            .flatten()
        {
            validate_candidate(candidate)?;
            if candidate.previous_profile != state.active_profile {
                return Err(
                    "Desktop Profile selection references a different active Profile.".into(),
                );
            }
        }
        if let Some(failure) = &state.last_failure {
            validate_candidate(&failure.candidate)?;
        }
        Ok(state)
    }

    fn write(&self, state: &Selection) -> Result<(), String> {
        let write = || -> Result<(), Box<dyn std::error::Error>> {
            let mut file = tempfile::NamedTempFile::new_in(&self.home)?;
            serde_json::to_writer(&mut file, state)?;
            file.write_all(b"\n")?;
            file.as_file().sync_all()?;
            file.persist(self.home.join(STATE_FILE))?;
            Ok(())
        };
        write().map_err(|_| {
            "Could not save desktop Profile selection; no new runtime is confirmed.".into()
        })
    }

    fn check_candidate(&self, candidate: &Candidate) -> Result<(), String> {
        let profiles = self.home.join("profiles");
        let directory = profiles.join(&candidate.profile);
        for path in [&profiles, &directory] {
            if !fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir() && !meta.is_symlink()) {
                return Err(
                    "Candidate Profile must be a real directory in the desktop home.".into(),
                );
            }
        }
        let bytes = read_regular(&directory.join("package.json"), MAX_MANIFEST_BYTES)
            .map_err(|_| "Candidate Profile manifest is missing or unreadable.".to_owned())?;
        let hash = format!("{:x}", Sha256::digest(&bytes));
        if hash != candidate.manifest_sha256 {
            return Err("Candidate Profile manifest changed after preparation.".into());
        }
        let manifest: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|_| "Candidate Profile manifest is malformed.".to_owned())?;
        if manifest
            .pointer("/dsh/profile/patchReload")
            .and_then(|value| value.as_str())
            != Some("startup")
        {
            return Err("Candidate Profile must use startup-only patch reload.".into());
        }
        Ok(())
    }
}

fn locked() -> String {
    "Desktop Profile selection is unavailable after an interrupted native operation.".into()
}

fn reject_trial(state: &mut Selection, profile: &str, reason: FailureReason) -> Result<(), String> {
    if let Some(candidate) = &state.trial {
        if candidate.profile != profile {
            return Err("Failed Profile does not match the current startup trial.".into());
        }
        state.last_failure = Some(Failure {
            candidate: candidate.clone(),
            reason,
        });
        state.trial = None;
    } else if state.active_profile != profile {
        return Err("Failed Profile does not match the active selection.".into());
    }
    Ok(())
}

fn valid_profile(name: &str) -> bool {
    name == "web" || valid_candidate_name(name)
}

fn valid_candidate_name(name: &str) -> bool {
    let Some(id) = name.strip_prefix("desktop-") else {
        return false;
    };
    id.len() == 36
        && id.bytes().enumerate().all(|(index, value)| match index {
            8 | 13 | 18 | 23 => value == b'-',
            14 => value == b'4',
            19 => matches!(value, b'8' | b'9' | b'a' | b'b'),
            _ => value.is_ascii_digit() || (b'a'..=b'f').contains(&value),
        })
}

fn validate_candidate(candidate: &Candidate) -> Result<(), String> {
    if !valid_candidate_name(&candidate.profile)
        || !valid_profile(&candidate.previous_profile)
        || candidate.profile == candidate.previous_profile
        || candidate.manifest_sha256.len() != 64
        || !candidate
            .manifest_sha256
            .bytes()
            .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value))
    {
        return Err(
            "Candidate requires a generated Profile name, distinct predecessor, and SHA-256."
                .into(),
        );
    }
    Ok(())
}

fn read_regular(path: &Path, limit: u64) -> std::io::Result<Vec<u8>> {
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_file() || meta.is_symlink() || meta.len() > limit {
        return Err(std::io::Error::other("Expected a bounded regular file"));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Err(std::io::Error::other("Expected a regular file"));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(std::io::Error::other("File exceeds its read limit"));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(home: &Path, suffix: u8) -> Candidate {
        let name = format!("desktop-00000000-0000-4000-8000-{suffix:012}");
        let directory = home.join("profiles").join(&name);
        fs::create_dir_all(&directory).unwrap();
        let manifest = br#"{"private":true,"dsh":{"profile":{"patchReload":"startup"}}}"#;
        fs::write(directory.join("package.json"), manifest).unwrap();
        Candidate {
            profile: name,
            previous_profile: "web".into(),
            manifest_sha256: format!("{:x}", Sha256::digest(manifest)),
        }
    }

    #[test]
    fn queue_waits_for_another_application_owner_and_commit_retains_the_predecessor() {
        let home = tempfile::tempdir().unwrap();
        let control = ProfileControl::new(home.path().into());
        assert_eq!(control.launch_profile().unwrap(), "web");
        let candidate = candidate(home.path(), 1);
        control.queue(candidate.clone()).unwrap();
        control.queue(candidate.clone()).unwrap();
        assert_eq!(control.launch_profile().unwrap(), "web");
        control.commit("web").unwrap();
        control.reject("web").unwrap();
        assert_eq!(control.launch_profile().unwrap(), "web");
        assert_eq!(
            control.selection().unwrap().pending,
            Some(candidate.clone())
        );
        drop(control);

        let next = ProfileControl::new(home.path().into());
        assert_eq!(next.launch_profile().unwrap(), candidate.profile);
        let before = next.selection().unwrap();
        assert_eq!(before.active_profile, "web");
        assert_eq!(before.trial, Some(candidate.clone()));
        assert!(before.pending.is_none());
        assert!(next.commit("web").is_err());
        next.commit(&candidate.profile).unwrap();
        let bytes = fs::read(home.path().join(STATE_FILE)).unwrap();
        let persisted: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(persisted["activeProfile"], candidate.profile);
        assert_eq!(persisted["previousProfile"], "web");
        assert_eq!(persisted["trial"], serde_json::Value::Null);
        next.reject(&candidate.profile).unwrap();
        assert_eq!(next.launch_profile().unwrap(), candidate.profile);
        drop(next);
        assert_eq!(
            ProfileControl::new(home.path().into())
                .launch_profile()
                .unwrap(),
            candidate.profile
        );
    }

    #[test]
    fn failed_trial_restores_selection_without_touching_profile_or_session_files() {
        let home = tempfile::tempdir().unwrap();
        let candidate = candidate(home.path(), 1);
        let session = home.path().join("sessions/example/session.v2.jsonl");
        fs::create_dir_all(session.parent().unwrap()).unwrap();
        fs::write(&session, b"committed session generation\n").unwrap();
        let control = ProfileControl::new(home.path().into());
        control.queue(candidate.clone()).unwrap();
        assert_eq!(control.launch_profile().unwrap(), candidate.profile);
        assert!(control.reject("web").is_err());
        control.reject(&candidate.profile).unwrap();
        assert_eq!(control.launch_profile().unwrap(), "web");
        let state = control.selection().unwrap();
        assert_eq!(
            state.last_failure.unwrap().reason,
            FailureReason::StartupFailed
        );
        assert!(state.trial.is_none());
        control.check_candidate(&candidate).unwrap();
        assert_eq!(
            fs::read(&session).unwrap(),
            b"committed session generation\n"
        );
    }

    #[test]
    fn unfinished_trial_is_not_replayed_after_application_interruption() {
        let home = tempfile::tempdir().unwrap();
        let candidate = candidate(home.path(), 1);
        let control = ProfileControl::new(home.path().into());
        control.queue(candidate.clone()).unwrap();
        control.launch_profile().unwrap();
        drop(control);
        let next = ProfileControl::new(home.path().into());
        assert_eq!(next.launch_profile().unwrap(), "web");
        assert_eq!(
            next.selection().unwrap().last_failure.unwrap(),
            Failure {
                candidate,
                reason: FailureReason::Interrupted,
            }
        );
    }

    #[test]
    fn cancellation_is_exact_and_keeps_the_candidate_files() {
        let home = tempfile::tempdir().unwrap();
        let candidate = candidate(home.path(), 1);
        let control = ProfileControl::new(home.path().into());
        control.queue(candidate.clone()).unwrap();
        assert!(control.cancel("web").is_err());
        control.cancel(&candidate.profile).unwrap();
        assert!(control.cancel(&candidate.profile).is_err());
        assert_eq!(control.launch_profile().unwrap(), "web");
        control.check_candidate(&candidate).unwrap();
    }

    #[test]
    fn queue_rejects_a_stale_predecessor_conflicting_candidate_or_running_trial() {
        let home = tempfile::tempdir().unwrap();
        let first = candidate(home.path(), 1);
        let second = candidate(home.path(), 2);
        let control = ProfileControl::new(home.path().into());
        control.queue(first.clone()).unwrap();
        assert!(control.queue(second.clone()).is_err());
        control.launch_profile().unwrap();
        assert!(control.queue(first.clone()).is_err());
        assert!(control.cancel(&first.profile).is_err());
        control.commit(&first.profile).unwrap();
        assert!(control.queue(second.clone()).is_err());
        control
            .queue(Candidate {
                previous_profile: first.profile,
                ..second
            })
            .unwrap();
    }

    #[test]
    fn changed_or_missing_manifest_is_rejected_at_queue_launch_and_commit() {
        let home = tempfile::tempdir().unwrap();
        let candidate = candidate(home.path(), 1);
        let manifest = home
            .path()
            .join("profiles")
            .join(&candidate.profile)
            .join("package.json");
        let original = fs::read(&manifest).unwrap();
        let control = ProfileControl::new(home.path().into());
        fs::write(&manifest, b"{}").unwrap();
        assert!(control.queue(candidate.clone()).is_err());
        fs::write(&manifest, &original).unwrap();
        control.queue(candidate.clone()).unwrap();
        fs::remove_file(&manifest).unwrap();
        assert_eq!(control.launch_profile().unwrap(), "web");
        assert_eq!(
            control.selection().unwrap().last_failure.unwrap().reason,
            FailureReason::InvalidCandidate
        );
        fs::write(&manifest, &original).unwrap();
        control.queue(candidate.clone()).unwrap();
        let next = ProfileControl::new(home.path().into());
        assert_eq!(next.launch_profile().unwrap(), candidate.profile);
        fs::write(&manifest, b"{}").unwrap();
        assert!(next.commit(&candidate.profile).is_err());
        assert_eq!(next.selection().unwrap().active_profile, "web");
    }

    #[test]
    fn manifests_require_valid_json_and_startup_only_reload() {
        let home = tempfile::tempdir().unwrap();
        let mut candidate = candidate(home.path(), 1);
        let manifest = home
            .path()
            .join("profiles")
            .join(&candidate.profile)
            .join("package.json");
        let control = ProfileControl::new(home.path().into());
        for bytes in [
            b"not json".as_slice(),
            br#"{"dsh":{"profile":{"patchReload":"live"}}}"#,
        ] {
            fs::write(&manifest, bytes).unwrap();
            candidate.manifest_sha256 = format!("{:x}", Sha256::digest(bytes));
            assert!(control.queue(candidate.clone()).is_err());
        }
        fs::write(&manifest, vec![b'x'; MAX_MANIFEST_BYTES as usize + 1]).unwrap();
        assert!(control.queue(candidate).is_err());
    }

    #[test]
    fn parser_rejects_unknown_fields_unsafe_names_and_noncanonical_hashes() {
        let home = tempfile::tempdir().unwrap();
        let valid = candidate(home.path(), 1);
        for name in [
            "web",
            "../web",
            "/tmp/profile",
            "desktop-00000000-0000-5000-8000-000000000001",
            "desktop-00000000-0000-4000-C000-000000000001",
        ] {
            assert!(validate_candidate(&Candidate {
                profile: name.into(),
                ..valid.clone()
            })
            .is_err());
        }
        assert!(validate_candidate(&Candidate {
            previous_profile: valid.profile.clone(),
            ..valid.clone()
        })
        .is_err());
        assert!(validate_candidate(&Candidate {
            manifest_sha256: "A".repeat(64),
            ..valid.clone()
        })
        .is_err());
        let mut value = serde_json::to_value(valid).unwrap();
        value["path"] = serde_json::json!("/tmp/profile");
        assert!(serde_json::from_value::<Candidate>(value).is_err());
    }

    #[test]
    fn malformed_durable_records_fail_closed_without_replacing_the_original() {
        let home = tempfile::tempdir().unwrap();
        let control = ProfileControl::new(home.path().into());
        let candidate = candidate(home.path(), 1);
        let mut invalid = Vec::new();
        let base = serde_json::to_value(Selection::default()).unwrap();
        for (field, value) in [
            ("schemaVersion", serde_json::json!(2)),
            ("activeProfile", serde_json::json!("../../escape")),
            ("extra", serde_json::json!(true)),
        ] {
            let mut record = base.clone();
            record[field] = value;
            invalid.push(serde_json::to_vec(&record).unwrap());
        }
        let mut record = base;
        record["pending"] = serde_json::to_value(&candidate).unwrap();
        record["trial"] = serde_json::to_value(&candidate).unwrap();
        invalid.push(serde_json::to_vec(&record).unwrap());
        invalid.push(b"{".to_vec());
        invalid.push(vec![b'x'; MAX_STATE_BYTES as usize + 1]);
        for bytes in invalid {
            fs::write(home.path().join(STATE_FILE), &bytes).unwrap();
            assert!(control.selection().is_err());
            assert!(control.launch_profile().is_err());
            assert!(control.queue(candidate.clone()).is_err());
            assert_eq!(fs::read(home.path().join(STATE_FILE)).unwrap(), bytes);
        }
    }

    #[test]
    fn unreadable_selection_blocks_recovery_until_the_original_record_is_restored() {
        let home = tempfile::tempdir().unwrap();
        let candidate = candidate(home.path(), 1);
        let control = ProfileControl::new(home.path().into());
        control.queue(candidate.clone()).unwrap();
        control.launch_profile().unwrap();
        let path = home.path().join(STATE_FILE);
        let backup = home.path().join("saved-selection.json");
        fs::rename(&path, &backup).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(control.reject(&candidate.profile).is_err());
        assert!(control.launch_profile().is_err());
        fs::remove_dir(&path).unwrap();
        fs::rename(&backup, &path).unwrap();
        assert_eq!(control.launch_profile().unwrap(), "web");
        assert!(control.selection().unwrap().trial.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn failed_persistence_never_confirms_or_repeats_the_failed_trial() {
        use std::os::unix::fs::PermissionsExt;
        struct RestorePermissions(PathBuf, fs::Permissions);
        impl Drop for RestorePermissions {
            fn drop(&mut self) {
                fs::set_permissions(&self.0, self.1.clone()).unwrap();
            }
        }
        let home = tempfile::tempdir().unwrap();
        let restore = RestorePermissions(
            home.path().into(),
            fs::metadata(home.path()).unwrap().permissions(),
        );
        let candidate = candidate(home.path(), 1);
        let control = ProfileControl::new(home.path().into());
        control.queue(candidate.clone()).unwrap();
        fs::set_permissions(home.path(), fs::Permissions::from_mode(0o500)).unwrap();
        assert!(control
            .launch_profile()
            .unwrap_err()
            .contains("Could not save"));
        assert!(control.selection().unwrap().pending.is_some());
        fs::set_permissions(home.path(), restore.1.clone()).unwrap();
        assert_eq!(control.launch_profile().unwrap(), candidate.profile);
        fs::set_permissions(home.path(), fs::Permissions::from_mode(0o500)).unwrap();
        assert!(control
            .commit(&candidate.profile)
            .unwrap_err()
            .contains("Could not save"));
        assert_eq!(control.selection().unwrap().active_profile, "web");
        assert!(control
            .reject(&candidate.profile)
            .unwrap_err()
            .contains("Could not save"));
        assert!(control
            .launch_profile()
            .unwrap_err()
            .contains("Could not save"));
        drop(restore);
        assert_eq!(control.launch_profile().unwrap(), "web");
        assert!(control.selection().unwrap().trial.is_none());
    }

    #[test]
    fn competing_queues_have_one_winner() {
        use std::sync::{Arc, Barrier};
        let home = tempfile::tempdir().unwrap();
        let first = candidate(home.path(), 1);
        let second = candidate(home.path(), 2);
        let control = Arc::new(ProfileControl::new(home.path().into()));
        let barrier = Arc::new(Barrier::new(2));
        let results: Vec<_> = [first, second]
            .into_iter()
            .map(|candidate| {
                let control = control.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    control.queue(candidate)
                })
            })
            .collect();
        let successes = results
            .into_iter()
            .map(|join| join.join().unwrap())
            .filter(Result::is_ok)
            .count();
        assert_eq!(successes, 1);
        assert!(control.selection().unwrap().pending.is_some());
    }

    #[cfg(unix)]
    #[test]
    fn linked_state_and_profile_inputs_are_not_followed() {
        use std::os::unix::fs::symlink;
        let home = tempfile::tempdir().unwrap();
        let candidate = candidate(home.path(), 1);
        let control = ProfileControl::new(home.path().into());
        let state = home.path().join(STATE_FILE);
        symlink(home.path().join("missing.json"), &state).unwrap();
        assert!(control.launch_profile().is_err());
        fs::remove_file(&state).unwrap();
        let directory = home.path().join("profiles").join(&candidate.profile);
        let elsewhere = home.path().join("elsewhere");
        fs::rename(&directory, &elsewhere).unwrap();
        symlink(&elsewhere, &directory).unwrap();
        assert!(control.queue(candidate.clone()).is_err());
        fs::remove_file(&directory).unwrap();
        fs::rename(&elsewhere, &directory).unwrap();
        let manifest = directory.join("package.json");
        fs::rename(&manifest, &elsewhere).unwrap();
        symlink(&elsewhere, &manifest).unwrap();
        assert!(control.queue(candidate).is_err());
    }
}
