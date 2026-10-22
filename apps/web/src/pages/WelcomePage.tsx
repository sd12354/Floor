import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { LogoMark } from '@/components/layout/LogoMark';
import { markIntroSeen } from '@/lib/intro';
import { FloorRain } from './welcome/FloorRain';
import { LadderScroll } from './welcome/LadderScroll';
import { TryTheFloor } from './welcome/TryTheFloor';
import { Reveal, TiltCard } from './welcome/Reveal';

const RULES = ['Buys only after the buyer pays', 'Never fulfils below your floor', 'One supplier order per eBay order', 'Cancels before it ships late', 'Wholesale suppliers only'];

const PILLARS = [
  { k: 'Priced', t: 'Every fee counted', d: 'Supplier cost, shipping, final value fee, per-order fee. Listings are priced to net your target, and paused if the supplier moves out from under them.' },
  { k: 'Guarded', t: 'The floor is a hard stop', d: 'Floor will not place an order that nets less than your margin floor. It holds the order and asks you, then cancels before the deadline.' },
  { k: 'Hands-off', t: 'Listings to tracking', d: 'It lists, syncs stock, drafts buyer messages and pushes tracking to eBay. You only step in when a decision is really yours.' },
] as const;

/** First-run splash: a scroll-driven, interactive tour of what Floor does. Shown once per browser, replayable from the sidebar. */
export function WelcomePage() {
  const navigate = useNavigate();
  const enter = () => { markIntroSeen(); navigate('/'); };

  return (
    <div className="relative bg-[#07090F] text-white overflow-x-clip" style={{ backgroundImage: 'radial-gradient(1px 1px at 12% 18%, rgba(255,255,255,.5), transparent), radial-gradient(1px 1px at 78% 8%, rgba(255,255,255,.4), transparent), radial-gradient(1.5px 1.5px at 44% 62%, rgba(180,200,255,.35), transparent), radial-gradient(1px 1px at 90% 74%, rgba(255,255,255,.35), transparent)' }}>
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-5">
        <span className="inline-flex items-center gap-3"><LogoMark size={34} animated /><span className="font-display text-[18px]">Floor</span></span>
        <button type="button" onClick={enter} className="text-[13px] text-white/70 hover:text-white inline-flex items-center gap-1.5">Skip intro <ArrowRight className="h-3.5 w-3.5" aria-hidden /></button>
      </header>

      {/* Hero */}
      <section className="relative min-h-dvh flex items-center justify-center text-center px-6">
        <FloorRain className="absolute inset-0 h-full w-full" />
        <div className="relative z-10 pointer-events-none -mt-[14vh]">
          <p className="text-[12px] tracking-[0.3em] uppercase text-[#8AA2FF] mb-5">Autonomous eBay dropshipping</p>
          <h1 className="font-display text-[44px] sm:text-[72px] md:text-[104px] leading-[0.95] tracking-[-0.03em] bg-gradient-to-b from-white to-[#9FB2FF] bg-clip-text text-transparent">
            Nothing sells<br />below the Floor.
          </h1>
          <p className="mt-6 text-[16px] md:text-[19px] text-white/70 max-w-[44ch] mx-auto">Lists, orders and ships for you, and refuses any sale that would cost you money.</p>
        </div>
        <a href="#how" className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 text-white/60 hover:text-white animate-[floatY_2.4s_ease-in-out_infinite] motion-reduce:animate-none" aria-label="Scroll to how it works"><ChevronDown className="h-7 w-7" /></a>
      </section>

      {/* Rules marquee */}
      <div className="border-y border-white/10 bg-white/[0.03] overflow-hidden py-4" aria-hidden id="how">
        <div className="flex w-max gap-12 animate-[marquee_38s_linear_infinite] motion-reduce:animate-none whitespace-nowrap text-[13px] tracking-[0.18em] uppercase text-white/55">
          {[...RULES, ...RULES, ...RULES, ...RULES].map((r, i) => <span key={i} className="inline-flex items-center gap-12">{r}<span className="text-[#EC695A]">/</span></span>)}
        </div>
      </div>

      {/* Pillars */}
      <section className="px-6 py-28 md:py-40">
        <div className="mx-auto max-w-[1000px]">
          <Reveal><h2 className="font-display text-[30px] md:text-[48px] leading-[1.1] max-w-[18ch]">Built around one line you never cross.</h2></Reveal>
          <div className="mt-12 grid md:grid-cols-3 gap-4">
            {PILLARS.map((p, i) => (
              <Reveal key={p.k} delay={i * 120}>
                <TiltCard className="h-full">
                  <span className="text-[11px] tracking-[0.2em] uppercase text-[#EC695A]">{p.k}</span>
                  <h3 className="font-display text-[20px] mt-3">{p.t}</h3>
                  <p className="text-[14px] leading-relaxed text-white/65 mt-3">{p.d}</p>
                </TiltCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <LadderScroll />
      <TryTheFloor />

      {/* Finale */}
      <section className="relative px-6 py-32 md:py-44 text-center overflow-hidden">
        <div aria-hidden className="absolute left-1/2 top-full -translate-x-1/2 -translate-y-1/2 h-[520px] w-[1100px] rounded-[50%] border-t-[3px] border-[#EC695A] shadow-[0_-30px_120px_rgba(236,105,90,0.35)] bg-[#0B0D14]" />
        <Reveal className="relative">
          <LogoMark size={64} animated className="mx-auto mb-8" />
          <h2 className="font-display text-[34px] md:text-[60px] leading-[1.05]">Ready to stand on it?</h2>
          <p className="text-white/65 mt-4 max-w-[40ch] mx-auto">A short setup, then Floor starts protecting your margin. Everything runs on mock data until you connect eBay.</p>
          <button type="button" onClick={enter} className="mt-9 inline-flex items-center gap-2 rounded-full bg-[#EC695A] hover:bg-[#F27D6F] text-[#1B0E0C] font-semibold px-8 py-4 text-[16px] shadow-[0_0_40px_rgba(236,105,90,0.5)] transition-all hover:scale-[1.04] active:scale-[0.98]">
            Enter Floor <ArrowRight className="h-5 w-5" aria-hidden />
          </button>
          <div className="mt-6"><Link to="/login" onClick={markIntroSeen} className="text-[13px] text-white/50 hover:text-white">Already set up? Sign in</Link></div>
        </Reveal>
      </section>
    </div>
  );
}
