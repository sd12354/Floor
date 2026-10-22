import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '@/lib/clipboard';
import { cn } from '@/lib/cn';

/** Icon (or icon + text) button that copies `text`. `what` names it for screen readers: "Copy city". */
export function CopyButton({ text, what, children, className }: { text: string; what: string; children?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onClick = async () => {
    setState((await copyText(text)) ? 'copied' : 'failed');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2000);
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        aria-label={children ? undefined : `Copy ${what}`}
        className={cn('inline-flex items-center gap-1.5 rounded text-[13px] text-muted hover:text-ink hover:bg-sunken', children ? 'px-2 h-7 border border-rule' : 'p-1.5', className)}
      >
        {state === 'copied' ? <Check className="h-3.5 w-3.5 text-green" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        {children && (state === 'copied' ? 'Copied' : children)}
      </button>
      <span role="status" className="sr-only">{state === 'copied' ? `${what} copied` : state === 'failed' ? `Could not copy ${what}` : ''}</span>
    </>
  );
}
