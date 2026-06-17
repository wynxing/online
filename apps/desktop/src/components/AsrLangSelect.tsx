import { useState } from "react";
import { t, useLang } from "../i18n";

/** Sentinel value for the "Custom" option in the ASR language <select>. */
const CUSTOM_ASR_VALUE = "__custom__";

/** Sentinel value for Whisper auto-detection. */
const ASR_AUTO_VALUE = "auto";

interface AsrLangOption {
  /** Whisper ISO 639-1 language code */
  code: string;
  /** English name */
  name: string;
  /** Native name */
  nativeName: string;
}

interface AsrLangSelectProps {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}

export function AsrLangSelect({ value, placeholder, onChange }: AsrLangSelectProps) {
  const lang = useLang();

  const options: AsrLangOption[] = [
    { code: "en", name: "English", nativeName: "English" },
    { code: "zh", name: "Chinese", nativeName: "中文" },
    { code: "ja", name: "Japanese", nativeName: "日本語" },
    { code: "ko", name: "Korean", nativeName: "한국어" },
    { code: "ru", name: "Russian", nativeName: "Русский" },
    { code: "fr", name: "French", nativeName: "Français" },
    { code: "de", name: "German", nativeName: "Deutsch" },
    { code: "es", name: "Spanish", nativeName: "Español" },
  ];

  const known = [ASR_AUTO_VALUE, ...options.map((o) => o.code)];

  // Custom mode is tracked locally so the <select> stays mounted and the user
  // can always pick a known language to leave it. Initialized true when the
  // incoming value is already a non-empty custom code.
  const [customMode, setCustomMode] = useState(
    () => value !== "" && value !== ASR_AUTO_VALUE && !known.includes(value)
  );

  const selectValue = customMode
    ? CUSTOM_ASR_VALUE
    : known.includes(value)
      ? value
      : ASR_AUTO_VALUE;

  return (
    <>
      <select
        value={selectValue}
        onChange={(event) => {
          const v = event.target.value;
          if (v === CUSTOM_ASR_VALUE) {
            setCustomMode(true);
            onChange("");
          } else {
            setCustomMode(false);
            onChange(v);
          }
        }}
      >
        <option value={ASR_AUTO_VALUE}>{t("settings.asrAutoDetect", lang)}</option>
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.nativeName} ({o.name})
          </option>
        ))}
        <option value={CUSTOM_ASR_VALUE}>{t("settings.customLanguage", lang)}</option>
      </select>
      {customMode && (
        <input
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </>
  );
}
