import { FormEvent } from "react";
import { BookOpen, Plus, Trash2 } from "lucide-react";
import type { GlossaryTerm } from "../types";
import { t, useLang } from "../i18n";

interface GlossaryPanelProps {
  glossary: GlossaryTerm[];
  newTerm: { source: string; target: string; domain: string };
  setNewTerm: (term: { source: string; target: string; domain: string }) => void;
  onAdd: (event: FormEvent) => void;
  onToggle: (term: GlossaryTerm) => void;
  onRemove: (id: string) => void;
}

export function GlossaryPanel({
  glossary,
  newTerm,
  setNewTerm,
  onAdd,
  onToggle,
  onRemove,
}: GlossaryPanelProps) {
  const lang = useLang();
  return (
    <section className="glossary-grid">
      <form className="form-panel" onSubmit={(event) => void onAdd(event)}>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{t("glossary.section", lang)}</span>
            <h2>{t("glossary.addTerm", lang)}</h2>
          </div>
          <BookOpen />
        </div>
        <label className="field">
          <span>{t("glossary.sourceTerm", lang)}</span>
          <input
            value={newTerm.source}
            onChange={(event) => setNewTerm({ ...newTerm, source: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{t("glossary.targetTerm", lang)}</span>
          <input
            value={newTerm.target}
            onChange={(event) => setNewTerm({ ...newTerm, target: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{t("glossary.domain", lang)}</span>
          <input
            value={newTerm.domain}
            onChange={(event) => setNewTerm({ ...newTerm, domain: event.target.value })}
          />
        </label>
        <button className="primary-button" type="submit">
          <Plus />
          {t("glossary.addButton", lang)}
        </button>
      </form>
      <div className="terms-panel">
        {glossary.map((term) => (
          <div className="term-row" key={term.id}>
            <button
              className={`switch ${term.enabled ? "on" : ""}`}
              onClick={() => onToggle(term)}
            />
            <div>
              <strong>{term.source}</strong>
              <span>{term.target}</span>
            </div>
            <small>{term.domain ?? t("glossary.domainGeneral", lang)}</small>
            <button
              className="icon-button"
              title={t("glossary.deleteTooltip", lang)}
              onClick={() => onRemove(term.id)}
            >
              <Trash2 />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
