//! Shell strings follow the operating-system locale, independently of Web settings.

use std::sync::OnceLock;

fn is_chinese(locale: &str) -> bool {
    locale
        .split(['-', '_'])
        .next()
        .is_some_and(|language| language.eq_ignore_ascii_case("zh"))
}

pub fn text(english: &'static str, chinese: &'static str) -> &'static str {
    static CHINESE: OnceLock<bool> = OnceLock::new();
    if *CHINESE.get_or_init(|| sys_locale::get_locale().is_some_and(|locale| is_chinese(&locale))) {
        chinese
    } else {
        english
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_chinese_language_without_assuming_a_region() {
        for locale in ["zh", "zh-CN", "zh_TW", "ZH-Hant-HK"] {
            assert!(is_chinese(locale));
        }
        for locale in ["en-US", "de-DE", "", "zhx"] {
            assert!(!is_chinese(locale));
        }
    }
}
