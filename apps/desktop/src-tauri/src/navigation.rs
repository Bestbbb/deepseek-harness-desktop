//! Preserve a loaded WebView across runtime restarts without retaining launch tokens.

use tauri::webview::PageLoadEvent;
use url::{Origin, Url};

#[derive(Default)]
pub(super) struct RuntimeNavigation {
    requested_origin: Option<Origin>,
    loaded: bool,
}

impl RuntimeNavigation {
    pub(super) fn runtime_ready(&mut self, url: &Url) -> bool {
        let origin = url.origin();
        if self.loaded && self.requested_origin.as_ref() == Some(&origin) {
            return false;
        }
        self.requested_origin = Some(origin);
        self.loaded = false;
        true
    }

    pub(super) fn page_load(&mut self, event: PageLoadEvent, url: &Url) {
        match event {
            PageLoadEvent::Started => self.loaded = false,
            PageLoadEvent::Finished => {
                // The launch-token exchange redirects to the clean root. A
                // loading page or unfinished exchange must not suppress retries.
                if self.requested_origin.as_ref() == Some(&url.origin())
                    && url.path() == "/"
                    && url.query().is_none()
                {
                    self.loaded = true;
                }
            }
        }
    }

    pub(super) fn navigation_failed(&mut self) {
        self.requested_origin = None;
        self.loaded = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> Url {
        Url::parse(value).expect("fixture URL")
    }

    fn loaded() -> RuntimeNavigation {
        let mut state = RuntimeNavigation::default();
        let launch = url("http://127.0.0.1:43123/?token=first");
        assert!(state.runtime_ready(&launch));
        state.page_load(PageLoadEvent::Started, &launch);
        state.page_load(PageLoadEvent::Finished, &url("http://127.0.0.1:43123/"));
        state
    }

    #[test]
    fn token_rotation_does_not_reload_a_loaded_runtime() {
        let mut state = loaded();
        assert!(!state.runtime_ready(&url("http://127.0.0.1:43123/?token=second")));
        assert!(!state.runtime_ready(&url("http://127.0.0.1:43123/?token=third")));
    }

    #[test]
    fn restart_retries_an_unfinished_initial_navigation() {
        let mut state = RuntimeNavigation::default();
        assert!(state.runtime_ready(&url("http://127.0.0.1:43123/?token=first")));
        assert!(state.runtime_ready(&url("http://127.0.0.1:43123/?token=second")));
    }

    #[test]
    fn loading_pages_and_token_urls_do_not_complete_navigation() {
        for finished in [
            "tauri://localhost/",
            "http://127.0.0.1:43124/",
            "http://127.0.0.1:43123/?token=first",
        ] {
            let mut state = RuntimeNavigation::default();
            let launch = url("http://127.0.0.1:43123/?token=first");
            assert!(state.runtime_ready(&launch));
            state.page_load(PageLoadEvent::Finished, &url(finished));
            assert!(state.runtime_ready(&launch), "unfinished page: {finished}");
        }
    }

    #[test]
    fn failed_navigation_can_retry_the_same_origin() {
        let mut state = loaded();
        state.navigation_failed();
        assert!(state.runtime_ready(&url("http://127.0.0.1:43123/?token=second")));
    }

    #[test]
    fn a_changed_origin_requires_navigation_and_ignores_old_completion() {
        let mut state = loaded();
        let next = url("http://127.0.0.1:43124/?token=second");
        assert!(state.runtime_ready(&next));
        state.page_load(PageLoadEvent::Finished, &url("http://127.0.0.1:43123/"));
        assert!(state.runtime_ready(&next));
    }

    #[test]
    fn a_new_page_load_invalidates_the_loaded_document() {
        let mut state = loaded();
        let launch = url("http://127.0.0.1:43123/?token=second");
        state.page_load(PageLoadEvent::Started, &launch);
        assert!(state.runtime_ready(&launch));
    }
}
