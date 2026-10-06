"""Ignis approximate full-body 3D build (Blender 5.2 headless).
Ref: Downloads/newenw 3-view (front/side/back T-pose, white+dark armor, orange crystal wings).
Run: blender --background --python tools/ignis_blender_build.py
Out: assets/models/ignis/ignis_full.blend + ignis_30k.glb + preview_*.png
Budget: <= 30000 tris (design target ~5k, assert enforced).
"""
import bpy
import bmesh
import json
import math
import os
from mathutils import Matrix, Euler, Vector

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO, "assets", "models", "ignis")
os.makedirs(OUT_DIR, exist_ok=True)

BLEND_PATH = os.path.join(OUT_DIR, "ignis_full.blend")
GLB_PATH = os.path.join(OUT_DIR, "ignis_30k.glb")

TRI_BUDGET = 30000

# ---------------------------------------------------------------- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0

# ---------------------------------------------------------------- materials
def make_mat(name, base, metallic=0.0, rough=0.5, emit=None, emit_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    try:
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = rough
    except Exception:
        pass
    if emit is not None:
        try:
            bsdf.inputs["Emission Color"].default_value = (*emit, 1.0)
            bsdf.inputs["Emission Strength"].default_value = emit_strength
        except Exception:
            pass
    return m

MAT_DARK = make_mat("IGNIS_dark_armor", (0.03, 0.03, 0.035), 0.85, 0.38)
MAT_WHITE = make_mat("IGNIS_white_armor", (0.78, 0.79, 0.80), 0.35, 0.42)
MAT_ENERGY = make_mat("IGNIS_energy_orange", (0.25, 0.03, 0.0), 0.0, 0.3,
                      emit=(1.0, 0.30, 0.03), emit_strength=1.4)
MAT_RED = make_mat("IGNIS_glow_red", (0.6, 0.02, 0.01), 0.0, 0.5,
                   emit=(1.0, 0.08, 0.02), emit_strength=2.0)
MAT_JOINT = make_mat("IGNIS_joint", (0.10, 0.10, 0.11), 0.9, 0.5)

# ---------------------------------------------------------------- mesh helpers (headless-safe, from_pydata only)
def add_mesh(name, verts, faces, mat):
    me = bpy.data.meshes.new(name + "_mesh")
    me.from_pydata(verts, [], faces)
    me.update()
    # normalize winding: outward normals for closed prims (headless-safe)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if mat is not None:
        me.materials.append(mat)
    return ob

def xf(verts, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    M = (Matrix.Translation(Vector(loc))
         @ Euler(rot, "XYZ").to_matrix().to_4x4()
         @ Matrix.Diagonal(Vector((*scale, 1.0))).to_4x4())
    return [M @ Vector(v) for v in verts]

def box(name, dims, loc, rot=(0, 0, 0), mat=None, taper_top=1.0, taper_dir="xy"):
    sx, sy, sz = dims[0] / 2, dims[1] / 2, dims[2] / 2
    v = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
         (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    if taper_top != 1.0:
        for i in range(4, 8):
            x, y, z = v[i]
            if "x" in taper_dir:
                x *= taper_top
            if "y" in taper_dir:
                y *= taper_top
            v[i] = (x, y, z)
    f = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
         (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return add_mesh(name, [tuple(p) for p in xf(v, loc, rot)], f, mat)

def cyl(name, r_top, r_bot, h, loc, rot=(0, 0, 0), mat=None, seg=10):
    verts, faces = [], []
    for iz, r in ((0, r_bot), (1, r_top)):
        z = -h / 2 if iz == 0 else h / 2
        for i in range(seg):
            a = 2 * math.pi * i / seg
            verts.append((r * math.cos(a), r * math.sin(a), z))
    for i in range(seg):
        j = (i + 1) % seg
        faces.append((i, j, seg + j, seg + i))
    faces.append(tuple(reversed(range(seg))))
    faces.append(tuple(range(seg, 2 * seg)))
    return add_mesh(name, [tuple(p) for p in xf(verts, loc, rot)], faces, mat)

def crystal(name, length, width, thick, loc, rot=(0, 0, 0), mat=None):
    # stretched octahedron: 6 verts, 8 tris
    v = [(0, 0, length / 2), (0, 0, -length / 2),
         (width / 2, 0, 0), (-width / 2, 0, 0),
         (0, thick / 2, 0), (0, -thick / 2, 0)]
    f = [(0, 2, 4), (0, 4, 3), (0, 3, 5), (0, 5, 2),
         (1, 4, 2), (1, 3, 4), (1, 5, 3), (1, 2, 5)]
    return add_mesh(name, [tuple(p) for p in xf(v, loc, rot)], f, mat)

def orb(name, r, loc, mat=None, squash=1.0):
    # low-poly glowing orb: octahedron scaled
    return crystal(name, r * 2 * squash, r * 2, r * 2, loc, (0, 0, 0), mat)

# ---------------------------------------------------------------- build (Z-up, face +Y, feet at z=0)

# ---- pelvis + torso
box("IGNIS_pelvis", (0.62, 0.42, 0.42), (0, 0, 2.05), mat=MAT_DARK)
box("IGNIS_skirt_front", (0.34, 0.10, 0.62), (0, 0.26, 1.78), rot=(0.12, 0, 0),
    mat=MAT_WHITE, taper_top=0.7)
box("IGNIS_skirt_L", (0.12, 0.34, 0.55), (-0.36, 0, 1.78), rot=(0, 0, 0.15),
    mat=MAT_WHITE, taper_top=0.7)
box("IGNIS_skirt_R", (0.12, 0.34, 0.55), (0.36, 0, 1.78), rot=(0, 0, -0.15),
    mat=MAT_WHITE, taper_top=0.7)
box("IGNIS_belt_light", (0.10, 0.06, 0.30), (0, 0.24, 2.02), mat=MAT_RED)
crystal("IGNIS_tail_spike", 0.85, 0.16, 0.10, (0, -0.10, 1.45),
        rot=(2.75, 0, 0), mat=MAT_ENERGY)

box("IGNIS_torso_core", (0.78, 0.50, 0.85), (0, 0, 2.70), mat=MAT_DARK,
    taper_top=1.15)
box("IGNIS_chest_L", (0.34, 0.14, 0.42), (-0.24, 0.26, 2.85), mat=MAT_WHITE)
box("IGNIS_chest_R", (0.34, 0.14, 0.42), (0.24, 0.26, 2.85), mat=MAT_WHITE)
box("IGNIS_chest_light_L", (0.14, 0.05, 0.08), (-0.24, 0.33, 2.78), mat=MAT_RED)
box("IGNIS_chest_light_R", (0.14, 0.05, 0.08), (0.24, 0.33, 2.78), mat=MAT_RED)
box("IGNIS_chest_light_C", (0.10, 0.05, 0.20), (0, 0.32, 2.60), mat=MAT_RED)
box("IGNIS_abs_1", (0.44, 0.36, 0.18), (0, 0, 2.32), mat=MAT_JOINT)
box("IGNIS_abs_2", (0.38, 0.32, 0.16), (0, 0, 2.16), mat=MAT_JOINT)
box("IGNIS_collar", (0.50, 0.30, 0.14), (0, 0.02, 3.14), mat=MAT_DARK)
box("IGNIS_back_plate", (0.60, 0.12, 0.70), (0, -0.30, 2.72), mat=MAT_WHITE,
    taper_top=0.85)

# ---- backpack
box("IGNIS_pack_core", (0.55, 0.30, 0.55), (0, -0.50, 2.80), mat=MAT_DARK)
orb("IGNIS_pack_light", 0.11, (0, -0.66, 2.80), mat=MAT_ENERGY)
box("IGNIS_pack_L", (0.22, 0.24, 0.40), (-0.38, -0.48, 2.80), mat=MAT_JOINT)
box("IGNIS_pack_R", (0.22, 0.24, 0.40), (0.38, -0.48, 2.80), mat=MAT_JOINT)
orb("IGNIS_pack_light_L", 0.09, (-0.38, -0.62, 2.80), mat=MAT_ENERGY)
orb("IGNIS_pack_light_R", 0.09, (0.38, -0.62, 2.80), mat=MAT_ENERGY)

# ---- head
box("IGNIS_head", (0.34, 0.36, 0.38), (0, 0.02, 3.42), mat=MAT_DARK,
    taper_top=0.85)
box("IGNIS_faceplate", (0.22, 0.06, 0.22), (0, 0.20, 3.38), mat=MAT_WHITE)
box("IGNIS_visor", (0.24, 0.04, 0.07), (0, 0.21, 3.46), mat=MAT_RED)
orb("IGNIS_forehead_gem", 0.055, (0, 0.21, 3.54), mat=MAT_ENERGY, squash=1.4)
box("IGNIS_vfin_L", (0.07, 0.30, 0.55), (-0.22, -0.02, 3.72), rot=(0, 0, 0.45),
    mat=MAT_WHITE, taper_top=0.25)
box("IGNIS_vfin_R", (0.07, 0.30, 0.55), (0.22, -0.02, 3.72), rot=(0, 0, -0.45),
    mat=MAT_WHITE, taper_top=0.25)
box("IGNIS_headfin_C", (0.08, 0.10, 0.30), (0, -0.12, 3.78), rot=(-0.3, 0, 0),
    mat=MAT_DARK, taper_top=0.3)
box("IGNIS_sidepod_L", (0.10, 0.14, 0.22), (-0.22, 0, 3.40), mat=MAT_JOINT)
box("IGNIS_sidepod_R", (0.10, 0.14, 0.22), (0.22, 0, 3.40), mat=MAT_JOINT)
orb("IGNIS_sidepod_light_L", 0.045, (-0.27, 0.02, 3.40), mat=MAT_RED)
orb("IGNIS_sidepod_light_R", 0.045, (0.27, 0.02, 3.40), mat=MAT_RED)

# ---- arms (T-pose along X at z=2.95)
for s, sx in (("L", -1), ("R", 1)):
    box(f"IGNIS_shoulder_{s}", (0.42, 0.44, 0.36), (sx * 0.72, 0, 2.98),
        mat=MAT_WHITE, taper_top=0.9)
    orb(f"IGNIS_shoulder_light_{s}", 0.11, (sx * 0.72, 0.0, 2.98), mat=MAT_ENERGY,
        squash=0.7)
    box(f"IGNIS_bicep_white_{s}", (0.30, 0.02, 0.02), (sx * 0.72, 0, 2.98),
        mat=MAT_WHITE)  # armor rim (thin guard plate)
    cyl(f"IGNIS_upperarm_{s}", 0.13, 0.14, 0.42, (sx * 1.10, 0, 2.95),
        rot=(0, math.pi / 2, 0), mat=MAT_WHITE, seg=10)
    cyl(f"IGNIS_elbow_{s}", 0.12, 0.12, 0.16, (sx * 1.36, 0, 2.95),
        rot=(0, math.pi / 2, 0), mat=MAT_JOINT, seg=8)
    box(f"IGNIS_forearm_{s}", (0.44, 0.26, 0.26), (sx * 1.62, 0, 2.95),
        mat=MAT_WHITE, taper_top=0.85)
    box(f"IGNIS_forearm_dark_{s}", (0.30, 0.28, 0.28), (sx * 1.60, 0, 2.95),
        mat=MAT_DARK)
    box(f"IGNIS_fist_{s}", (0.20, 0.18, 0.20), (sx * 1.95, 0, 2.95), mat=MAT_DARK)
    for fi in range(4):
        box(f"IGNIS_finger_{s}_{fi}", (0.16, 0.035, 0.035),
            (sx * 2.12, -0.06 + fi * 0.04, 2.95), mat=MAT_JOINT)

# ---- legs
for s, sx in (("L", -1), ("R", 1)):
    box(f"IGNIS_thigh_{s}", (0.34, 0.40, 0.70), (sx * 0.24, 0, 1.55),
        mat=MAT_WHITE, taper_top=1.15)
    box(f"IGNIS_thigh_dark_{s}", (0.28, 0.34, 0.55), (sx * 0.24, -0.02, 1.52),
        mat=MAT_DARK)
    orb(f"IGNIS_hip_light_{s}", 0.07, (sx * 0.42, 0.05, 1.85), mat=MAT_RED)
    cyl(f"IGNIS_knee_{s}", 0.16, 0.16, 0.30, (sx * 0.26, 0, 1.16),
        rot=(0, math.pi / 2, 0), mat=MAT_JOINT, seg=10)
    orb(f"IGNIS_knee_light_{s}", 0.08, (sx * 0.42, 0, 1.16), mat=MAT_ENERGY,
        squash=0.7)
    box(f"IGNIS_shin_{s}", (0.30, 0.34, 0.68), (sx * 0.27, 0.01, 0.76),
        mat=MAT_WHITE, taper_top=0.8)
    box(f"IGNIS_calf_{s}", (0.22, 0.30, 0.55), (sx * 0.27, -0.20, 0.72),
        mat=MAT_DARK)
    box(f"IGNIS_shin_light_{s}", (0.08, 0.04, 0.22), (sx * 0.27, 0.19, 0.72),
        mat=MAT_RED)
    cyl(f"IGNIS_ankle_{s}", 0.14, 0.16, 0.22, (sx * 0.28, 0, 0.35),
        mat=MAT_JOINT, seg=8)
    orb(f"IGNIS_ankle_light_{s}", 0.06, (sx * 0.42, -0.05, 0.32), mat=MAT_ENERGY)
    box(f"IGNIS_foot_{s}", (0.30, 0.52, 0.24), (sx * 0.28, 0.08, 0.14),
        mat=MAT_DARK)
    box(f"IGNIS_foot_white_{s}", (0.26, 0.30, 0.16), (sx * 0.28, 0.12, 0.28),
        mat=MAT_WHITE)
    box(f"IGNIS_foot_light_{s}", (0.10, 0.03, 0.05), (sx * 0.28, 0.28, 0.22),
        mat=MAT_ENERGY)

# ---- energy wings (per side): big upper crystals + long lower + dark + white plates
for s, sx in (("L", -1), ("R", 1)):
    # 4 large upper orange blades fanning up/out
    for i, (pitch, yaw, ln) in enumerate([
            (0.5, 0.55, 1.9), (0.25, 0.75, 1.7), (0.05, 0.95, 1.5), (-0.15, 1.15, 1.3)]):
        crystal(f"IGNIS_wing_big_{s}_{i}", ln, 0.34, 0.10,
                (sx * (0.55 + 0.18 * i), -0.55 - 0.05 * i, 3.35 + 0.28 * i),
                rot=(pitch, 0, sx * yaw), mat=MAT_ENERGY)
    # 3 long lower blades sweeping down/out
    for i, (pitch, yaw, ln) in enumerate([
            (-0.5, 0.85, 2.1), (-0.75, 0.65, 1.8), (-0.95, 0.45, 1.5)]):
        crystal(f"IGNIS_wing_low_{s}_{i}", ln, 0.30, 0.09,
                (sx * (0.60 + 0.15 * i), -0.50, 2.35 - 0.30 * i),
                rot=(pitch, 0, sx * yaw), mat=MAT_ENERGY)
    # 3 dark blades interleaved
    for i, (pitch, yaw, ln) in enumerate([
            (0.35, 0.65, 1.5), (-0.3, 0.75, 1.6), (-0.65, 0.55, 1.4)]):
        crystal(f"IGNIS_wing_dark_{s}_{i}", ln, 0.26, 0.08,
                (sx * (0.50 + 0.16 * i), -0.58, 2.95 - 0.25 * i),
                rot=(pitch, 0, sx * yaw), mat=MAT_DARK)
    # white feather plates near root
    for i in range(4):
        box(f"IGNIS_wing_feather_{s}_{i}", (0.10, 0.42, 0.30),
            (sx * (0.48 + 0.06 * i), -0.45, 2.95 + 0.18 * i),
            rot=(0.15 * i, 0, sx * (0.35 + 0.12 * i)), mat=MAT_WHITE,
            taper_top=0.4)
    orb(f"IGNIS_wing_root_light_{s}", 0.10, (sx * 0.55, -0.35, 2.98),
        mat=MAT_ENERGY, squash=0.7)
    orb(f"IGNIS_wing_mid_light_{s}", 0.07, (sx * 0.62, -0.42, 2.60),
        mat=MAT_RED)

# ---------------------------------------------------------------- poly count + budget guard
def count_tris():
    n = 0
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH":
            continue
        me = ob.data
        for p in me.polygons:
            n += len(p.loop_indices) - 2
    return n

tris = count_tris()
verts = sum(len(ob.data.vertices) for ob in bpy.context.scene.objects
            if ob.type == "MESH")
nobjs = sum(1 for ob in bpy.context.scene.objects if ob.type == "MESH")

if tris > TRI_BUDGET:
    # decimate wing blades first (they are expendable detail)
    for ob in bpy.context.scene.objects:
        if ob.type == "MESH" and "_wing_" in ob.name and "_light_" not in ob.name:
            mod = ob.modifiers.new("dec", "DECIMATE")
            mod.ratio = 0.5
            mod.use_collapse_triangulate = True
    tris = count_tris()

assert tris <= TRI_BUDGET, f"over budget: {tris} > {TRI_BUDGET}"

# ---------------------------------------------------------------- save + export
bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
bpy.ops.export_scene.gltf(filepath=GLB_PATH, export_format="GLB",
                           export_materials="EXPORT", export_apply=True,
                           export_yup=True)

# ---------------------------------------------------------------- previews (EEVEE, 3 views)
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 512
scene.render.resolution_y = 512
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"

sun = bpy.data.lights.new("preview_sun", "SUN")
sun.energy = 6.0
sun_ob = bpy.data.objects.new("preview_sun", sun)
scene.collection.objects.link(sun_ob)
sun_ob.rotation_euler = (0.9, 0.2, 0.5)

fill = bpy.data.lights.new("preview_fill", "SUN")
fill.energy = 2.5
fill_ob = bpy.data.objects.new("preview_fill", fill)
scene.collection.objects.link(fill_ob)
fill_ob.rotation_euler = (0.9, 0.2, 0.5 + math.pi)

world = bpy.data.worlds.new("preview_world")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.57, 0.60, 1.0)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
scene.world = world

cam_data = bpy.data.cameras.new("preview_cam")
cam = bpy.data.objects.new("preview_cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.lens = 40

def aim(ob, target):
    d = Vector(target) - ob.location
    q = d.to_track_quat("-Z", "Y")
    ob.rotation_euler = q.to_euler()

CENTER = (0, 0, 2.0)
for vname, loc in (("front", (0, 9.5, 2.4)),
                   ("side", (9.5, 0, 2.4)),
                   ("back", (0, -9.5, 2.4))):
    cam.location = loc
    aim(cam, CENTER)
    scene.render.filepath = os.path.join(OUT_DIR, f"preview_{vname}.png")
    bpy.ops.render.render(write_still=True)

import hashlib
glb_sha = hashlib.sha256(open(GLB_PATH, "rb").read()).hexdigest()[:16]
result = {"blend": BLEND_PATH, "glb": GLB_PATH,
          "tris": tris, "verts": verts, "objects": nobjs,
          "budget": TRI_BUDGET, "glbSha16": glb_sha,
          "previews": [os.path.join(OUT_DIR, f"preview_{v}.png")
                       for v in ("front", "side", "back")]}
print("IGNIS_RESULT " + json.dumps(result, ensure_ascii=False))
