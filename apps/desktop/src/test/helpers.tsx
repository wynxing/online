import type { ReactElement } from "react";
import { LangProvider } from "../i18n/index";
import type { Lang } from "../i18n/index";

export function withLang(node: ReactElement, lang: Lang = "en"): ReactElement {
  return <LangProvider value={lang}>{node}</LangProvider>;
}
