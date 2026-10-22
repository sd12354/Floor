import { useState } from 'react';
import { cn } from '@/lib/cn';

// Illustrative numbers only: a $13.99 listing, $6.50 + $2.00 from the supplier, 13.6% + $0.40 eBay fees.
const SALE = 1399;
const COST = 650;
const SHIP = 200;
const money = (c: number) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;
const LO = -0.2;
const HI = 0.4;
const pos = (m: number) => `${Math.min(100, Math.max(0, ((m - LO) / (HI - LO)) * 100))}%`;

/** Drag the supplier's price and your floor; watch the verdict flip. Same rule the real ladder uses. */
export function TryTheFloor() {
  const [drift, setDrift] = useState(0);
  const [floor, setFloor] = useState(10);

  const cost = Math.round(COST * (1 + drift / 100));
  const fees = Math.round(SALE * 0.136) + 40;
  const net = SALE - cost - SHIP - fees;
  const margin = net / SALE;
  const ok = margin >= floor / 100;

  return (
    <section className="relative px-6 py-28 md:py-40" aria-label="Try the floor">
      <div className="mx-auto max-w-[860px]">
        <p className="text-[12px] tracking-[0.18em] uppercase text-[#8AA2FF]">Try it</p>
        <h2 className="font-display text-[30px] md:text-[48px] leading-[1.1] text-white mt-3">The supplier raises the price.<br />What does Floor do?</h2>

        <div className="mt-10 grid md:grid-cols-2 gap-8">
          <label className="block">
            <span className="flex justify-between text-[13px] text-white/70">Supplier price change <b className="num text-white">{drift > 0 ? '+' : ''}{drift}%</b></span>
            <input type="range" min={-20} max={90} step={1} value={drift} onChange={(e) => setDrift(Number(e.target.value))} className="w-full mt-3 accent-[#8AA2FF]" />
            <span className="block text-[12px] text-white/45 mt-1">Item now costs {money(cost)} (was {money(COST)})</span>
          </label>
          <label className="block">
            <span className="flex justify-between text-[13px] text-white/70">Your margin floor <b className="num text-white">{floor}%</b></span>
            <input type="range" min={0} max={30} step={1} value={floor} onChange={(e) => setFloor(Number(e.target.value))} className="w-full mt-3 accent-[#EC695A]" />
            <span className="block text-[12px] text-white/45 mt-1">Floor will not fulfil below this.</span>
          </label>
        </div>

        <div className="mt-10 relative h-14 rounded-full bg-white/[0.06] border border-white/10 overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#EC695A]/30 via-[#EC695A]/10 to-transparent" style={{ width: pos(floor / 100) }} />
          <div className="absolute inset-y-1 w-[3px] rounded bg-[#EC695A] shadow-[0_0_14px_#EC695A] transition-all duration-300" style={{ left: pos(floor / 100) }} />
          <div
            className={cn('absolute top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-300', ok ? 'bg-[#8AA2FF] shadow-[0_0_24px_#8AA2FF]' : 'bg-[#EC695A] shadow-[0_0_24px_#EC695A]')}
            style={{ left: pos(margin) }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-white/40 mt-2 num"><span>-20%</span><span>0%</span><span>+40%</span></div>

        <div className={cn('mt-8 rounded-xl border px-6 py-5 transition-colors duration-300', ok ? 'border-[#8AA2FF]/40 bg-[#8AA2FF]/10' : 'border-[#EC695A]/50 bg-[#EC695A]/10')} role="status" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className={cn('font-display text-[28px] md:text-[36px]', ok ? 'text-[#8AA2FF]' : 'text-[#EC695A]')}>{ok ? 'Fulfil' : 'Hold'}</span>
            <span className="num text-[15px] text-white/80">Net {money(net)} · {(margin * 100).toFixed(1)}% margin</span>
          </div>
          <p className="text-[14px] text-white/65 mt-2 max-w-[60ch]">
            {ok
              ? 'The margin still clears your floor, so Floor orders it (or queues it for you to order by hand).'
              : net < 0
                ? 'Ordering would lose money. Floor holds it for you to decide, and cancels it before the handling deadline rather than ship at a loss.'
                : 'Still a profit, but below your floor. Floor holds it for you to decide, and cancels it before the handling deadline.'}
          </p>
        </div>
      </div>
    </section>
  );
}
