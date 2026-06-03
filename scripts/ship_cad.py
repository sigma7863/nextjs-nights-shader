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
def make_wing(side: int):
    with BuildPart() as wing_b:
        with BuildSketch(Plane.XZ):
            with BuildLine():
                Polyline(
                    (0.30, -0.55),   # root leading edge (x span, z chord)
                    (2.25, 0.55),    # tip leading edge (swept back)
                    (2.25, 1.05),    # tip trailing edge
                    (0.30, 1.15),    # root trailing edge
                    close=True,
                )
            make_face()
        extrude(amount=0.07, both=True)
        try:
            outer = wing_b.edges().group_by(Axis.X)[-1]
            chamfer(outer, length=0.04)
        except Exception:
            pass

    w = wing_b.part
    w = Rot(0, 0, side * -7) * w          # dihedral
    w = Pos(side * 0.42, -0.04, -0.05) * w
    return w

wings = Compound(children=[make_wing(+1), make_wing(-1)])
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
canopy = b3d_scale(canopy_b.part, by=(1.0, 0.62, 1.7))
canopy = Pos(0, 0.22, -0.85) * canopy
canopy.label = "canopy"
canopy.color = Color(0.05, 0.22, 0.38)

# ----------------------------------------------------------------------------
# Twin engine nacelles + emissive nozzle cones at the tail.
# ----------------------------------------------------------------------------
def make_nacelle(side: int):
    with BuildPart() as eng_b:
        Cylinder(
            radius=0.18,
            height=0.42,
            align=(Align.CENTER, Align.CENTER, Align.CENTER),
        )
    e = Rot(90, 0, 0) * eng_b.part
    e = Pos(side * 0.26, -0.08, 1.95) * e
    return e

def make_nozzle(side: int):
    with BuildPart() as noz_b:
        Cone(bottom_radius=0.15, top_radius=0.05, height=0.34)
    n = Rot(-90, 0, 0) * noz_b.part
    n = Pos(side * 0.26, -0.08, 2.22) * n
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
