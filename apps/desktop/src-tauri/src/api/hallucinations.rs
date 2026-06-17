use std::collections::HashMap;
use std::sync::LazyLock;

static HALLUCINATIONS: LazyLock<HashMap<&'static str, Vec<&'static str>>> = LazyLock::new(|| {
    let mut m: HashMap<&str, Vec<&str>> = HashMap::new();

    // English — preserved from original WHISPER_HALLUCINATIONS list
    m.insert(
        "en",
        vec![
            "thank you",
            "thanks for watching",
            "subscribe",
            "please subscribe",
            "like and subscribe",
            "please like",
            "thank you for watching",
            "thank you for listening",
            "bye",
            "goodbye",
            "see you",
            "see you next time",
            "if you enjoyed",
            "don't forget to",
            "welcome back",
            "hello everyone",
        ],
    );

    // Japanese — HuggingFace whisper-hallucinations dataset + community reports
    m.insert(
        "ja",
        vec![
            "ご視聴ありがとうございました",
            "ご視聴をありがとうございます",
            "チャンネル登録お願いします",
            "また次の動画でお会いしましょう",
            "見てくれてありがとう",
        ],
    );

    // Korean
    m.insert(
        "ko",
        vec![
            "시청해주셔서 감사합니다",
            "구독과 좋아요 부탁드립니다",
            "봐주셔서 감사합니다",
        ],
    );

    // Russian — waveletdeboshir noise dataset + community
    m.insert(
        "ru",
        vec![
            "спасибо за просмотр",
            "подпишитесь на канал",
            "веселая музыка",
            "спокойная музыка",
            "аплодисменты",
            "смех",
        ],
    );

    // French
    m.insert(
        "fr",
        vec![
            "merci d'avoir regardé",
            "abonnez-vous",
            "sous-titres réalisés par la communauté d'amara.org",
        ],
    );

    // German
    m.insert(
        "de",
        vec![
            "danke fürs zuschauen",
            "abonniert den kanal",
            "vielen dank fürs zuschauen",
        ],
    );

    // Spanish
    m.insert(
        "es",
        vec![
            "gracias por ver",
            "suscríbete al canal",
            "hasta la próxima",
        ],
    );

    // Language-agnostic noise markers
    m.insert(
        "_common",
        vec!["[music]", "[applause]", "[laughter]"],
    );

    m
});

/// Return the hallucination blocklist for the given source language.
///
/// The list merges the language-specific bucket with the shared `_common` bucket.
/// Unknown languages fall back to `_common` only.
pub fn get_hallucination_list(source_lang: &str) -> Vec<&'static str> {
    let lang_key = source_lang.split('-').next().unwrap_or("en");
    let mut result = Vec::new();
    if let Some(lang_list) = HALLUCINATIONS.get(lang_key) {
        result.extend(lang_list.iter().copied());
    }
    if let Some(common) = HALLUCINATIONS.get("_common") {
        result.extend(common.iter().copied());
    }
    result
}

/// Check whether the given text is a Whisper hallucination for the source language.
///
/// Normalisation: lowercase + strip trailing punctuation (Latin and CJK).
pub fn is_hallucination(text: &str, source_lang: &str) -> bool {
    let lower = text.to_lowercase();
    let normalized = lower
        .trim_matches(['.', ',', '!', '?', ';', ':', '！', '？', '。', '、'].as_slice())
        .trim();
    get_hallucination_list(source_lang).contains(&normalized)
}
