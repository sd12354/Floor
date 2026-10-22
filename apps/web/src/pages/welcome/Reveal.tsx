import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Fades and lifts its children in the first time they scroll into view. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setShown(true); io.disconnect(); } }, { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const style: CSSProperties = { transitionDelay: `${delay}ms` };
  return (
    <div ref={ref} style={style} className={cn('transition-all duration-700 ease-out motion-reduce:transition-none', shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 motion-reduce:opacity-100 motion-reduce:translate-y-0', className)}>
      {children}
    </div>
  );
}

/** A card that tilts toward the pointer. */
export function TiltCard({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(700px) rotateY(${(x * 10).toFixed(2)}deg) rotateX(${(-y * 10).toFixed(2)}deg) translateZ(0)`;
    el.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(0)}%`);
    el.style.setProperty('--gy', `${((y + 0.5) * 100).toFixed(0)}%`);
  };
  const leave = () => { if (ref.current) ref.current.style.transform = ''; };
  return (
    <div
      ref={ref}
      onPointerMove={move}
      onPointerLeave={leave}
      className={cn('rounded-2xl border border-white/10 bg-white/[0.04] p-6 transition-transform duration-200 ease-out', className)}
      style={{ backgroundImage: 'radial-gradient(240px circle at var(--gx,50%) var(--gy,0%), rgba(138,162,255,0.16), transparent 70%)' }}
    >
      {children}
    </div>
  );
}
