'use client';

import { useEffect, useRef, type JSX } from 'react';
import * as THREE from 'three/webgpu';
// Type-only import — erased at compile time so the lil-gui package never
// enters the initial page chunk. The actual module is loaded via the
// dynamic import() inside the debug useEffect (a separate lazy chunk).
import type GUIType from 'lil-gui';
import {
  attribute,
  cameraProjectionMatrix,
  exp,
  float,
  int,
  length,
  mix,
  modelViewMatrix,
  mx_fractal_noise_float,
  positionLocal,
  screenDPR,
  screenUV,
  sin,
  texture as tslTexture,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { createSpaceship } from './spaceship';

// ---- Sky (celestial sphere) parameters ----
// All stars live on a sphere centered on the stars camera at the origin.
// Two populations:
//   - band: dense Milky Way streak (sech² latitude bias around galactic equator)
//   - field: uniform sphere distribution (the rest of the night sky)
type SkyParams = {
  bandCount: number;
  fieldCount: number;
  sphereRadius: number;
  bandThickness: number; // sech² scale in radians of latitude
  brightFraction: number; // fraction of stars rendered noticeably larger
  band2Offset: number; // radians of latitude offset for the second parallel band
};

const DEFAULT_PARAMS: SkyParams = {
  bandCount: 70_000,
  fieldCount: 6_000,
  sphereRadius: 300,
  bandThickness: 0.07,
  brightFraction: 0.1,
  band2Offset: -0.175,
};

const BAND_BLUE: [number, number, number] = [0.75, 0.85, 1.0];
const BAND_WHITE: [number, number, number] = [1.0, 0.95, 0.85];
const FIELD_WHITE: [number, number, number] = [0.95, 0.95, 0.95];

function sampleSech2(scale: number): number {
  const u = Math.random();
  const t = Math.max(-0.995, Math.min(0.995, 2 * u - 1));
  return scale * Math.atanh(t);
}

function writeStar(
  i: number,
  positions: Float32Array,
  colors: Float32Array,
  scales: Float32Array,
  flags: Float32Array,
  x: number,
  y: number,
  z: number,
  baseColor: [number, number, number],
  scale: number,
  flag: number,
): void {
  positions[i * 3 + 0] = x;
  positions[i * 3 + 1] = y;
  positions[i * 3 + 2] = z;
  const cv = 0.85 + Math.random() * 0.3;
  colors[i * 3 + 0] = baseColor[0] * cv;
  colors[i * 3 + 1] = baseColor[1] * cv;
  colors[i * 3 + 2] = baseColor[2] * cv;
  scales[i] = scale;
  flags[i] = flag;
}

function pickStarScale(p: SkyParams, base: number, range: number): number {
  if (Math.random() < p.brightFraction) {
    // A handful of bright "foreground" stars per generation.
    return 1.8 + Math.random() * 2.2;
  }
  return base + Math.random() * range;
}

// Per-star twinkle is driven by two static random sine frequencies. Picking
// frequencies in this range (rad/sec, since the shader does sin(time * freq))
// yields beat envelopes in the ~1.5–4 s window — slow enough to feel like
// real stars, not flicker. The two-sine product creates a non-periodic
// envelope per star with no extra runtime cost beyond two sin() calls.
const TWINKLE_FREQ_MIN = 1.5;
const TWINKLE_FREQ_MAX = 10.0;

function buildSkyAttributes(p: SkyParams): {
  positions: Float32Array;
  colors: Float32Array;
  scales: Float32Array;
  flags: Float32Array;
  twinkles: Float32Array;
} {
  // Two bands of bandCount stars each, plus the diffuse field.
  const N = p.bandCount * 2 + p.fieldCount;
  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  const scales = new Float32Array(N);
  // flags[i] = 1.0 for band stars (cluster noise modulates them),
  //          = 0.0 for field stars (always full opacity).
  const flags = new Float32Array(N);
  // twinkles[i*2..i*2+1] = two static random sine frequencies per star.
  const twinkles = new Float32Array(N * 2);
  const R = p.sphereRadius;

  let idx = 0;

  // Generates one band centered on a given latitude offset. Reused for both
  // the primary band (offset = 0) and the secondary parallel band.
  const writeBand = (latitudeOffset: number): void => {
    for (let i = 0; i < p.bandCount; i++) {
      const b = sampleSech2(p.bandThickness) + latitudeOffset; // latitude (rad)
      const l = Math.random() * Math.PI * 2; // longitude (rad)
      const cosB = Math.cos(b);
      const sinB = Math.sin(b);
      const x = R * cosB * Math.cos(l);
      const y = R * sinB;
      const z = R * cosB * Math.sin(l);
      const color = Math.random() < 0.3 ? BAND_BLUE : BAND_WHITE;
      writeStar(
        idx++,
        positions,
        colors,
        scales,
        flags,
        x,
        y,
        z,
        color,
        pickStarScale(p, 0.4, 0.55),
        1,
      );
    }
  };

  // Primary band — sech² latitude bias around the y=0 plane.
  writeBand(0);
  // Secondary band — same density and thickness, shifted in latitude.
  writeBand(p.band2Offset);

  // Field — uniform on the unit sphere.
  for (let i = 0; i < p.fieldCount; i++) {
    const phi = Math.random() * Math.PI * 2;
    const cosTheta = Math.random() * 2 - 1;
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const x = R * sinTheta * Math.cos(phi);
    const y = R * cosTheta;
    const z = R * sinTheta * Math.sin(phi);
    const color = Math.random() < 0.15 ? BAND_BLUE : FIELD_WHITE;
    writeStar(
      idx++,
      positions,
      colors,
      scales,
      flags,
      x,
      y,
      z,
      color,
      pickStarScale(p, 0.35, 0.5),
      0,
    );
  }

  const freqRange = TWINKLE_FREQ_MAX - TWINKLE_FREQ_MIN;
  for (let i = 0; i < N; i++) {
    twinkles[i * 2 + 0] = TWINKLE_FREQ_MIN + Math.random() * freqRange;
    twinkles[i * 2 + 1] = TWINKLE_FREQ_MIN + Math.random() * freqRange;
  }

  return { positions, colors, scales, flags, twinkles };
}

// Separable 9-tap gaussian — symmetric, 5 unique samples.
const GAUSS_OFFSETS = [0, 1.3846153846, 3.2307692308];
const GAUSS_WEIGHTS = [0.227027027, 0.3162162162, 0.0702702703];

// ---- TSL uniforms (module scope) ----
// Lifted out of the scene useEffect so the optional debug-GUI effect can
// bind sliders directly to `.value`. Vector2 uniforms have placeholder
// initial values; the scene effect overwrites them once it knows canvas
// dimensions. Stable across HMR since module identity is preserved.
const pointSize = uniform(2.3);
// tan(fov/2) — kept in sync with the camera's FOV (default 75°). Used to
// clamp the on-screen pixel footprint of each billboard.
const halfFovTan = uniform(Math.tan((75 * Math.PI) / 180 / 2));
const maxParticlePixels = uniform(5.5);
const clusterScale = uniform(0.03);
const clusterContrast = uniform(1.43);
const clusterStrength = uniform(0.57);
// Secondary cluster layer — same recipe, independent uniforms. Defaults are
// tuned so it reads as a finer-grained embellishment on top of the primary:
// double the scale (~half the feature size), matched contrast as a sensible
// starting point, and a lower strength so it doesn't dominate the primary.
const clusterScale2 = uniform(0.109);
const clusterContrast2 = uniform(1.28);
const clusterStrength2 = uniform(0.83);
// Multiplies brightness ONLY for field stars (aInstanceFlag = 0). Band
// stars (aInstanceFlag = 1) are unaffected. 1 = current behavior, 0 =
// field stars fully hidden, >1 = boosted.
const fieldStrength = uniform(0.8);
// ---- Hover/density highlight system ----
// Mouse hover writes into two low-res buffers per frame:
//   - density: a scalar field splatted with a gaussian at the cursor
//   - velocity: a vec2 field splatted with mouse delta per frame
// The density update samples its previous frame at `uv - velocity * dt`
// (semi-Lagrangian advection), decays, then adds the new splat. The
// density texture is sampled in the star vertex shader at each star's
// projected screen UV — non-zero density boosts brightness.
// Hover sim runs at this fraction of the canvas device-pixel resolution.
const HOVER_DPR = 0.5;
type DebugView =
  | 'off'
  | 'density'
  | 'densityCopy'
  | 'velocity'
  | 'velocityCopy';
const mousePos = uniform(new THREE.Vector2(-1, -1)); // UV; -1 = off-screen / no splat
const mouseVel = uniform(new THREE.Vector2(0, 0));
const splatRadius = uniform(0.08); // gaussian sigma in UV space
const splatStrength = uniform(20);
const densityDecay = uniform(0.985);
// Lower velocity magnitudes + small advection step keep the wake sub-pixel
// per frame. Large steps sample outside the splat where the field is ~0, so
// linear filtering rapidly dilutes the field even with decay near 1.
const velocitySplatStrength = uniform(2.0);
const velocityDecay = uniform(0.99);
const advectionStrength = uniform(0.05);
const hoverStrength = uniform(1.0);
// Canvas aspect (width/height). Applied to the splat-distance x-axis so a
// circular splat stays circular on non-square canvases.
const hoverAspect = uniform(1.0);
// Twinkle — only the ~10% of stars flagged via aInstanceBlink respond.
// `strength` is the max brightness reduction at the noise trough; `speed`
// drifts each star's noise sample point through time. Deliberately gentle
// defaults so the effect reads as subtle blinking, not jitter.
const uTime = uniform(0);
const twinkleStrength = uniform(0.4);
const twinkleSpeed = uniform(0.42);
const resolution = uniform(new THREE.Vector2(1, 1));
const bloomThreshold = uniform(0);
const bloomStrength = uniform(0);
// Bloom intensity fade-in. The reveal clock (started after a short warmup so
// the first cold shader compiles don't eat the animation) ramps bloomStrength
// from 0 up to its target. `revealTargets.bloomStrength` is the source of
// truth the debug GUI binds to; the animate loop assigns `target * t`.
const BLOOM_REVEAL_DURATION_MS = 1000;
const BLOOM_REVEAL_DELAY_MS = 1000;
// Number of render frames to discard before the reveal clock starts. The
// first frame triggers all the lazy shader compiles for the post pipeline
// (which can block the GPU for hundreds of ms on a cold load); the second
// gives a buffer for any straggling compile or driver warm-up.
const REVEAL_WARMUP_FRAMES = 2;
const revealTargets = {
  bloomStrength: 0.2,
};
const texelH = uniform(new THREE.Vector2(1, 0));
const texelV = uniform(new THREE.Vector2(0, 1));
const ditherLevels = uniform(2.0);
const ditherScale = uniform(3.0);
const ditherExposure = uniform(4.0);
const ditherStrength = uniform(1.0); // 0 = bypass, 1 = full ordered dither

// Refs exposed by the scene useEffect for the debug GUI to bind against.
type SceneHandles = {
  camera: THREE.PerspectiveCamera;
  sky: THREE.Mesh;
  params: SkyParams;
  regenerateSky: () => void;
  hoverDebug: { mode: DebugView };
  flight: { baseSpeed: number; boostSpeed: number };
};

// Frame-rate independent smoothing factor. `rate` is the fraction of the
// remaining gap closed per second-ish; larger = snappier.
function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export function Galaxy(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandles | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ---- Main scene (ship + lights). The starfield is NOT in here — it
    // lives in its own scene rendered to a background FBO so it can read as
    // infinitely distant (see starsScene / starsCamera below).
    const scene = new THREE.Scene();

    // Main camera — chases the ship. Its position tracks the ship through the
    // world; its rotation/FOV are mirrored onto the stars camera each frame.
    const camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000,
    );

    // ---- Stars scene + stars camera ----
    // The stars camera sits permanently at the origin. Each frame we copy the
    // MAIN camera's rotation (quaternion) and FOV onto it, but never its
    // position. Rendering the celestial sphere (centered on the origin) from a
    // fixed point that only rotates makes the stars feel infinitely far away:
    // they swing with where you look, but flying around never parallaxes them.
    const starsScene = new THREE.Scene();
    starsScene.background = new THREE.Color(0x000000);
    const starsCamera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000,
    );
    starsCamera.position.set(0, 0, 0);

    const renderer = new THREE.WebGPURenderer({
      antialias: true,
    });
    renderer.setClearColor(0x000000, 1);
    const dpr = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(dpr);
    // On 1x DPR the default 3-pixel dither block looks chunky; collapse to
    // 1 so the dither matches the per-pixel grid users see on hi-DPI screens.
    if (dpr === 1) ditherScale.value = 1;
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    const initPromise = renderer.init();

    // ---- Lighting for the ship ----
    const ambient = new THREE.AmbientLight(0x8899bb, 1.1);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(3, 5, 2);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x4477ff, 1.4);
    rimLight.position.set(-4, -2, -3);
    scene.add(rimLight);

    // ---- Spaceship (procedural geometry) ----
    const ship = createSpaceship();
    scene.add(ship.root);

    // ---- Hover/density buffers ----
    const hoverW = (): number =>
      Math.max(1, Math.floor(container.clientWidth * dpr * HOVER_DPR));
    const hoverH = (): number =>
      Math.max(1, Math.floor(container.clientHeight * dpr * HOVER_DPR));
    const densityRTOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RedFormat,
      depthBuffer: false,
      colorSpace: THREE.NoColorSpace,
    } as const;
    const velocityRTOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGFormat,
      depthBuffer: false,
      colorSpace: THREE.NoColorSpace,
    } as const;
    const densityRT = new THREE.RenderTarget(
      hoverW(),
      hoverH(),
      densityRTOptions,
    );
    const densityCopy = new THREE.RenderTarget(
      hoverW(),
      hoverH(),
      densityRTOptions,
    );
    const velocityRT = new THREE.RenderTarget(
      hoverW(),
      hoverH(),
      velocityRTOptions,
    );
    const velocityCopy = new THREE.RenderTarget(
      hoverW(),
      hoverH(),
      velocityRTOptions,
    );

    // Shared resolution uniform (device pixels). Updated on resize.
    const fullW = (): number => Math.floor(container.clientWidth * dpr);
    const fullH = (): number => Math.floor(container.clientHeight * dpr);
    const halfW = (): number => Math.max(1, Math.floor(fullW() / 2));
    const halfH = (): number => Math.max(1, Math.floor(fullH() / 2));
    resolution.value.set(fullW(), fullH());
    halfFovTan.value = Math.tan((camera.fov * Math.PI) / 180 / 2);
    hoverAspect.value =
      container.clientHeight > 0
        ? container.clientWidth / container.clientHeight
        : 1;

    // ---- Sky stars — instanced billboard quads ----
    const params: SkyParams = { ...DEFAULT_PARAMS };

    const quadGeometry = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quadGeometry.index;
    geometry.setAttribute('position', quadGeometry.attributes.position);
    geometry.setAttribute('uv', quadGeometry.attributes.uv);
    quadGeometry.dispose();

    // Repopulates the instanced buffers from `params`.
    const regenerateSky = (): void => {
      const { positions, colors, scales, flags, twinkles } =
        buildSkyAttributes(params);
      const count = positions.length / 3;
      geometry.setAttribute(
        'aInstancePosition',
        new THREE.InstancedBufferAttribute(positions, 3),
      );
      geometry.setAttribute(
        'aInstanceColor',
        new THREE.InstancedBufferAttribute(colors, 3),
      );
      geometry.setAttribute(
        'aInstanceScale',
        new THREE.InstancedBufferAttribute(scales, 1),
      );
      geometry.setAttribute(
        'aInstanceFlag',
        new THREE.InstancedBufferAttribute(flags, 1),
      );
      geometry.setAttribute(
        'aInstanceTwinkle',
        new THREE.InstancedBufferAttribute(twinkles, 2),
      );
      geometry.instanceCount = count;
      geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(),
        params.sphereRadius * 1.1,
      );
    };
    regenerateSky();

    const material = new THREE.NodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    // ---- Billboard vertex ----
    const instPos = attribute('aInstancePosition', 'vec3' as const);
    const instColor = attribute('aInstanceColor', 'vec3' as const);
    const instFlag = attribute('aInstanceFlag', 'float' as const); // 1 = band, 0 = field/bulge
    const instTwinkle = attribute('aInstanceTwinkle', 'vec2' as const); // per-star sine freqs
    const instSizeAttr = attribute('aInstanceScale', 'float' as const);
    const desiredScale = instSizeAttr.mul(pointSize);

    const viewInstance = modelViewMatrix.mul(vec4(instPos, 1));
    // Distance from camera in view space (positive in front of the camera).
    const viewDist = viewInstance.z.negate().max(0.001);
    // World-units-per-pixel at this depth. Clamp our world-space scale so the
    // projected on-screen size never exceeds `maxParticlePixels` device pixels.
    const maxPixelsDevice = maxParticlePixels.mul(screenDPR);
    const maxWorldSize = maxPixelsDevice
      .mul(2)
      .mul(viewDist)
      .mul(halfFovTan)
      .div(resolution.y);
    const instScale = desiredScale.min(maxWorldSize);

    const viewOffset = vec4(
      positionLocal.x.mul(instScale),
      positionLocal.y.mul(instScale),
      0,
      0,
    );
    const projectedClip = cameraProjectionMatrix.mul(
      viewInstance.add(viewOffset),
    );
    material.vertexNode = projectedClip;

    // ---- Per-instance 3D cluster noise (vertex-stage only) ----
    const clusterNoise = mx_fractal_noise_float(
      instPos.mul(clusterScale),
      int(3),
      float(2),
      float(0.5),
    )
      .add(1)
      .mul(0.5);
    const shapedCluster = clusterNoise.pow(clusterContrast).clamp(0, 1);
    const clusterMul = mix(
      float(1),
      shapedCluster,
      clusterStrength.mul(instFlag),
    );

    // ---- Per-instance 3D cluster noise — secondary layer ----
    const clusterNoise2 = mx_fractal_noise_float(
      instPos.mul(clusterScale2),
      int(3),
      float(2),
      float(0.5),
    )
      .add(1)
      .mul(0.5);
    const shapedCluster2 = clusterNoise2.pow(clusterContrast2).clamp(0, 1);
    const clusterMul2 = mix(
      float(1),
      shapedCluster2,
      clusterStrength2.mul(instFlag),
    );

    // ---- Per-instance twinkle (vertex-stage, animated) ----
    const phasedTime = uTime.mul(twinkleSpeed);
    const sineA = sin(
      phasedTime.mul(instTwinkle.x).add(instTwinkle.x.mul(13.7)),
    );
    const sineB = sin(
      phasedTime.mul(instTwinkle.y).add(instTwinkle.y.mul(7.3)),
    );
    const freqC = instTwinkle.x.mul(instTwinkle.y).mul(0.1);
    const sineC = sin(phasedTime.mul(freqC).add(freqC.mul(3.1)));
    const turbulent = sineA.add(sineB.mul(0.5)).add(sineC.mul(0.2));
    const twinkle01 = turbulent
      .mul(1 / 3.4)
      .add(0.5)
      .clamp(0.3, 1);
    const effectiveTwinkleStrength = twinkleStrength
      .mul(instSizeAttr)
      .clamp(0, 1);
    const twinkleMul = float(1).sub(
      effectiveTwinkleStrength.mul(twinkle01.oneMinus()),
    );

    // Per-star multiplier driven by fieldStrength. instFlag=0 (field) →
    // fieldStrength; instFlag=1 (band) → 1.0. Leaves band brightness alone.
    const fieldMul = mix(fieldStrength, float(1), instFlag);

    // ---- Hover density boost (vertex-stage sample) ----
    const ndcXY = projectedClip.xy.div(projectedClip.w);
    const hoverScreenUV = ndcXY.mul(0.5).add(0.5);
    const hoverDensity = tslTexture(densityRT.texture, hoverScreenUV).r;
    const hoverMul = float(1).add(hoverDensity.mul(hoverStrength));

    const brightnessVarying = varying(
      clusterMul.mul(clusterMul2).mul(twinkleMul).mul(fieldMul).mul(hoverMul),
    );

    // ---- Radial gradient fragment (additive), modulated by cluster mask ----
    const r = length(uv().sub(0.5)).mul(2); // 0 center → 1 at edge of inscribed circle
    const falloff = r.oneMinus().max(0).pow(2);
    material.colorNode = vec4(instColor.mul(falloff).mul(brightnessVarying), 1);

    const sky = new THREE.Mesh(geometry, material);
    sky.frustumCulled = false; // billboards' projected bounds aren't trivial
    sky.rotation.z = -0.47;
    sky.rotation.x = 0.43;
    sky.rotation.y = 0;
    starsScene.add(sky);

    // Publish handles for the debug useEffect.
    const hoverDebug: { mode: DebugView } = { mode: 'off' };
    const flight = { baseSpeed: 9, boostSpeed: 26 };
    sceneRef.current = {
      camera,
      sky,
      params,
      regenerateSky,
      hoverDebug,
      flight,
    };

    // ---- Custom postprocessing pipeline ----
    // starsRT holds the infinitely-distant starfield (rendered with the
    // stars camera). The main scene then uses it as its background via a TSL
    // backgroundNode, so the ship composites on top with proper depth.
    const starsRT = new THREE.RenderTarget(fullW(), fullH(), {
      type: THREE.HalfFloatType,
      depthBuffer: false,
    });
    scene.backgroundNode = tslTexture(starsRT.texture, screenUV);

    const sceneRT = new THREE.RenderTarget(fullW(), fullH(), {
      type: THREE.HalfFloatType,
      depthBuffer: true,
    });
    const ditheredRT = new THREE.RenderTarget(fullW(), fullH(), {
      type: THREE.HalfFloatType,
      depthBuffer: false,
    });
    const brightRT = new THREE.RenderTarget(halfW(), halfH(), {
      type: THREE.HalfFloatType,
      depthBuffer: false,
    });
    const blurHRT = new THREE.RenderTarget(halfW(), halfH(), {
      type: THREE.HalfFloatType,
      depthBuffer: false,
    });
    const blurVRT = new THREE.RenderTarget(halfW(), halfH(), {
      type: THREE.HalfFloatType,
      depthBuffer: false,
    });

    texelH.value.set(1 / halfW(), 0);
    texelV.value.set(0, 1 / halfH());

    // Ordered Bayer 4x4 dither matrix as a 4x4 R8 texture (REPEAT + NEAREST).
    const BAYER_4X4_VALUES = [
      0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5,
    ];
    const bayerBuffer = new Uint8Array(BAYER_4X4_VALUES.length);
    for (let i = 0; i < BAYER_4X4_VALUES.length; i++) {
      bayerBuffer[i] = Math.round(((BAYER_4X4_VALUES[i] + 0.5) / 16) * 255);
    }
    const bayerTexture = new THREE.DataTexture(
      bayerBuffer,
      4,
      4,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    bayerTexture.magFilter = THREE.NearestFilter;
    bayerTexture.minFilter = THREE.NearestFilter;
    bayerTexture.wrapS = THREE.RepeatWrapping;
    bayerTexture.wrapT = THREE.RepeatWrapping;
    bayerTexture.needsUpdate = true;

    // ---- Dither pass — desaturates to luminance and applies ordered (Bayer 4x4)
    // dithering. Quantizes to N levels per channel with a per-pixel threshold
    // sampled from the bayer texture (NEAREST + REPEAT auto-tiles the 4x4 cell).
    const ditherMat = new THREE.NodeMaterial();
    {
      const pixelCoord = uv().mul(resolution);
      const blockIndex = pixelCoord.div(ditherScale).floor();
      const blockCenterUV = blockIndex
        .add(0.5)
        .mul(ditherScale)
        .div(resolution);

      const sceneSample = tslTexture(sceneRT.texture, blockCenterUV);
      const lum = sceneSample.r
        .mul(0.2126)
        .add(sceneSample.g.mul(0.7152))
        .add(sceneSample.b.mul(0.0722))
        .mul(ditherExposure);

      const bayerUV = blockIndex.add(0.5).div(4);
      const threshold = tslTexture(bayerTexture, bayerUV).r;

      const levelsMinus1 = ditherLevels.sub(1);
      const sLum = lum.mul(levelsMinus1);
      const lower = sLum.floor();
      const frac = sLum.sub(lower);
      const upperContribution = frac
        .sub(threshold)
        .div(threshold.oneMinus())
        .max(0);
      const quantized = lower.add(upperContribution).div(levelsMinus1);

      const dithered = sceneSample.rgb.mul(quantized);
      const out = mix(sceneSample.rgb, dithered, ditherStrength);
      ditherMat.colorNode = vec4(out, 1);
    }

    let running = true;

    type PostQuads = {
      brightQuad: THREE.QuadMesh;
      blurHQuad: THREE.QuadMesh;
      blurVQuad: THREE.QuadMesh;
      composeQuad: THREE.QuadMesh;
    };
    type PostMats = {
      brightMat: THREE.NodeMaterial;
      blurHMat: THREE.NodeMaterial;
      blurVMat: THREE.NodeMaterial;
      composeMat: THREE.NodeMaterial;
    };
    let postQuads: PostQuads | null = null;
    let postMats: PostMats | null = null;

    const ditherQuad = new THREE.QuadMesh(ditherMat);

    // The reveal clock only starts after REVEAL_WARMUP_FRAMES have rendered.
    let revealStart: number | null = null;
    let renderedFrames = 0;

    // ---- Hover update materials ----
    const densityCopyMat = new THREE.NodeMaterial();
    densityCopyMat.fragmentNode = vec4(
      tslTexture(densityRT.texture, uv()).r,
      0,
      0,
      1,
    );
    densityCopyMat.toneMapped = false;

    const velocityCopyMat = new THREE.NodeMaterial();
    velocityCopyMat.fragmentNode = vec4(
      tslTexture(velocityRT.texture, uv()).rg,
      0,
      1,
    );
    velocityCopyMat.toneMapped = false;

    const splatDelta = uv().sub(mousePos);
    const splatDeltaSquare = vec2(splatDelta.x.mul(hoverAspect), splatDelta.y);
    const splatGaussian = length(splatDeltaSquare)
      .div(splatRadius)
      .pow(2)
      .negate();

    const velocityUpdateMat = new THREE.NodeMaterial();
    velocityUpdateMat.toneMapped = false;
    {
      const velAtUV = tslTexture(velocityCopy.texture, uv()).rg;
      const advectionUV = uv().sub(velAtUV.mul(advectionStrength));
      const advectedVel = tslTexture(velocityCopy.texture, advectionUV).rg;
      const decayedVel = advectedVel.mul(velocityDecay);
      const g = exp(splatGaussian);
      const velSplat = mouseVel.mul(velocitySplatStrength).mul(g);
      velocityUpdateMat.fragmentNode = vec4(decayedVel.add(velSplat), 0, 1);
    }

    const densityUpdateMat = new THREE.NodeMaterial();
    densityUpdateMat.toneMapped = false;
    {
      const velAtUV = tslTexture(velocityCopy.texture, uv()).rg;
      const advectionUV = uv().sub(velAtUV.mul(advectionStrength));
      const advectedDensity = tslTexture(densityCopy.texture, advectionUV).r;
      const decayedDensity = advectedDensity.mul(densityDecay);
      const g = exp(splatGaussian);
      const motionAmount = length(mouseVel);
      const splatContrib = g.mul(splatStrength).mul(motionAmount);
      densityUpdateMat.fragmentNode = vec4(
        decayedDensity.add(splatContrib),
        0,
        0,
        1,
      );
    }

    const densityCopyQuad = new THREE.QuadMesh(densityCopyMat);
    const densityUpdateQuad = new THREE.QuadMesh(densityUpdateMat);
    const velocityCopyQuad = new THREE.QuadMesh(velocityCopyMat);
    const velocityUpdateQuad = new THREE.QuadMesh(velocityUpdateMat);

    // Debug visualization quads — one per hover RT.
    const debugMats: THREE.NodeMaterial[] = [];
    const makeDensityDebugQuad = (rt: THREE.RenderTarget): THREE.QuadMesh => {
      const mat = new THREE.NodeMaterial();
      const d = tslTexture(rt.texture, uv()).r.clamp(0, 1);
      mat.colorNode = vec4(d, d, d, 1);
      debugMats.push(mat);
      return new THREE.QuadMesh(mat);
    };
    const makeVelocityDebugQuad = (rt: THREE.RenderTarget): THREE.QuadMesh => {
      const mat = new THREE.NodeMaterial();
      const v = tslTexture(rt.texture, uv()).rg.mul(0.5).add(0.5).clamp(0, 1);
      mat.colorNode = vec4(v.x, v.y, 0.5, 1);
      debugMats.push(mat);
      return new THREE.QuadMesh(mat);
    };
    const debugQuads = {
      density: makeDensityDebugQuad(densityRT),
      densityCopy: makeDensityDebugQuad(densityCopy),
      velocity: makeVelocityDebugQuad(velocityRT),
      velocityCopy: makeVelocityDebugQuad(velocityCopy),
    };

    // Clear all four hover RTs to black once after the renderer is ready.
    const clearMat = new THREE.NodeMaterial();
    clearMat.colorNode = vec4(0, 0, 0, 1);
    clearMat.toneMapped = false;
    const clearQuad = new THREE.QuadMesh(clearMat);
    let hoverCleared = false;
    const clearHoverBuffers = (): void => {
      if (hoverCleared) return;
      for (const rt of [densityRT, densityCopy, velocityRT, velocityCopy]) {
        renderer.setRenderTarget(rt);
        clearQuad.render(renderer);
      }
      hoverCleared = true;
    };

    // ---- Mouse tracking for hover splat ----
    const pendingMouseDelta = { x: 0, y: 0 };
    let lastMouseUV: { x: number; y: number } | null = null;
    const handleMouseMove = (event: MouseEvent): void => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const u = (event.clientX - rect.left) / rect.width;
      const v = 1 - (event.clientY - rect.top) / rect.height;
      if (lastMouseUV) {
        pendingMouseDelta.x += u - lastMouseUV.x;
        pendingMouseDelta.y += v - lastMouseUV.y;
      }
      mousePos.value.set(u, v);
      lastMouseUV = { x: u, y: v };
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    // ---- Keyboard flight controls ----
    // Arrow keys steer (auto-forward flight model): Up/Down pitch the nose,
    // Left/Right yaw. Space boosts. We swallow the default scroll behavior on
    // these keys so the page doesn't jump while flying.
    const keys = { up: false, down: false, left: false, right: false, boost: false };
    const setKey = (code: string, down: boolean): boolean => {
      switch (code) {
        case 'ArrowUp':
        case 'KeyW':
          keys.up = down;
          return true;
        case 'ArrowDown':
        case 'KeyS':
          keys.down = down;
          return true;
        case 'ArrowLeft':
        case 'KeyA':
          keys.left = down;
          return true;
        case 'ArrowRight':
        case 'KeyD':
          keys.right = down;
          return true;
        case 'Space':
          keys.boost = down;
          return true;
        default:
          return false;
      }
    };
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (setKey(e.code, true)) e.preventDefault();
    };
    const handleKeyUp = (e: KeyboardEvent): void => {
      if (setKey(e.code, false)) e.preventDefault();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // ---- Flight state ----
    const YAW_RATE = 1.1; // rad/sec at full deflection
    const PITCH_RATE = 0.9;
    let currentSpeed = flight.baseSpeed;

    // Seed the chase camera behind the ship so frame 1 doesn't snap.
    const camOffset = new THREE.Vector3(0, 1.5, 7);
    const tmpVec = new THREE.Vector3();
    ship.root.updateMatrixWorld(true);
    camera.position.copy(ship.root.localToWorld(tmpVec.copy(camOffset)));
    camera.quaternion.copy(ship.root.quaternion);
    camera.updateMatrixWorld(true);

    let lastTime = performance.now();

    const updateFlight = (dt: number): void => {
      const yaw = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
      const pitch = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);

      // Steer in the ship's local frame so heading accumulates naturally.
      if (yaw !== 0) ship.root.rotateY(yaw * YAW_RATE * dt);
      if (pitch !== 0) ship.root.rotateX(pitch * PITCH_RATE * dt);

      // Auto-forward: always cruise along local -Z; boost lifts the speed.
      const targetSpeed = keys.boost ? flight.boostSpeed : flight.baseSpeed;
      currentSpeed += (targetSpeed - currentSpeed) * damp(3, dt);
      ship.root.translateZ(-currentSpeed * dt);

      // Visual bank — roll the model (not the heading) into the turn.
      const targetRoll = -yaw * 0.5;
      ship.model.rotation.z +=
        (targetRoll - ship.model.rotation.z) * damp(6, dt);

      // Exhaust flare follows the boost.
      const targetGlow = keys.boost ? 3.0 : 1.0;
      ship.engineGlow.value +=
        (targetGlow - ship.engineGlow.value) * damp(8, dt);

      ship.root.updateMatrixWorld(true);

      // ---- Chase camera ----
      const desiredPos = ship.root.localToWorld(tmpVec.copy(camOffset));
      camera.position.lerp(desiredPos, damp(5, dt));
      // Match the ship's orientation so we look down the nose; this also makes
      // yaw/pitch sweep the starfield (the stars camera mirrors this rotation).
      camera.quaternion.slerp(ship.root.quaternion, damp(6, dt));
      camera.updateMatrixWorld(true);

      // ---- Stars camera: copy rotation + FOV, NEVER position ----
      starsCamera.quaternion.copy(camera.quaternion);
      if (starsCamera.fov !== camera.fov) {
        starsCamera.fov = camera.fov;
        starsCamera.updateProjectionMatrix();
      }
      starsCamera.updateMatrixWorld(true);
    };

    const animate = (): void => {
      if (!running || !postQuads) return;

      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      renderedFrames++;
      if (revealStart === null && renderedFrames > REVEAL_WARMUP_FRAMES) {
        revealStart = now;
      }
      const elapsedMs = revealStart === null ? 0 : now - revealStart;

      uTime.value = now * 0.001;

      // bloomStrength fades in linearly on its own clock.
      const tBloom = Math.min(
        Math.max(elapsedMs - BLOOM_REVEAL_DELAY_MS, 0) /
          BLOOM_REVEAL_DURATION_MS,
        1,
      );
      bloomStrength.value = revealTargets.bloomStrength * tBloom;

      // Advance the ship + cameras before any rendering.
      updateFlight(dt);

      // Hover update — runs every frame before the scene renders.
      clearHoverBuffers();
      mouseVel.value.set(pendingMouseDelta.x, pendingMouseDelta.y);
      pendingMouseDelta.x = 0;
      pendingMouseDelta.y = 0;
      renderer.setRenderTarget(velocityCopy);
      velocityCopyQuad.render(renderer);
      renderer.setRenderTarget(velocityRT);
      velocityUpdateQuad.render(renderer);
      renderer.setRenderTarget(densityCopy);
      densityCopyQuad.render(renderer);
      renderer.setRenderTarget(densityRT);
      densityUpdateQuad.render(renderer);

      // Stars → background FBO, rendered from the origin-locked stars camera.
      renderer.setRenderTarget(starsRT);
      renderer.render(starsScene, starsCamera);

      // Main scene (stars background + ship) with the chase camera.
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);

      renderer.setRenderTarget(ditheredRT);
      ditherQuad.render(renderer);

      renderer.setRenderTarget(brightRT);
      postQuads.brightQuad.render(renderer);

      renderer.setRenderTarget(blurHRT);
      postQuads.blurHQuad.render(renderer);

      renderer.setRenderTarget(blurVRT);
      postQuads.blurVQuad.render(renderer);

      renderer.setRenderTarget(null);
      if (hoverDebug.mode === 'off') {
        postQuads.composeQuad.render(renderer);
      } else {
        debugQuads[hoverDebug.mode].render(renderer);
      }

      requestAnimationFrame(animate);
    };

    initPromise.then(() => {
      if (!running) return;

      // Bloom prefilter — threshold the dithered scene to isolate highlights.
      const brightMat = new THREE.NodeMaterial();
      {
        const c = tslTexture(ditheredRT.texture, uv());
        const lum = c.r.mul(0.2126).add(c.g.mul(0.7152)).add(c.b.mul(0.0722));
        const factor = lum.sub(bloomThreshold).max(0).div(lum.add(0.0001));
        brightMat.colorNode = vec4(c.rgb.mul(factor), 1);
      }

      // Separable 9-tap gaussian — symmetric, 5 unique samples.
      const buildBlurColor = (
        rtTexture: THREE.Texture,
        texelOffset: typeof texelH,
      ): ReturnType<typeof vec4> => {
        const baseUV = uv();
        let sum = tslTexture(rtTexture, baseUV).rgb.mul(GAUSS_WEIGHTS[0]);
        for (let i = 1; i < GAUSS_OFFSETS.length; i++) {
          const offset = texelOffset.mul(GAUSS_OFFSETS[i]);
          sum = sum
            .add(
              tslTexture(rtTexture, baseUV.add(offset)).rgb.mul(
                GAUSS_WEIGHTS[i],
              ),
            )
            .add(
              tslTexture(rtTexture, baseUV.sub(offset)).rgb.mul(
                GAUSS_WEIGHTS[i],
              ),
            );
        }
        return vec4(sum, 1);
      };

      const blurHMat = new THREE.NodeMaterial();
      blurHMat.colorNode = buildBlurColor(brightRT.texture, texelH);

      const blurVMat = new THREE.NodeMaterial();
      blurVMat.colorNode = buildBlurColor(blurHRT.texture, texelV);

      // Composite: dithered scene is the base; bloom adds an accent.
      const composeMat = new THREE.NodeMaterial();
      const sceneRGB = tslTexture(ditheredRT.texture, uv()).rgb;
      const bloomRGB = tslTexture(blurVRT.texture, uv()).rgb;
      composeMat.colorNode = vec4(sceneRGB.add(bloomRGB.mul(bloomStrength)), 1);

      const brightQuad = new THREE.QuadMesh(brightMat);
      const blurHQuad = new THREE.QuadMesh(blurHMat);
      const blurVQuad = new THREE.QuadMesh(blurVMat);
      const composeQuad = new THREE.QuadMesh(composeMat);

      postQuads = { brightQuad, blurHQuad, blurVQuad, composeQuad };
      postMats = { brightMat, blurHMat, blurVMat, composeMat };

      lastTime = performance.now();
      animate();
    });

    const handleResize = (): void => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      starsCamera.aspect = w / h;
      starsCamera.updateProjectionMatrix();
      hoverAspect.value = h > 0 ? w / h : 1;
      renderer.setSize(w, h);
      starsRT.setSize(fullW(), fullH());
      sceneRT.setSize(fullW(), fullH());
      ditheredRT.setSize(fullW(), fullH());
      brightRT.setSize(halfW(), halfH());
      blurHRT.setSize(halfW(), halfH());
      blurVRT.setSize(halfW(), halfH());
      densityRT.setSize(hoverW(), hoverH());
      densityCopy.setSize(hoverW(), hoverH());
      velocityRT.setSize(hoverW(), hoverH());
      velocityCopy.setSize(hoverW(), hoverH());
      hoverCleared = false;
      texelH.value.set(1 / halfW(), 0);
      texelV.value.set(0, 1 / halfH());
      resolution.value.set(fullW(), fullH());
    };
    window.addEventListener('resize', handleResize);

    return () => {
      running = false;
      sceneRef.current = null;
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      geometry.dispose();
      material.dispose();
      ship.dispose();
      ditherMat.dispose();
      bayerTexture.dispose();
      densityCopyMat.dispose();
      densityUpdateMat.dispose();
      velocityCopyMat.dispose();
      velocityUpdateMat.dispose();
      clearMat.dispose();
      for (const m of debugMats) m.dispose();
      postMats?.brightMat.dispose();
      postMats?.blurHMat.dispose();
      postMats?.blurVMat.dispose();
      postMats?.composeMat.dispose();
      starsRT.dispose();
      sceneRT.dispose();
      ditheredRT.dispose();
      brightRT.dispose();
      blurHRT.dispose();
      blurVRT.dispose();
      densityRT.dispose();
      densityCopy.dispose();
      velocityRT.dispose();
      velocityCopy.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Debug GUI — always present but collapsed by default. The dynamic import
  // keeps lil-gui out of the initial page chunk.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let gui: GUIType | null = null;
    let cancelled = false;

    void import('lil-gui').then(({ default: GUI }) => {
      if (cancelled) return;
      gui = new GUI({ title: 'space game' });
      gui.close();

      const bloomFolder = gui.addFolder('bloom');
      bloomFolder.add(bloomThreshold, 'value', 0, 2, 0.01).name('threshold');
      bloomFolder
        .add(revealTargets, 'bloomStrength', 0, 10, 0.05)
        .name('strength');

      const ditherFolder = gui.addFolder('dither');
      ditherFolder.add(ditherStrength, 'value', 0, 1, 0.01).name('strength');
      ditherFolder.add(ditherLevels, 'value', 2, 16, 1).name('levels');
      ditherFolder.add(ditherScale, 'value', 1, 8, 1).name('pixel scale');
      ditherFolder.add(ditherExposure, 'value', 0.1, 4, 0.01).name('exposure');

      const particlesFolder = gui.addFolder('particles');
      particlesFolder.add(pointSize, 'value', 0.5, 40, 0.1).name('point size');
      particlesFolder
        .add(maxParticlePixels, 'value', 1, 50, 0.5)
        .name('max pixels');

      const clustersFolder = gui.addFolder('clusters (3D noise)');
      clustersFolder.add(clusterStrength, 'value', 0, 1, 0.01).name('strength');
      clustersFolder
        .add(clusterScale, 'value', 0.001, 0.2, 0.001)
        .name('scale');
      clustersFolder
        .add(clusterContrast, 'value', 0.2, 6, 0.01)
        .name('contrast');

      const clustersFolder2 = gui.addFolder('clusters #2 (3D noise)');
      clustersFolder2
        .add(clusterStrength2, 'value', 0, 1, 0.01)
        .name('strength');
      clustersFolder2
        .add(clusterScale2, 'value', 0.001, 0.2, 0.001)
        .name('scale');
      clustersFolder2
        .add(clusterContrast2, 'value', 0.2, 6, 0.01)
        .name('contrast');

      const twinkleFolder = gui.addFolder('twinkle');
      twinkleFolder.add(twinkleStrength, 'value', 0, 1, 0.01).name('strength');
      twinkleFolder.add(twinkleSpeed, 'value', 0, 2, 0.01).name('speed');

      const scene = sceneRef.current;
      if (!scene) return;

      const hoverFolder = gui.addFolder('hover');
      hoverFolder
        .add(scene.hoverDebug, 'mode', [
          'off',
          'density',
          'densityCopy',
          'velocity',
          'velocityCopy',
        ])
        .name('debug view');
      hoverFolder
        .add(splatRadius, 'value', 0.01, 0.5, 0.005)
        .name('splat radius');
      hoverFolder
        .add(splatStrength, 'value', 0, 200, 0.5)
        .name('splat strength');
      hoverFolder
        .add(densityDecay, 'value', 0.5, 0.999, 0.001)
        .name('density decay');
      hoverFolder
        .add(velocitySplatStrength, 'value', 0, 16, 0.05)
        .name('vel splat str');
      hoverFolder
        .add(velocityDecay, 'value', 0.9, 1, 0.001)
        .name('velocity decay');
      hoverFolder
        .add(advectionStrength, 'value', 0, 0.5, 0.001)
        .name('advection str');
      hoverFolder
        .add(hoverStrength, 'value', 0, 16, 0.1)
        .name('hover strength');

      const flightFolder = gui.addFolder('flight');
      flightFolder
        .add(scene.flight, 'baseSpeed', 0, 40, 0.5)
        .name('cruise speed');
      flightFolder
        .add(scene.flight, 'boostSpeed', 0, 80, 0.5)
        .name('boost speed');

      const cameraFolder = gui.addFolder('camera');
      cameraFolder
        .add(scene.camera, 'fov', 30, 120, 1)
        .name('FOV')
        .onChange(() => {
          scene.camera.updateProjectionMatrix();
          halfFovTan.value = Math.tan((scene.camera.fov * Math.PI) / 180 / 2);
        });

      const skyFolder = gui.addFolder('sky');
      skyFolder
        .add(scene.params, 'bandCount', 0, 250_000, 1000)
        .name('band count')
        .onFinishChange(() => scene.regenerateSky());
      skyFolder.add(fieldStrength, 'value', 0, 2, 0.01).name('field strength');
      skyFolder
        .add(scene.params, 'fieldCount', 0, 150_000, 1000)
        .name('field count')
        .onFinishChange(() => scene.regenerateSky());
      skyFolder
        .add(scene.params, 'bandThickness', 0.01, 0.6, 0.005)
        .name('band thickness')
        .onChange(() => scene.regenerateSky());
      skyFolder
        .add(scene.params, 'brightFraction', 0, 0.1, 0.001)
        .name('bright fraction')
        .onFinishChange(() => scene.regenerateSky());
      skyFolder
        .add(scene.params, 'band2Offset', -Math.PI / 2, Math.PI / 2, 0.005)
        .name('band 2 offset')
        .onChange(() => scene.regenerateSky());
      skyFolder
        .add(scene.sky.rotation, 'z', -Math.PI, Math.PI, 0.001)
        .name('rotation Z');
      skyFolder
        .add(scene.sky.rotation, 'x', -Math.PI, Math.PI, 0.001)
        .name('rotation X');
      skyFolder
        .add(scene.sky.rotation, 'y', -Math.PI, Math.PI, 0.001)
        .name('rotation Y');
    });

    return () => {
      cancelled = true;
      gui?.destroy();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 min-[740px]:fixed"
    />
  );
}
