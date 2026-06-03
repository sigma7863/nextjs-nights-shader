import * as THREE from 'three/webgpu';
import { uniform, vec3 } from 'three/tsl';

// A fully procedural spaceship. No external model is loaded — every piece of
// geometry is generated in code from Three primitives and assembled into a
// group. The ship's "forward" direction is local -Z (Three's camera-forward
// convention), so the chase camera that sits at +Z behind it looks down the
// nose.
//
// Returned handle:
//   - root:   the group you add to the scene. Steering/translation is applied
//             to THIS node so its world matrix carries the ship's heading.
//   - model:  an inner group that holds all the meshes. Visual banking (roll
//             into turns) is applied here so it never pollutes the heading.
//   - engineGlow: a scalar uniform driving the emissive intensity of the
//             exhaust. Animate it up on boost for a bright, bloom-friendly
//             flare.
//   - dispose(): frees all geometries and materials.
export type Spaceship = ReturnType<typeof createSpaceship>;

export function createSpaceship() {
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const track = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  // ---- Materials ----
  const hullMat = trackMat(
    new THREE.MeshStandardNodeMaterial({
      color: 0xb8c4d0,
      metalness: 0.65,
      roughness: 0.35,
    }),
  );
  const accentMat = trackMat(
    new THREE.MeshStandardNodeMaterial({
      color: 0x2b3440,
      metalness: 0.5,
      roughness: 0.5,
    }),
  );
  const cockpitMat = trackMat(
    new THREE.MeshStandardNodeMaterial({
      color: 0x0a1622,
      emissive: 0x1f6f9e,
      metalness: 0.2,
      roughness: 0.08,
    }),
  );

  // Engine exhaust — pure emissive driven by a uniform so boost can flare it.
  const engineGlow = uniform(1);
  const engineMat = trackMat(new THREE.MeshStandardNodeMaterial({ color: 0x000000 }));
  engineMat.emissiveNode = vec3(1.0, 0.45, 0.12).mul(engineGlow);

  // ---- Fuselage ----
  // Cone points +Y by default; rotate -90° about X so the tip aims down -Z.
  const fuselage = new THREE.Mesh(
    track(new THREE.ConeGeometry(0.55, 2.6, 18)),
    hullMat,
  );
  fuselage.geometry.rotateX(-Math.PI / 2);
  model.add(fuselage);

  // Rear hull collar where the engines mount.
  const collar = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.5, 0.62, 0.7, 18)),
    accentMat,
  );
  collar.geometry.rotateX(Math.PI / 2);
  collar.position.set(0, 0, 1.05);
  model.add(collar);

  // ---- Cockpit canopy ----
  const cockpit = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.32, 16, 12)),
    cockpitMat,
  );
  cockpit.scale.set(1, 0.7, 1.5);
  cockpit.position.set(0, 0.22, -0.35);
  model.add(cockpit);

  // ---- Wings ----
  // Swept delta wings made from a thin box, mirrored left/right and angled
  // back slightly for an aggressive silhouette.
  const wingGeo = track(new THREE.BoxGeometry(1.6, 0.07, 1.0));
  const makeWing = (side: 1 | -1): THREE.Mesh => {
    const wing = new THREE.Mesh(wingGeo, hullMat);
    wing.position.set(side * 1.05, -0.05, 0.5);
    wing.rotation.z = side * -0.18;
    wing.rotation.y = side * 0.32;
    return wing;
  };
  model.add(makeWing(1));
  model.add(makeWing(-1));

  // Wingtip accents.
  const tipGeo = track(new THREE.BoxGeometry(0.12, 0.1, 0.7));
  const makeTip = (side: 1 | -1): THREE.Mesh => {
    const tip = new THREE.Mesh(tipGeo, accentMat);
    tip.position.set(side * 1.85, -0.02, 0.55);
    return tip;
  };
  model.add(makeTip(1));
  model.add(makeTip(-1));

  // ---- Vertical tail fin ----
  const fin = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.08, 0.55, 0.7)),
    hullMat,
  );
  fin.position.set(0, 0.35, 0.95);
  model.add(fin);

  // ---- Engines + exhaust ----
  const nacelleGeo = track(new THREE.CylinderGeometry(0.18, 0.22, 0.6, 14));
  const exhaustGeo = track(new THREE.CylinderGeometry(0.16, 0.05, 0.5, 14));
  const makeEngine = (side: 1 | -1): void => {
    const nacelle = new THREE.Mesh(nacelleGeo, accentMat);
    nacelle.geometry; // shared geo
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(side * 0.32, -0.08, 1.25);
    model.add(nacelle);

    const exhaust = new THREE.Mesh(exhaustGeo, engineMat);
    exhaust.rotation.x = -Math.PI / 2;
    exhaust.position.set(side * 0.32, -0.08, 1.6);
    model.add(exhaust);
  };
  makeEngine(1);
  makeEngine(-1);

  const dispose = (): void => {
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
  };

  return { root, model, engineGlow, dispose };
}
