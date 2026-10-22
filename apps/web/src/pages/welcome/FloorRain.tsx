import { useEffect, useRef } from 'react';

/** Meteors are orders. Each carries a margin; the glowing horizon is your floor. Drag it to change the floor. */

interface Meteor { x: number; y: number; vy: number; m: number; r: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; hue: 'red' | 'blue' }
interface Ripple { x: number; age: number }
interface Star { x: number; y: number; z: number; tw: number }

const MIN_FRAC = 0.42;
const MAX_FRAC = 0.86;
const MAX_FLOOR_PCT = 0.3;
/** Floor position (fraction of height) <-> margin floor. Higher line = stricter floor. */
const pctFromFrac = (f: number) => Math.round(((MAX_FRAC - f) / (MAX_FRAC - MIN_FRAC)) * MAX_FLOOR_PCT * 100);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function FloorRain({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tallyRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    let w = 0;
    let h = 0;
    let frac = 0.7;
    let dragging = false;
    let hovering = false;
    let mouseX = 0.5;
    let visible = true;
    let raf = 0;
    let last = performance.now();
    let spawnIn = 0;
    let fulfilled = 0;
    let held = 0;
    const meteors: Meteor[] = [];
    const sparks: Spark[] = [];
    const ripples: Ripple[] = [];
    const stars: Star[] = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), z: 0.2 + Math.random() * 0.8, tw: Math.random() * 6.28 }));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const floorY = () => h * frac;
    const floorPct = () => pctFromFrac(frac) / 100;

    const spawn = () => {
      const m = -0.12 + Math.random() * 0.5;
      meteors.push({ x: 20 + Math.random() * (w - 40), y: -20, vy: 120 + Math.random() * 160, m, r: 2 + Math.random() * 2.2 });
    };

    const burst = (x: number, y: number, hue: Spark['hue'], n: number) => {
      for (let i = 0; i < n; i++) {
        const a = Math.PI + Math.random() * Math.PI; // upward fan
        const s = 40 + Math.random() * 160;
        sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, hue });
      }
    };

    const updateTally = () => {
      if (tallyRef.current) tallyRef.current.textContent = `Fulfilled ${fulfilled}  ·  Held ${held}  ·  Floor ${pctFromFrac(frac)}%`;
    };

    const step = (dt: number) => {
      spawnIn -= dt;
      if (spawnIn <= 0) { spawn(); spawnIn = 0.22 + Math.random() * 0.3; }
      const fy = floorY();
      for (let i = meteors.length - 1; i >= 0; i--) {
        const mt = meteors[i];
        if (!mt) continue;
        mt.y += mt.vy * dt;
        if (mt.y >= fy) {
          if (mt.m >= floorPct()) { fulfilled++; ripples.push({ x: mt.x, age: 0 }); burst(mt.x, fy, 'blue', 4); }
          else { held++; burst(mt.x, fy, 'red', 16); }
          meteors.splice(i, 1);
          updateTally();
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        if (!sp) continue;
        sp.x += sp.vx * dt; sp.y += sp.vy * dt; sp.vy += 420 * dt; sp.life -= dt * 1.4;
        if (sp.life <= 0 || sp.y > fy + 4) sparks.splice(i, 1);
      }
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        if (!rp) continue;
        rp.age += dt;
        if (rp.age > 1) ripples.splice(i, 1);
      }
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const fy = floorY();
      // Stars, with a little parallax toward the pointer.
      for (const s of stars) {
        const px = s.x * w + (mouseX - 0.5) * 30 * s.z;
        const a = 0.25 + 0.55 * s.z * (0.6 + 0.4 * Math.sin(t / 700 + s.tw));
        ctx.fillStyle = `rgba(200,215,255,${a.toFixed(3)})`;
        ctx.fillRect(px, s.y * fy * 0.98, s.z * 1.8, s.z * 1.8);
      }
      // The planet beneath the floor: a dark limb with a red rim.
      const g = ctx.createLinearGradient(0, fy, 0, h);
      g.addColorStop(0, 'rgba(60,18,22,0.85)');
      g.addColorStop(1, 'rgba(8,10,16,1)');
      ctx.fillStyle = g;
      ctx.fillRect(0, fy, w, h - fy);
      ctx.save();
      ctx.shadowColor = 'rgba(236,105,90,0.95)';
      ctx.shadowBlur = hovering || dragging ? 34 : 22;
      ctx.strokeStyle = '#EC695A';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(w, fy); ctx.stroke();
      ctx.restore();
      // Drag handle.
      ctx.fillStyle = '#EC695A';
      ctx.beginPath(); ctx.arc(w - 28, fy, dragging ? 9 : 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '600 11px Manrope, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`FLOOR ${pctFromFrac(frac)}%`, w - 44, fy - 10);
      // Ripples where good orders land.
      for (const rp of ripples) {
        ctx.strokeStyle = `rgba(138,162,255,${(1 - rp.age).toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(rp.x, fy, 8 + rp.age * 46, 2 + rp.age * 7, 0, 0, Math.PI * 2); ctx.stroke();
      }
      // Meteors: blue if they will clear the floor, red if they will not.
      const pct = floorPct();
      ctx.textAlign = 'left';
      for (const mt of meteors) {
        const ok = mt.m >= pct;
        const col = ok ? '138,162,255' : '236,105,90';
        const tail = ctx.createLinearGradient(mt.x, mt.y - 60, mt.x, mt.y);
        tail.addColorStop(0, `rgba(${col},0)`);
        tail.addColorStop(1, `rgba(${col},0.85)`);
        ctx.strokeStyle = tail;
        ctx.lineWidth = mt.r;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(mt.x, mt.y - 60); ctx.lineTo(mt.x, mt.y); ctx.stroke();
        ctx.fillStyle = `rgb(${col})`;
        ctx.beginPath(); ctx.arc(mt.x, mt.y, mt.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(${col},0.9)`;
        ctx.font = '600 10px Manrope, system-ui, sans-serif';
        ctx.fillText(`${mt.m >= 0 ? '+' : ''}${Math.round(mt.m * 100)}%`, mt.x + 8, mt.y - 2);
      }
      for (const sp of sparks) {
        ctx.fillStyle = sp.hue === 'red' ? `rgba(255,140,120,${sp.life.toFixed(3)})` : `rgba(170,190,255,${sp.life.toFixed(3)})`;
        ctx.fillRect(sp.x, sp.y, 2, 2);
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible) { last = now; return; }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      step(dt);
      draw(now);
    };

    const setFromPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseX = (e.clientX - rect.left) / Math.max(1, rect.width);
      const y = e.clientY - rect.top;
      hovering = Math.abs(y - floorY()) < 28;
      canvas.style.cursor = hovering || dragging ? 'ns-resize' : 'default';
      if (dragging) {
        frac = clamp(y / h, MIN_FRAC, MAX_FRAC);
        updateTally();
        if (hintRef.current) hintRef.current.style.opacity = '0';
      }
    };
    const onDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (Math.abs(e.clientY - rect.top - floorY()) < 32) { dragging = true; canvas.setPointerCapture(e.pointerId); setFromPointer(e); }
    };
    const onUp = (e: PointerEvent) => { dragging = false; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true; });
    io.observe(canvas);
    canvas.addEventListener('pointermove', setFromPointer);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    updateTally();

    if (reduced) {
      // One still frame: a few meteors mid-fall, no loop.
      for (let i = 0; i < 9; i++) { spawn(); const mt = meteors[i]; if (mt) mt.y = Math.random() * floorY() * 0.9; }
      draw(0);
    } else {
      raf = requestAnimationFrame(frame);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener('pointermove', setFromPointer);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className={className} aria-hidden style={{ touchAction: 'pan-y' }} />
      <div ref={tallyRef} aria-hidden className="pointer-events-none absolute left-4 bottom-4 text-[11px] tracking-[0.14em] uppercase text-white/55 whitespace-pre transition-opacity" />
      <div ref={hintRef} aria-hidden className="pointer-events-none absolute right-4 bottom-4 text-[11px] tracking-[0.14em] uppercase text-white/55 transition-opacity duration-500">Drag the red line</div>
    </>
  );
}
