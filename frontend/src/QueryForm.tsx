import { useState, type FormEvent } from 'react';
import { TEMPLATES, type QueryRequest, type Template } from './query';

interface QueryFormProps {
  running: boolean;
  onSubmit(request: QueryRequest): void;
}

/** The contract type (required), an optional free-text instruction and the reference option. */
export function QueryForm({ running, onSubmit }: QueryFormProps) {
  const [template, setTemplate] = useState<Template>();
  const [instruction, setInstruction] = useState('');
  // On by default: the demo compares the two flows (E7-3).
  const [reference, setReference] = useState(true);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (template) onSubmit({ template, instruction: instruction.trim(), reference });
  }

  return (
    <form className="query-form card" onSubmit={submit}>
      <fieldset>
        <legend>Avtalstyp</legend>
        {TEMPLATES.map(({ value, label }) => (
          <label key={value}>
            <input
              type="radio"
              name="template"
              value={value}
              required
              checked={template === value}
              onChange={() => setTemplate(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="instruction">
        Instruktion (valfri)
        <textarea
          rows={4}
          value={instruction}
          placeholder="T.ex. tillsvidareanställning med sex månaders provanställning och konkurrensklausul"
          onChange={(event) => setInstruction(event.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={reference}
          onChange={(event) => setReference(event.target.checked)}
        />
        Kör även referens-RAG för jämförelse
      </label>
      <button type="submit" disabled={!template || running}>
        {running ? 'Kör…' : 'Skapa utkast'}
      </button>
    </form>
  );
}
