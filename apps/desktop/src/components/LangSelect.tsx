import { useState } from "react";
import { t, useLang } from "../i18n";
import { SUPPORTED_LANGS, CUSTOM_LANG_VALUE } from "../constants/languages";

interface LangSelectProps {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}

export function LangSelect({ value, placeholder, onChange }: LangSelectProps) {
  const lang = useLang();
  const known = SUPPORTED_LANGS.map((l) => l.code);

  // Custom mode is tracked locally so the <select> stays mounted and the user
  // can always pick a known language to leave it. Initialized true when the
  // incoming value is already a custom code.
  const [customMode, setCustomMode] = useState(() => value !== "" && !known.includes(value));

  const selectValue = customMode
    ? CUSTOM_LANG_VALUE
    : known.includes(value)
      ? value
      : CUSTOM_LANG_VALUE;

  return (
    <>
      <select
        value={selectValue}
        onChange={(event) => {
          const v = event.target.value;
          if (v === CUSTOM_LANG_VALUE) {
            setCustomMode(true);
            onChange("");
          } else {
            setCustomMode(false);
            onChange(v);
          }
        }}
      >
        {SUPPORTED_LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.nativeName} ({l.name})
          </option>
        ))}
        <option value={CUSTOM_LANG_VALUE}>{t("settings.customLanguage", lang)}</option>
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
