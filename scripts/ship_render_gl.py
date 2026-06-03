"""
Accurate offscreen renderer for a GLB using pyrender + EGL (no display needed).
Produces a montage of shaded views from several angles with correct depth
sorting, so we can trust the silhouette/symmetry of the model.

Usage: python scripts/ship_render_gl.py /tmp/ship.glb /tmp/ship_gl.png
"""

import os
import sys

os.environ.setdefault("PYOPENGL_PLATFORM", "egl")

import numpy as np
import trimesh
import pyrender
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ship.glb"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/ship_gl.png"

tm = trimesh.load(SRC, force="scene")

# build123d exports glTF in meters (numbers are treated as mm), so the model is
# ~1000x smaller than authored. Normalize: center at origin and rescale so the
# bounding radius is 1.0, which makes camera framing units-independent.
bounds = tm.bounds
center = (bounds[0] + bounds[1]) / 2.0
raw_radius = float(np.linalg.norm(bounds[1] - bounds[0]) / 2.0)
norm = 1.0 / raw_radius
radius = 1.0

scene = pyrender.Scene(bg_color=[0.04, 0.05, 0.07, 1.0], ambient_light=[0.25, 0.27, 0.31])

for name, geom in tm.geometry.items():
    g = geom.copy()
    # apply node transform
    for node_name in tm.graph.nodes_geometry:
        t, gname = tm.graph[node_name]
        if gname == name:
            g.apply_transform(t)
            break
    g.apply_translation(-center)
    g.apply_scale(norm)
    mesh = pyrender.Mesh.from_trimesh(g, smooth=False)
    scene.add(mesh, name=name)

# Key + fill + rim directional lights.
def dir_light(direction, intensity):
    light = pyrender.DirectionalLight(color=np.ones(3), intensity=intensity)
    # Build a look-at pose for the light.
    z = -np.array(direction, dtype=float)
    z /= np.linalg.norm(z)
    up = np.array([0, 1.0, 0]) if abs(z[1]) < 0.95 else np.array([0, 0, 1.0])
    x = np.cross(up, z); x /= np.linalg.norm(x)
    y = np.cross(z, x)
    pose = np.eye(4)
    pose[:3, 0] = x; pose[:3, 1] = y; pose[:3, 2] = z
    return light, pose

for d, inten in [((0.5, 0.8, 0.6), 4.0), ((-0.6, 0.3, 0.4), 1.6), ((0.0, -0.4, -0.8), 2.0)]:
    light, pose = dir_light(d, inten)
    scene.add(light, pose=pose)

cam = pyrender.PerspectiveCamera(yfov=np.pi / 5.0, znear=0.01, zfar=100.0)
dist = radius / np.tan(np.pi / 10.0) * 1.1

# (name, azimuth_deg, elevation_deg)  forward of the ship is -Z.
VIEWS = [
    ("hero", 40, 22),
    ("front", 180, 8),
    ("side", 90, 4),
    ("top", 0, 89),
    ("rear-3/4", 220, 18),
    ("belly", 30, -28),
]


def cam_pose(azim, elev):
    a = np.radians(azim); e = np.radians(elev)
    eye = np.array([
        dist * np.cos(e) * np.sin(a),
        dist * np.sin(e),
        dist * np.cos(e) * np.cos(a),
    ])
    z = eye / np.linalg.norm(eye)
    up = np.array([0, 1.0, 0]) if abs(z[1]) < 0.95 else np.array([0, 0, 1.0])
    x = np.cross(up, z); x /= np.linalg.norm(x)
    y = np.cross(z, x)
    pose = np.eye(4)
    pose[:3, 0] = x; pose[:3, 1] = y; pose[:3, 2] = z
    pose[:3, 3] = eye
    return pose


W = H = 512
r = pyrender.OffscreenRenderer(W, H)
cam_node = scene.add(cam, pose=np.eye(4))

tiles = []
for title, azim, elev in VIEWS:
    scene.set_pose(cam_node, cam_pose(azim, elev))
    color, _ = r.render(scene)
    img = Image.fromarray(color)
    tiles.append((title, img))
r.delete()

cols = 3
rows = (len(tiles) + cols - 1) // cols
pad = 8
montage = Image.new("RGB", (cols * W + (cols + 1) * pad, rows * H + (rows + 1) * pad), (10, 12, 18))
for i, (title, img) in enumerate(tiles):
    cx = pad + (i % cols) * (W + pad)
    cy = pad + (i // cols) * (H + pad)
    montage.paste(img, (cx, cy))
montage.save(OUT)
print("Wrote", OUT)
