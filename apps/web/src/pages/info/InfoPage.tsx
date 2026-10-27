import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { LogoMark } from '@/components/layout/LogoMark';

/** Shared chrome for the static policy / about pages linked from the splash footer. */
export function InfoPage({ title, updated, draft = true, children }: { title: string; updated?: string; draft?: boolean; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#07090F] text-white/85">
      <header className="flex items-center justify-between px-6 py-5 border-b border-white/10">
        <Link to="/welcome" className="inline-flex items-center gap-3" aria-label="Floor home">
          <LogoMark size={30} />
          <span className="font-display text-[17px] text-white">Floor</span>
        </Link>
        <Link to="/welcome" className="inline-flex items-center gap-1.5 text-[13px] text-white/60 hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back
        </Link>
      </header>

      <main className="mx-auto max-w-[760px] px-6 py-16">
        <h1 className="font-display text-[34px] md:text-[44px] leading-tight text-white">{title}</h1>
        {updated && <p className="text-[13px] text-white/45 mt-2">Last updated {updated}</p>}
        {draft && (
          <div className="mt-5 rounded-lg border border-[#E0A03A]/40 bg-[#E0A03A]/10 px-4 py-3 text-[13.5px] text-[#F3C77A]">
            <strong>Draft.</strong> This is placeholder text, not legal advice. Have a lawyer review it before you rely on it in production.
          </div>
        )}
        <div className="mt-8 flex flex-col gap-5 text-[15px] leading-relaxed text-white/75 [&_h2]:font-display [&_h2]:text-[20px] [&_h2]:text-white [&_h2]:mt-6 [&_a]:text-[#8AA2FF] [&_a]:underline">
          {children}
        </div>
      </main>

      <footer className="border-t border-white/10 px-6 py-8 text-center text-[13px] text-white/40">
        <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2 mb-3" aria-label="Legal">
          <Link to="/about" className="hover:text-white">About</Link>
          <Link to="/privacy" className="hover:text-white">Privacy</Link>
          <Link to="/terms" className="hover:text-white">Terms</Link>
          <Link to="/refund" className="hover:text-white">Refunds</Link>
          <Link to="/cookies" className="hover:text-white">Cookies</Link>
        </nav>
        <p>© {new Date().getFullYear()} Floor. Not affiliated with eBay Inc.</p>
      </footer>
    </div>
  );
}
