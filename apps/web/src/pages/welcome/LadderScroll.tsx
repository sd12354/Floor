import { useRef } from 'react';
import { cn } from '@/lib/cn';
import { useScrollProgress } from './useScrollProgress';

const STAGES = [
  { n: '01', title: 'Listed at a price that clears', body: 'Supplier cost, shipping and every eBay fee are priced in before anything goes live. Each listing is built to net your target margin.', fig: '+20%', cap: 'target margin' },
  { n: '02', title: 'Only a paid order moves money', body: 'Floor buys from the supplier after the buyer has paid, never before. No speculative stock, no float you did not choose.', fig: '$0', cap: 'spent before payment' },
  { n: '03', title: 'The margin is checked again', body: 'At the moment of sale the supplier price and stock are re-read. If it drifted, the order is judged on today\'s numbers, not yesterday\'s.', fig: '10%', cap: 'your floor' },
  { n: '04', title: 'Above the floor, buy. Below it, hold.', body: 'Clears the floor: ordered or queued for you. Falls short: held for your decision, and cancelled before the handling deadline rather than shipped late.', fig: 'Never below', cap: 'the floor' },
] as const;

/** Pinned scene: scrolling draws the ladder and carries an orb down it, one stage at a time. */
export function LadderScroll() {
  const ref = useRef<HTMLElement>(null);
  const { stage } = useScrollProgress(ref, STAGES.length);
  const current = STAGES[stage] ?? STAGES[0];
  const nodes = [60, 180, 300, 420];

  return (
    <section ref={ref} className="relative" style={{ height: '420vh' }} aria-label="How Floor works">
      <div className="sticky top-0 h-dvh overflow-hidden flex items-center">
        {/* Slow drifting nebula tied to scroll */}
        <div aria-hidden className="absolute inset-0 opacity-60" style={{ background: 'radial-gradient(60% 50% at calc(20% + var(--p, 0) * 60%) 40%, rgba(138,162,255,0.18), transparent 70%), radial-gradient(50% 40% at calc(80% - var(--p, 0) * 50%) 70%, rgba(236,105,90,0.16), transparent 70%)' }} />
        <div className="relative mx-auto w-full max-w-[1000px] px-6 grid md:grid-cols-[260px_1fr] gap-8 md:gap-16 items-center">
          <svg viewBox="0 0 120 480" className="h-[38vh] md:h-[66vh] mx-auto" aria-hidden>
            <defs>
              <filter id="orbGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6" /></filter>
            </defs>
            <line x1="60" y1="40" x2="60" y2="440" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
            <line x1="60" y1="40" x2="60" y2="440" stroke="#8AA2FF" strokeWidth="3" strokeLinecap="round" pathLength={1} strokeDasharray="1" style={{ strokeDashoffset: 'calc(1 - var(--p, 0))' }} />
            {nodes.map((y, i) => (
              <g key={y}>
                <circle cx="60" cy={y} r={i === stage ? 11 : 7} className={cn('transition-all duration-500', i <= stage ? 'fill-[#8AA2FF]' : 'fill-[#2A3342]')} />
                {i === 3 && <line x1="12" x2="108" y1={y + 18} y2={y + 18} stroke="#EC695A" strokeWidth="3" strokeLinecap="round" />}
              </g>
            ))}
            {/* Travelling orb */}
            <g style={{ transform: 'translateY(calc(var(--p, 0) * 380px))' }}>
              <circle cx="60" cy="40" r="14" fill="#8AA2FF" opacity="0.7" filter="url(#orbGlow)" />
              <circle cx="60" cy="40" r="5" fill="#fff" />
            </g>
          </svg>

          <div key={stage} className="min-h-[260px] animate-[ladderIn_0.55s_cubic-bezier(.2,.8,.2,1)_both]">
            <div className="flex items-baseline gap-4">
              <span className="font-display text-[64px] md:text-[96px] leading-none text-white/15">{current.n}</span>
              <span className="text-[12px] tracking-[0.16em] uppercase text-white/50">{stage + 1} / {STAGES.length}</span>
            </div>
            <h3 className="font-display text-[28px] md:text-[40px] leading-tight text-white mt-2">{current.title}</h3>
            <p className="text-[15px] md:text-[17px] leading-relaxed text-white/70 mt-3 max-w-[46ch]">{current.body}</p>
            <div className="mt-6 inline-flex items-baseline gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
              <span className="font-display text-[30px] text-[#EC695A] num">{current.fig}</span>
              <span className="text-[12px] tracking-[0.14em] uppercase text-white/55">{current.cap}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
