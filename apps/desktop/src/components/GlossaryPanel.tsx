import { FormEvent } from "react";
import { BookOpen, Plus, Trash2 } from "lucide-react";
import type { GlossaryTerm } from "../types";

interface GlossaryPanelProps {
  glossary: GlossaryTerm[];
  newTerm: { source: string; target: string; domain: string };
  setNewTerm: (term: { source: string; target: string; domain: string }) => void;
  onAdd: (event: FormEvent) => void;
  onToggle: (term: GlossaryTerm) => void;
  onRemove: (id: string) => void;
}

export function GlossaryPanel({ glossary, newTerm, setNewTerm, onAdd, onToggle, onRemove }: GlossaryPanelProps) {
  return (
    <section className="glossary-grid">
      <form className="form-panel" onSubmit={(event) => void onAdd(event)}>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Glossary</span>
            <h2>新增术语</h2>
          </div>
          <BookOpen />
        </div>
        <label className="field">
          <span>英文术语</span>
          <input value={newTerm.source} onChange={(event) => setNewTerm({ ...newTerm, source: event.target.value })} />
        </label>
        <label className="field">
          <span>中文译法</span>
          <input value={newTerm.target} onChange={(event) => setNewTerm({ ...newTerm, target: event.target.value })} />
        </label>
        <label className="field">
          <span>领域</span>
          <input value={newTerm.domain} onChange={(event) => setNewTerm({ ...newTerm, domain: event.target.value })} />
        </label>
        <button className="primary-button" type="submit">
          <Plus />
          添加术语
        </button>
      </form>
      <div className="terms-panel">
        {glossary.map((term) => (
          <div className="term-row" key={term.id}>
            <button className={`switch ${term.enabled ? "on" : ""}`} onClick={() => onToggle(term)} />
            <div>
              <strong>{term.source}</strong>
              <span>{term.target}</span>
            </div>
            <small>{term.domain ?? "General"}</small>
            <button className="icon-button" title="删除术语" onClick={() => onRemove(term.id)}>
              <Trash2 />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
