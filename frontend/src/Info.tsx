import { useId, useState } from 'react';
import { EXPLANATIONS, type Measure } from './explanations';

/** An (i) button that opens what `measure` measures, why, and how to read it, in place (E7-11). */
export function Info({ measure }: { measure: Measure }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { name, text } = EXPLANATIONS[measure];
  return (
    <>
      <button
        type="button"
        className="info"
        aria-label={`Vad betyder ${name}?`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <span id={id} className="info-text" role="note">
          {text}
        </span>
      )}
    </>
  );
}
