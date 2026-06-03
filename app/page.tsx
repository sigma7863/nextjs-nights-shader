import type { JSX } from 'react';
import { Galaxy } from '@/components/galaxy/galaxy';
import { rgbLogoSvgString } from '@/components/galaxy/rgb-logo';

const logoSrc = `data:image/svg+xml,${encodeURIComponent(rgbLogoSvgString)}`;

/**
 * Invisible, contain-sized copy of the logo SVG. The galaxy shader never reads
 * pixels from this <img>; it reads the element's *layout rect* (via the
 * `data-galaxy-logo-target` attribute) to drive the mask-reveal position and
 * the camera's off-axis projection offset. Two copies exist:
 *   - the one inside the fixed twin (`withTarget`) is what the shader measures
 *   - the in-flow one (no attribute) only reserves the same row height so the
 *     scrollable column lines up with the fixed twin
 */
function PlaceholderImg({ withTarget }: { withTarget: boolean }): JSX.Element {
  return (
    <img
      {...(withTarget ? { 'data-galaxy-logo-target': '' } : {})}
      aria-hidden
      alt=""
      src={logoSrc}
      className="max-w-full max-h-full opacity-0 max-[740px]:max-h-[40vh]"
    />
  );
}

/**
 * Generic starter content for the right-hand column. Replace this with your own
 * markup — the shader does not depend on anything in here, only on the
 * `[data-galaxy-logo-target]` placeholder above. The staggered entrance
 * (`animate-fade-slide-up` + incremental `animationDelay`) is kept as a layout
 * demonstration.
 */
function MainContent(): JSX.Element {
  const rows = [
    { primary: 'Instanced stars', secondary: 'Billboard quads on a sky sphere' },
    { primary: 'Hover fluid', secondary: 'Semi-Lagrangian density + velocity' },
    { primary: 'Logo mask', secondary: 'DOM-aligned reveal with bloom' },
  ];

  return (
    <div className="flex flex-col justify-center w-full min-[740px]:h-full max-w-md gap-12 mx-auto">
      <h1 className="sr-only">Galaxy Shader</h1>

      <div
        className="grid items-center w-full grid-cols-3 animate-fade-slide-up"
        style={{ animationDelay: '200ms' }}
      >
        <span className="justify-self-start font-mono text-[14px] text-white/40">
          GALAXY SHADER
        </span>
        <svg
          viewBox="0 0 76 65"
          fill="white"
          className="w-8 h-8 justify-self-center"
          aria-label="Mark"
        >
          <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
        </svg>
        <span className="justify-self-end font-mono text-[14px] text-white/40">
          WEBGPU
        </span>
      </div>

      <div className="-mx-3 flex w-[calc(100%+24px)] flex-col gap-2">
        {rows.map((row, index) => (
          <div
            key={row.primary}
            className="flex items-end justify-between w-full px-3 py-3 rounded animate-fade-slide-up"
            style={{ animationDelay: `${275 + index * 75}ms` }}
          >
            <span className="flex flex-col gap-0.5">
              <span className="font-mono text-[14px] font-medium text-white">
                {row.primary}
              </span>
              <span className="font-mono text-[14px] text-white/40">
                {row.secondary}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Page(): JSX.Element {
  return (
    <div className="relative text-white bg-black min-h-lvh">
      {/* Fixed twin: copies ONLY the placeholder column, so its size comes
          straight from the SVG's aspect + padding rather than being stretched
          to match main. Since the twin is fixed, its placeholder column stays
          pinned to the viewport while the in-flow content scrolls underneath.
          Declared FIRST so it paints behind the in-flow content (later siblings
          paint on top in DOM order). */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden>
        <div className="relative flex items-start min-[740px]:items-center h-full max-w-6xl mx-auto">
          <div className="grid w-full grid-cols-1 min-[740px]:grid-cols-2">
            <div className="relative p-4">
              <Galaxy />
              <div className="flex flex-col items-center justify-center w-full h-full max-w-md mx-auto">
                <PlaceholderImg withTarget />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* In-flow structure: defines page height + scrollable layout. The
          placeholder column renders a sizing-only invisible img (no data attr)
          so its row height matches the fixed twin's. */}
      <div className="relative flex items-center max-w-6xl mx-auto min-h-lvh">
        <div className="grid min-h-lvh w-full grid-cols-1 min-[740px]:grid-cols-2 px-8">
          <div className="p-4">
            <div className="flex flex-col items-center justify-center w-full h-full max-w-md mx-auto">
              <PlaceholderImg withTarget={false} />
            </div>
          </div>
          <main className="p-4 min-[740px]:flex min-[740px]:items-center max-[740px]:pb-[40svh]">
            <MainContent />
          </main>
        </div>
      </div>
    </div>
  );
}
