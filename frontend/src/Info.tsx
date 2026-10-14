import { useId, useState, type ReactNode } from 'react';
import { EXPLANATIONS, type Measure } from './explanations';

interface InfoButtonProps {
  measure: Measure;
  open: boolean;
  /** The id of the text it opens. */
  controls: string;
  onToggle(): void;
}

/** The (i) button for `measure`, named "Vad betyder <name>?" (E7-11). */
function InfoButton({ measure, open, controls, onToggle }: InfoButtonProps) {
  return (
    <button
      type="button"
      className="info"
      aria-label={`Vad betyder ${EXPLANATIONS[measure].name}?`}
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      onClick={onToggle}
    >
      <span aria-hidden="true">i</span>
    </button>
  );
}

/** The texts of `measures`, one paragraph each. */
function InfoText({ id, measures }: { id: string; measures: readonly Measure[] }) {
  return (
    <span id={id} className="info-text" role="note">
      {measures.map((measure) => (
        <span key={measure} className="info-paragraph">
          {EXPLANATIONS[measure].text}
        </span>
      ))}
    </span>
  );
}

/** An (i) button that opens what `measure` measures, why, and how to read it, in place. */
export function Info({ measure }: { measure: Measure }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <InfoButton measure={measure} open={open} controls={id} onToggle={() => setOpen(!open)} />
      {open && <InfoText id={id} measures={[measure]} />}
    </>
  );
}

interface ExplainedRowProps {
  label: string;
  measure: Measure;
  /** A detail the row's cells show, explained under the same button. */
  detail?: Measure;
  /** The table's column count, which the opened text spans. */
  columns: number;
  className?: string;
  /** The row's cells. */
  children: ReactNode;
}

/**
 * A table row whose header has one (i) button. The text opens in a row of its own under it, across
 * the whole table, so it does not squeeze the header column.
 */
export function ExplainedRow({
  label,
  measure,
  detail,
  columns,
  className,
  children,
}: ExplainedRowProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <tr className={className}>
        {/* Named by its label alone, so the button inside is not read as part of it. */}
        <th scope="row" aria-label={label}>
          {label}{' '}
          <InfoButton measure={measure} open={open} controls={id} onToggle={() => setOpen(!open)} />
        </th>
        {children}
      </tr>
      {open && (
        <tr className="info-row">
          <td colSpan={columns}>
            <InfoText id={id} measures={detail ? [measure, detail] : [measure]} />
          </td>
        </tr>
      )}
    </>
  );
}
