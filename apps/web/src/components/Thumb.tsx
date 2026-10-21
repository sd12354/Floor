import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Product thumbnail that falls back to a quiet placeholder when there is no image or it fails to load. */
export function Thumb({ src, className }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className={cn('rounded bg-sunken flex items-center justify-center shrink-0', className)}>
        <ImageOff className="h-4 w-4 text-faint" aria-label="No image" />
      </span>
    );
  }
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className={cn('rounded object-cover bg-sunken shrink-0', className)} />;
}
