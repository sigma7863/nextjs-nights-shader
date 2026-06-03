"""
Procedural spaceship generated with build123d (OpenCascade kernel).

Design: a sleek single-seat interceptor. Forward is -Z, up is +Y, to match the
game's convention (chase cam sits at +Z behind the ship and looks down -Z).

The model is assembled from several labeled, colored solids so the GLTF export
keeps them as separate named nodes:
  - "hull"    : lofted fuselage + tail collar
  - "wing"    : swept delta wings (port/starboard)
  - "fin"     : vertical tail
  - "canopy"  : tinted cockpit glass
  - "nacelle" : engine housings
  - "engine"  : exhaust nozzle cones (emissive in-game)

CAD techniques: multi-section loft, fillet/chamfer, boolean fuse, mirror,
offset planes, revolve.
"""

import sys

from build123d import (
    Align,
    Axis,
    BuildLine,
    BuildPart,
    BuildSketch,
    Color,
    Compound,
    Cone,
    Cylinder,
    Ellipse,
    Location,
    Plane,
    Polyline,
    Pos,
    Rot,
    Sphere,
    chamfer,
    export_gltf,
    extrude,
    fillet,
    loft,
    make_face,
    mirror,
    scale as b3d_scale,
)

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ship.glb"

# ----------------------------------------------------------------------------
# Fuselage: lofted through elliptical cross-sections along Z (nose at -Z).
# (z position, x half-width, y half-height)
# ----------------------------------------------------------------------------
SECTIONS = [
    (-3.30, 0.030, 0.030),  # sharp nose tip
    (-2.70, 0.150, 0.120),
    (-1.90, 0.340, 0.250),
    (-1.00, 0.520, 0.340),  # widest part of the body
    (-0.10, 0.560, 0.360),
    (0.80, 0.470, 0.330),
    (1.55, 0.360, 0.290),  # tail
]

with BuildPart() as hull_b:
    for z, rx, ry in SECTIONS:
        with BuildSketch(Plane.XY.offset(z)):
            Ellipse(rx, ry)
    loft()

    # Rear engine-mount collar (flared ring at the tail).
    with BuildSketch(Plane.XY.offset(1.55)):
        Ellipse(0.36, 0.29)
    with BuildSketch(Plane.XY.offset(1.95)):
        Ellipse(0.42, 0.34)
    loft()

hull = hull_b.part
hull.label = "hull"
hull.color = Color(0.72, 0.77, 0.83)

# ----------------------------------------------------------------------------
# Wings: tapered swept delta planform in XZ, extruded for thickness, then
# given dihedral and mirrored.
# ----------------------------------------------------------------------------
# Base wing built once on the +X (starboard) side as a swept delta with a
# clipped tip, then thinned with a tip chamfer. The port wing is a true mirror
# of it across the YZ plane so both halves are symmetric.
with BuildPart() as wing_b:
    with BuildSketch(Plane.XZ):
        with BuildLine():
            # Root starts well inboard (negative x) so, after placement, the
            # wing root buries itself inside the fuselage rather than floating
            # off the hull surface — the two halves overlap in the body center
            # and fuse visually into a continuous wing.
            Polyline(
                (-0.30, -0.85),  # root leading edge (x span, z chord)
                (2.15, 0.35),    # tip leading edge (strongly swept back)
                (2.15, 0.78),    # tip trailing edge (clipped tip)
                (-0.30, 1.20),   # root trailing edge
                close=True,
            )
        make_face()
    extrude(amount=0.06, both=True)
    try:
        tip = wing_b.edges().group_by(Axis.X)[-1]
        chamfer(tip, length=0.035)
    except Exception:
        pass
base_wing = wing_b.part


def place_wing(side: int):
    w = base_wing if side > 0 else mirror(base_wing, about=Plane.YZ)
    w = Rot(0, 0, side * -6) * w          # dihedral (tips angle up)
    # Small outboard nudge only; the inboard root already overlaps the hull.
    w = Pos(side * 0.10, -0.05, -0.05) * w
    return w

wings = Compound(children=[place_wing(+1), place_wing(-1)])
wings.label = "wing"
wings.color = Color(0.60, 0.66, 0.72)

# ----------------------------------------------------------------------------
# Vertical tail fin (profile in YZ, extruded across X).
# ----------------------------------------------------------------------------
with BuildPart() as fin_b:
    with BuildSketch(Plane.YZ):
        with BuildLine():
            Polyline(
                (0.45, 0.95),
                (1.15, 1.45),
                (1.08, 1.85),
                (0.45, 1.70),
                close=True,
            )
        make_face()
    extrude(amount=0.045, both=True)
fin = fin_b.part
fin.label = "fin"
fin.color = Color(0.60, 0.66, 0.72)

# ----------------------------------------------------------------------------
# Cockpit canopy: a stretched, tinted glass ellipsoid on the upper hull.
# ----------------------------------------------------------------------------
with BuildPart() as canopy_b:
    Sphere(0.30)
canopy = b3d_scale(canopy_b.part, by=(0.95, 0.66, 1.85))
canopy = Pos(0, 0.24, -0.80) * canopy
canopy.label = "canopy"
canopy.color = Color(0.10, 0.34, 0.52)

# ----------------------------------------------------------------------------
# Twin engine nacelles + emissive nozzle cones at the tail.
# ----------------------------------------------------------------------------
def make_nacelle(side: int):
    # Engine housing: a cylinder running along the body axis (+Z is aft).
    with BuildPart() as eng_b:
        Cylinder(
            radius=0.21,
            height=0.78,
            align=(Align.CENTER, Align.CENTER, Align.CENTER),
        )
    e = Pos(side * 0.27, -0.06, 1.70) * eng_b.part
    return e

def make_nozzle(side: int):
    # Exhaust bell: a cone whose wide opening faces aft (+Z). The default cone
    # has its wide base at -Z, so rotate 180° about X to flare it backward.
    with BuildPart() as noz_b:
        Cone(bottom_radius=0.22, top_radius=0.11, height=0.30)
    n = Rot(180, 0, 0) * noz_b.part
    n = Pos(side * 0.27, -0.06, 2.18) * n
    return n

nacelles = Compound(children=[make_nacelle(+1), make_nacelle(-1)])
nacelles.label = "nacelle"
nacelles.color = Color(0.20, 0.24, 0.30)

engines = Compound(children=[make_nozzle(+1), make_nozzle(-1)])
engines.label = "engine"
engines.color = Color(1.0, 0.45, 0.12)

# ----------------------------------------------------------------------------
# Assemble + export.
# ----------------------------------------------------------------------------
ship = Compound(
    label="ship",
    children=[hull, wings, fin, canopy, nacelles, engines],
)

bb = ship.bounding_box()
print("Bounding box size:", bb.size)
for c in ship.children:
    print(f"  {c.label:8s} size={c.bounding_box().size}")

export_gltf(ship, OUT, binary=True)
print("Wrote", OUT)
