import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface FieldWrap { label: string; hint?: ReactNode; error?: string; className?: string }

/** `keepHint` keeps the hint visible beside an error, for rules the person needs to see while fixing the field. */
export function TextField({ label, hint, error, className, id, keepHint, ...rest }: FieldWrap & { keepHint?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const fid = id ?? auto;
  const showHint = !!hint && (!error || keepHint);
  const describedBy = [error && `${fid}-err`, showHint && `${fid}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={fid} className="label">{label}</label>
      <input id={fid} className={cn('field', error && 'border-floor')} aria-invalid={!!error} aria-describedby={describedBy} {...rest} />
      {error && <p id={`${fid}-err`} className="text-[12.5px] text-floor mt-1">{error}</p>}
      {showHint && <p id={`${fid}-hint`} className="text-[12.5px] text-muted mt-1">{hint}</p>}
    </div>
  );
}

export function TextAreaField({ label, hint, error, className, id, ...rest }: FieldWrap & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const fid = id ?? auto;
  const describedBy = [error && `${fid}-err`, hint && `${fid}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={fid} className="label">{label}</label>
      <textarea id={fid} className={cn('field', error && 'border-floor')} aria-invalid={!!error} aria-describedby={describedBy} {...rest} />
      {error && <p id={`${fid}-err`} className="text-[12.5px] text-floor mt-1">{error}</p>}
      {hint && <p id={`${fid}-hint`} className="text-[12.5px] text-muted mt-1">{hint}</p>}
    </div>
  );
}

/**
 * Dollar box that holds exactly what was typed (the caller turns it into cents with `parseCents`). Unlike `MoneyField`
 * it does not reformat on every keystroke, so "12.5" can be typed and a blank box stays blank instead of reading $0.00.
 */
export function DollarField({ label, hint, error, className, id, ...rest }: FieldWrap & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const fid = id ?? auto;
  const describedBy = [error && `${fid}-err`, hint && `${fid}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={fid} className="label">{label}</label>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted text-[14px]" aria-hidden>$</span>
        <input id={fid} type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" className={cn('field pl-6 num', error && 'border-floor')} aria-invalid={!!error} aria-describedby={describedBy} {...rest} />
      </div>
      {error && <p id={`${fid}-err`} className="text-[12.5px] text-floor mt-1">{error}</p>}
      {hint && <p id={`${fid}-hint`} className="text-[12.5px] text-muted mt-1">{hint}</p>}
    </div>
  );
}

/** Dollar input that stores cents. */
export function MoneyField({ label, hint, error, className, valueCents, onChangeCents, ...rest }: FieldWrap & { valueCents: number; onChangeCents: (c: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const auto = useId();
  return (
    <div className={className}>
      <label htmlFor={auto} className="label">{label}</label>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted text-[14px]" aria-hidden>$</span>
        <input
          id={auto}
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          className={cn('field pl-6 num', error && 'border-floor')}
          value={(valueCents / 100).toFixed(2)}
          onChange={(e) => onChangeCents(Math.round(parseFloat(e.target.value || '0') * 100))}
          aria-invalid={!!error}
          {...rest}
        />
      </div>
      {error ? <p className="text-[12.5px] text-floor mt-1">{error}</p> : hint ? <p className="text-[12.5px] text-muted mt-1">{hint}</p> : null}
    </div>
  );
}

/** Percent input that stores a decimal (0.136). */
export function PctField({ label, hint, error, className, value, onChange, ...rest }: FieldWrap & { value: number; onChange: (p: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const auto = useId();
  return (
    <div className={className}>
      <label htmlFor={auto} className="label">{label}</label>
      <div className="relative">
        <input
          id={auto}
          type="number"
          inputMode="decimal"
          step="0.1"
          min={0}
          className={cn('field pr-7 num', error && 'border-floor')}
          value={Number((value * 100).toFixed(2))}
          onChange={(e) => onChange(parseFloat(e.target.value || '0') / 100)}
          aria-invalid={!!error}
          {...rest}
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted text-[14px]" aria-hidden>%</span>
      </div>
      {error ? <p className="text-[12.5px] text-floor mt-1">{error}</p> : hint ? <p className="text-[12.5px] text-muted mt-1">{hint}</p> : null}
    </div>
  );
}

export function SelectField({ label, hint, className, children, ...rest }: FieldWrap & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId();
  return (
    <div className={className}>
      <label htmlFor={auto} className="label">{label}</label>
      <select id={auto} className="field" {...rest}>{children}</select>
      {hint && <p className="text-[12.5px] text-muted mt-1">{hint}</p>}
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer py-1">
      <span className="relative mt-0.5 shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="block h-5 w-9 rounded-full bg-rule peer-checked:bg-accent transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent peer-focus-visible:outline-offset-2" />
        <span className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-surface shadow transition-transform peer-checked:translate-x-4" />
      </span>
      <span>
        <span className="block text-[14px]">{label}</span>
        {hint && <span className="block text-[12.5px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}
