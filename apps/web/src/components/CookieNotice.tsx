import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui';

const KEY = 'floor.cookieNotice';

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Floor stores the sign-in on this device and does not use advertising cookies. Shown once. */
export function CookieNotice() {
  const [open, setOpen] = useState(() => !seen());
  if (!open) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // Private mode: hide it for this view anyway.
    }
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Storage notice"
      className="fixed inset-x-0 top-0 z-50 flex flex-col gap-3 border-b border-rule bg-surface/95 px-4 py-3 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-center"
    >
      <p className="text-[13.5px] leading-relaxed text-ink/80">
        Floor keeps your sign-in on this device so you stay logged in. It does not use advertising cookies.{' '}
        <Link to="/cookies" className="underline">Cookie policy</Link>
      </p>
      <Button variant="primary" size="sm" onClick={dismiss} className="shrink-0">OK</Button>
    </div>
  );
}
