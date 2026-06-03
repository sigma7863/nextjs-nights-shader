import * as THREE from 'three/webgpu';
import { uniform, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// The spaceship is a CAD-authored model (build123d / OpenCascade) exported to
// glTF and loaded at runtime. See scripts/ship_cad.py for the parametric
// source. The mesh is loaded asynchronously; the handle below is returned
// synchronously so the rest of the scene can wire up steering/camera before the
// geometry arrives, and the meshes are dropped into `model` once decoded.
//
// The ship's "forward" is local -Z (Three's camera-forward convention) so the
// chase camera that sits at +Z behind it looks down the nose.
//
// Returned handle:
//   - root:   the group added to the scene. Steering/translation is applied to
//             THIS node so its world matrix carries the ship's heading.
//   - model:  an inner group holding the visible mesh. Visual banking (roll into
//             turns) is applied here so it never pollutes the heading.
//   - engineGlow: a scalar uniform driving the emissive intensity of the
//             exhaust. Animate it up on boost for a bright, bloom-friendly flare.
//   - dispose(): frees all geometries and materials.
export type Spaceship = ReturnType<typeof createSpaceship>;

const MODEL_URL = '/models/ship.glb';

// Base part colors baked into the GLB by the CAD exporter (linear RGB). We use
// them to classify each mesh and assign the right runtime material.
const ENGINE_RGB: [number, number, number] = [1.0, 0.45, 0.12];
const CANOPY_RGB: [number, number, number] = [0.1, 0.34, 0.52];

// Target longest dimension of the ship in world units (the GLB is authored in
// millimeters and exported in meters, so it needs scaling up to game scale).
const TARGET_SIZE = 3.7;

function near(
  c: THREE.Color,
  rgb: [number, number, number],
  tol = 0.08,
): boolean {
  return (
    Math.abs(c.r - rgb[0]) < tol &&
    Math.abs(c.g - rgb[1]) < tol &&
    Math.abs(c.b - rgb[2]) < tol
  );
}

export function createSpaceship() {
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  // Engine exhaust emissive intensity — shared uniform so boost can flare it.
  const engineGlow = uniform(1);

  // Build the runtime material for a given baked base color.
  const materialFor = (color: THREE.Color): THREE.Material => {
    if (near(color, ENGINE_RGB)) {
      // Pure emissive exhaust driven by the boost uniform (bloom-friendly).
      const m = trackMat(
        new THREE.MeshStandardNodeMaterial({ color: 0x000000 }),
      );
      m.emissiveNode = vec3(ENGINE_RGB[0], ENGINE_RGB[1], ENGINE_RGB[2]).mul(
        engineGlow,
      );
      return m;
    }
    if (near(color, CANOPY_RGB)) {
      // Glossy tinted canopy glass with a faint internal glow.
      return trackMat(
        new THREE.MeshStandardNodeMaterial({
          color: 0x0a1622,
          emissive: 0x1f6f9e,
          emissiveIntensity: 0.5,
          metalness: 0.2,
          roughness: 0.08,
        }),
      );
    }
    // Hull / wings / nacelles: keep the baked grey tone, brushed-metal finish.
    const dark = color.r + color.g + color.b < 1.1;
    return trackMat(
      new THREE.MeshStandardNodeMaterial({
        color: color.getHex(),
        metalness: dark ? 0.55 : 0.7,
        roughness: dark ? 0.5 : 0.32,
      }),
    );
  };

  const loader = new GLTFLoader();
  loader.load(
    MODEL_URL,
    (gltf) => {
      const obj = gltf.scene;

      // Reassign materials by classifying each mesh's baked base color.
      obj.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh) return;
        const mesh = child as THREE.Mesh;
        const src = mesh.material as THREE.MeshStandardMaterial;
        const baseColor = src?.color
          ? src.color.clone()
          : new THREE.Color(0xb8c4d0);
        mesh.material = materialFor(baseColor);
        if (mesh.geometry) geometries.push(mesh.geometry);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      });

      // The CAD kernel is Z-up; glTF is Y-up, so after import the ship's length
      // runs along Y with the nose pointing -Y. Rotate +90° about X to lay it
      // flat with the nose along -Z and "up" along +Y.
      obj.rotation.x = Math.PI / 2;

      // Normalize size: scale so the longest dimension equals TARGET_SIZE.
      obj.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const s = TARGET_SIZE / maxDim;
      obj.scale.setScalar(s);

      // Recenter so the ship's bounding box midpoint sits at the model origin
      // (keeps the chase camera framing predictable regardless of CAD origin).
      obj.updateWorldMatrix(true, true);
      const centered = new THREE.Box3().setFromObject(obj);
      const center = new THREE.Vector3();
      centered.getCenter(center);
      obj.position.sub(center);

      model.add(obj);
    },
    undefined,
    (err) => {
      console.error('[v0] Failed to load spaceship model:', err);
    },
  );

  const dispose = (): void => {
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
  };

  return { root, model, engineGlow, dispose };
}
