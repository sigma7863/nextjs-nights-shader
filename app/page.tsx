import type { JSX } from 'react';
import { Galaxy } from '@/components/galaxy/galaxy';

export default function Page(): JSX.Element {
  return (
    <main className="relative min-h-lvh bg-black text-white">
      <Galaxy />

      <div className="pointer-events-none fixed inset-x-0 top-0 z-10 flex flex-col gap-1 p-5">
        <h1 className="font-mono text-sm font-semibold tracking-[0.2em] text-white/90">
          STARFARER
        </h1>
        <p className="font-mono text-xs text-white/50">
          Fly through an infinite starfield
        </p>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 p-5 font-mono text-xs text-white/60">
        <span>
          <kbd className="text-white/90">{'\u2191 \u2193'}</kbd> pitch
        </span>
        <span>
          <kbd className="text-white/90">{'\u2190 \u2192'}</kbd> steer
        </span>
        <span>
          <kbd className="text-white/90">Space</kbd> boost
        </span>
      </div>
    </main>
  );
}
