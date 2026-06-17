export interface SupportedLang {
  /** BCP-47 code for translation source/target (e.g. "en", "zh-CN") */
  code: string;
  /** ISO 639-1 code for Whisper language field (e.g. "en", "zh") */
  asr: string;
  /** English name */
  name: string;
  /** Native name */
  nativeName: string;
}

export const SUPPORTED_LANGS: SupportedLang[] = [
  { code: "en", asr: "en", name: "English", nativeName: "English" },
  { code: "zh-CN", asr: "zh", name: "Chinese (Simplified)", nativeName: "简体中文" },
  { code: "zh-TW", asr: "zh", name: "Chinese (Traditional)", nativeName: "繁體中文" },
  { code: "ja", asr: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", asr: "ko", name: "Korean", nativeName: "한국어" },
  { code: "ru", asr: "ru", name: "Russian", nativeName: "Русский" },
  { code: "fr", asr: "fr", name: "French", nativeName: "Français" },
  { code: "de", asr: "de", name: "German", nativeName: "Deutsch" },
  { code: "es", asr: "es", name: "Spanish", nativeName: "Español" },
];

/** Sentinel value for the "Custom" option in the language <select>. */
export const CUSTOM_LANG_VALUE = "__custom__";

/**
 * Derive the Whisper ASR language code from a BCP-47 language code.
 * Known codes are looked up from SUPPORTED_LANGS; unknown codes fall back
 * to the part before the first hyphen (e.g. "pt-BR" → "pt").
 */
export function getAsrCode(langCode: string): string {
  const found = SUPPORTED_LANGS.find((l) => l.code === langCode);
  return found ? found.asr : langCode.split("-")[0].toLowerCase();
}

/**
 * Return a user-friendly display name for a language code.
 * Known codes return their native name (e.g. "ja" → "日本語");
 * unknown codes fall back to uppercase (e.g. "pt-BR" → "PT-BR").
 */
export function getLangDisplayName(code: string): string {
  const found = SUPPORTED_LANGS.find((l) => l.code === code);
  return found ? found.nativeName : code.toUpperCase();
}
