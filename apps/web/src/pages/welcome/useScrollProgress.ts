import { useEffect, useState, type RefObject } from 'react';

/**
 * Progress 0..1 of a tall section as it scrolls through the viewport (0 when its top reaches the top
 * of the screen, 1 when its bottom reaches the bottom). Also writes --p on the element so CSS can
 * react every frame without a React re-render; React state only changes at `steps` boundaries.
 */
export function useScrollProgress(ref: RefObject<HTMLElement>, steps: number): { stage: number } {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const total = Math.max(1, rect.height - window.innerHeight);
      const p = Math.min(1, Math.max(0, -rect.top / total));
      el.style.setProperty('--p', p.toFixed(4));
      setStage(Math.min(steps - 1, Math.floor(p * steps)));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, steps]);

  return { stage };
}
