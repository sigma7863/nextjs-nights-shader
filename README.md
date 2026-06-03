# Galaxy Shader

A real-time **WebGPU galaxy shader** built with [Three.js](https://threejs.org)
TSL (Three Shading Language) and [Next.js](https://nextjs.org). It renders a
procedural Milky-Way sky, an interactive hover "fluid", bloom, ordered
dithering, and a DOM-aligned logo-mask reveal — all in a single client
component you can drop into any page.

Originally built as the background for the Next.js Nights landing page,
extracted here as a standalone, reusable component.

---

## Quick start

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

> **Requires a WebGPU-capable browser** (Chrome/Edge 113+, or Safari 18+ /
> Firefox with WebGPU enabled). The shader uses `three/webgpu` — there is no
> WebGL fallback.

Other scripts:

```bash
pnpm build        # production build
pnpm start        # serve the production build
pnpm type-check   # tsc --noEmit
```

---

## How it works

The whole effect lives in [`components/galaxy/galaxy.tsx`](components/galaxy/galaxy.tsx),
a `'use client'` component that owns a `WebGPURenderer` and a hand-rolled
post-processing pipeline. Everything is authored in **TSL** (node-based
shaders), so there is no raw WGSL/GLSL to maintain.

| Stage | What it does |
| ----- | ------------ |
| **Instanced sky** | ~146k stars as camera-facing billboard quads on a sphere centered on the camera. Two `sech²`-biased bands form the Milky Way streak; a uniform field fills the rest of the sky. |
| **3D cluster noise** | Two layers of `mx_fractal_noise_float` sampled per-instance (vertex stage, interpolated as a constant) modulate band-star brightness so the galaxy clumps. |
| **Twinkle** | Per-star sine frequencies combine into a non-periodic brightness envelope; amplitude scales with star size. |
| **Hover fluid** | A semi-Lagrangian density + velocity field, splatted at the cursor and advected each frame in low-res ping-pong render targets. Stars sample the density at their projected screen UV and brighten under the cursor. |
| **Dither** | Luminance is quantized with an ordered Bayer 4×4 matrix, used as a multiplier so colored regions dither into colored dots rather than white. |
| **Logo mask** | An SVG is rasterized to a texture and used as a mask: the red channel brightens the scene in the logo's shape, the green channel paints a white outline. Position + size come from a DOM placeholder, so the mask lands exactly where the page lays out the logo slot. |
| **Bloom** | Bright-pass → separable 9-tap gaussian (half-res) → additive composite, with an edge fade so the canvas blends into the page background. |

The reveal (mask brightening, outline fade-in, bloom ramp) is animated on its
own clock once the post-pipeline's first frames have compiled.

### DOM-driven positioning

The shader doesn't hardcode where the logo goes. The page renders an invisible
placeholder element marked with `data-galaxy-logo-target`, and the component
measures its rect (via `ResizeObserver`) to drive both the mask uniforms and
the camera's off-axis projection offset. Move the placeholder in your layout
and the galaxy follows. See [`app/page.tsx`](app/page.tsx) for the layout
pattern (a fixed "twin" of the placeholder column keeps the logo pinned while
the rest of the page scrolls).

### Debug GUI

Append `?debug` to the URL to load a [lil-gui](https://lil-gui.georgealways.com)
panel with live controls for bloom, dither, the logo mask, particle/cluster
params, twinkle, the hover fluid (including density/velocity buffer
visualizations), camera FOV, and sky generation. `lil-gui` is dynamically
imported, so it never ships in the default bundle.

---

## Project structure

```
app/
  layout.tsx              # fonts (Geist) + root html/body
  page.tsx                # layout skeleton + logo placeholder target
  globals.css             # Tailwind v4 + font wiring + entrance animation
  icon.svg                # favicon (App Router icon convention)
components/galaxy/
  galaxy.tsx              # the shader (renderer, pipeline, animation, GUI)
  rgb-logo.ts             # the SVG mask subject (swap this for your own)
  rasterize-svg-to-texture.ts  # SVG string → DataTexture helper
```

## Using your own logo

Replace the SVG string in [`components/galaxy/rgb-logo.ts`](components/galaxy/rgb-logo.ts).
The mask reads two channels:

- **Red** drives the brightness boost (where the galaxy shows through).
- **Green** drives the white outline highlight.

Use a black background and paint your shape in red (fill) + green (strokes) for
the same look, or tune `logoCurve`, `diagonalBoost`, and the reveal targets in
`galaxy.tsx` (all exposed in the `?debug` GUI) for other source art.

---

## Tech

- **Next.js 16** (App Router, Turbopack)
- **React 19**
- **Three.js 0.184** (`three/webgpu` + `three/tsl`)
- **Tailwind CSS v4**
- **Geist** font

## License

[MIT](LICENSE)
