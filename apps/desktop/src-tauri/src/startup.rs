//! Per-child startup acknowledgement, distinct from a bound HTTP listener.

use std::sync::{Arc, Mutex};

#[derive(Default)]
pub(crate) struct StartupReadiness {
    current: Mutex<Option<(String, bool)>>,
}

pub(crate) struct StartupAttempt {
    owner: Arc<StartupReadiness>,
    token: String,
}

impl StartupReadiness {
    pub(crate) fn begin(self: &Arc<Self>) -> Result<StartupAttempt, String> {
        let token = format!("{:032x}", rand::random::<u128>());
        let mut current = self
            .current
            .lock()
            .map_err(|_| "Startup state unavailable")?;
        if current.is_some() {
            return Err("A runtime startup attempt is already owned".into());
        }
        *current = Some((token.clone(), false));
        Ok(StartupAttempt {
            owner: self.clone(),
            token,
        })
    }

    pub(crate) fn confirm(&self, token: &str) -> Result<(), String> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| "Startup state unavailable")?;
        match current.as_mut() {
            Some((expected, ready)) if expected == token => {
                *ready = true;
                Ok(())
            }
            _ => Err("Runtime startup attempt does not match".into()),
        }
    }
}

impl StartupAttempt {
    pub(crate) fn token(&self) -> &str {
        &self.token
    }

    pub(crate) fn confirmed(&self) -> bool {
        self.owner.current.lock().is_ok_and(|current| {
            current
                .as_ref()
                .is_some_and(|(token, ready)| token == &self.token && *ready)
        })
    }
}

impl Drop for StartupAttempt {
    fn drop(&mut self) {
        if let Ok(mut current) = self.owner.current.lock() {
            if current
                .as_ref()
                .is_some_and(|(token, _)| token == &self.token)
            {
                *current = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acknowledgement_belongs_to_exactly_one_owned_child_attempt() {
        let readiness = Arc::new(StartupReadiness::default());
        assert!(readiness.confirm("unknown").is_err());
        let first = readiness.begin().unwrap();
        let old = first.token().to_owned();
        assert!(!first.confirmed());
        assert!(readiness.begin().is_err());
        assert!(readiness.confirm("wrong").is_err());
        assert!(!first.confirmed());
        readiness.confirm(first.token()).unwrap();
        readiness.confirm(first.token()).unwrap();
        assert!(first.confirmed());
        drop(first);
        assert!(readiness.confirm(&old).is_err());
        let second = readiness.begin().unwrap();
        assert_ne!(old, second.token());
        assert!(!second.confirmed());
        assert!(readiness.confirm(&old).is_err());
        readiness.confirm(second.token()).unwrap();
        assert!(second.confirmed());
    }
}
