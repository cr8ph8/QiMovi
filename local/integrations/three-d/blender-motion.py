"""Render a source-bound, owned Blender rehearsal as continuous internal previs.

Standalone adapter: does not change the originating kit or saved scene, import
media, approve a take, or claim measured duration. Run only in a fresh background
Blender process with --factory-startup --disable-autoexec --python-exit-code 17.
"""
import argparse
import hashlib
import json
import math
import os
import re
import sys
from pathlib import Path

import bpy


def digest(filename):
    value = hashlib.sha256()
    with filename.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def need(condition, message):
    if not condition:
        raise RuntimeError(message)


def read_json(filename):
    need(filename.is_file() and not filename.is_symlink()
         and filename.stat().st_size <= 4 * 1024 * 1024, 'Invalid bounded JSON file: ' + filename.name)
    return json.loads(filename.read_text(encoding='utf-8'))


def inspect_kit(kit):
    manifest = read_json(kit / 'files.json')
    need(manifest.get('schemaVersion') == 'caniscreenwrite-dcc-stage-files/v1'
         and isinstance(manifest.get('files'), list) and 4 <= len(manifest['files']) <= 20,
         'Invalid originating Blender kit manifest.')
    entries = {}
    for item in manifest['files']:
        need(isinstance(item, dict) and set(item) == {'path', 'sha256'}
             and isinstance(item['path'], str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', item['path'])
             and isinstance(item['sha256'], str) and re.fullmatch(r'[a-f0-9]{64}', item['sha256'])
             and item['path'] not in entries, 'Invalid or duplicate kit member.')
        filename = kit / item['path']
        need(filename.is_file() and not filename.is_symlink() and filename.stat().st_size <= 4 * 1024 * 1024
             and digest(filename) == item['sha256'], 'Originating kit changed: ' + item['path'])
        entries[item['path']] = item['sha256']
    need({'stage-plan.json', 'camera-exchange.json', 'blender-stage.py', 'blender-stage-return.py'} <= entries.keys(),
         'The original generic Blender stage kit is required.')
    plan = read_json(kit / 'stage-plan.json')
    exchange = read_json(kit / 'camera-exchange.json')
    need(plan.get('schemaVersion') == 'caniscreenwrite-dcc-stage-plan/v1'
         and plan.get('target') == 'BLENDER'
         and plan['exchangeSha256'] == exchange['sha256']
         and plan['sourceHash'] == exchange['source']['sourceHash']
         and plan['projectId'] == exchange['source']['projectId']
         and plan['sceneId'] == exchange['scene']['id']
         and plan['basisSha256'] == exchange['basis']['sha256']
         and any(shot['id'] == plan['shotId'] for shot in exchange['scene']['shots']),
         'Plan and exchange source binding differ.')
    return plan, exchange, entries, digest(kit / 'files.json')


def reject_external_dependencies(scene):
    need(not bpy.data.libraries, 'Linked libraries require a separately qualified dependency archive.')
    for image in bpy.data.images:
        need(image.source in {'GENERATED', 'VIEWER'} or bool(image.packed_file),
             'Unpacked or streamed image dependency is unsupported: ' + image.name)
    need(not bpy.data.movieclips and not bpy.data.cache_files and not bpy.data.sounds and not bpy.data.volumes,
         'Movie clips, caches, volumes and sound dependencies are unsupported in this silent preview.')
    for font in bpy.data.fonts:
        need(font.filepath in {'', '<builtin>'} or bool(font.packed_file),
             'Unpacked font dependency is unsupported: ' + font.name)
    # A saved factory/rehearsal scene may retain an empty SequenceEditor. Reject
    # strips, not the container; Blender renamed sequences to strips in 4.4.
    editor = scene.sequence_editor
    if editor is not None:
        found_collection = False
        for name in ('strips_all', 'sequences_all', 'strips', 'sequences'):
            collection = getattr(editor, name, None)
            if collection is not None:
                found_collection = True
                need(len(collection) == 0,
                     'Video sequence editor content requires a separate render adapter.')
        need(found_collection, 'Cannot inspect sequence editor strips in this Blender version.')
    need(not scene.rigidbody_world, 'Physics simulation is unsupported in this camera rehearsal.')
    unsupported = {'FLUID', 'CLOTH', 'SOFT_BODY', 'OCEAN', 'DYNAMIC_PAINT',
                   'PARTICLE_SYSTEM', 'MESH_CACHE', 'MESH_SEQUENCE_CACHE'}
    for obj in scene.objects:
        need(not obj.particle_systems and not any(mod.type in unsupported for mod in obj.modifiers),
             'Simulation or cache modifier is unsupported: ' + obj.name)
    if scene.node_tree:
        pending, visited = [scene.node_tree], set()
        while pending:
            tree = pending.pop()
            if tree.as_pointer() in visited:
                continue
            visited.add(tree.as_pointer())
            for node in tree.nodes:
                need(node.type != 'OUTPUT_FILE', 'Compositor File Output nodes are unsupported.')
                nested = getattr(node, 'node_tree', None)
                if nested:
                    pending.append(nested)


def camera_sample(scene, camera, frame):
    scene.frame_set(frame)
    need(scene.camera == camera, 'Return one active camera; timeline camera cuts require separate shots.')
    position = list(camera.matrix_world.translation)
    quaternion = list(camera.matrix_world.to_quaternion())
    need(all(math.isfinite(value) for value in position + quaternion)
         and math.isfinite(camera.data.lens) and 1 <= camera.data.lens <= 500,
         'Camera observation is not finite or its lens is outside the bounded preview range.')
    return {'frame': frame, 'worldPositionMeters': position, 'worldQuaternionWXYZ': quaternion,
            'lensMm': camera.data.lens, 'sensorWidthMm': camera.data.sensor_width,
            'sensorFit': camera.data.sensor_fit}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scene', required=True)
    parser.add_argument('--kit', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    script = Path(__file__).resolve()
    script_hash = digest(script)
    need(bpy.app.background and not bpy.data.filepath, 'Use a new background Blender process without a loaded scene.')
    need(not bpy.context.preferences.filepaths.use_scripts_auto_execute, 'Run Blender with --disable-autoexec.')
    source = Path(args.scene).expanduser()
    kit = Path(args.kit).expanduser()
    output = Path(args.output).expanduser()
    need(source.is_absolute() and source.is_file() and not source.is_symlink()
         and source.suffix.lower() == '.blend', 'Choose an absolute saved regular .blend file.')
    need(kit.is_absolute() and kit.is_dir() and not kit.is_symlink(), 'Choose an absolute original kit directory.')
    need(output.is_absolute() and not output.exists() and not output.is_symlink()
         and output.parent.is_dir(), 'Choose a new output directory with an existing parent.')
    source, kit, output = source.resolve(strict=True), kit.resolve(strict=True), output.resolve()
    need(output != kit and kit not in output.parents, 'Do not write motion output inside the original kit.')
    plan, exchange, entries, kit_hash = inspect_kit(kit)
    scene_hash = digest(source)
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    need(scene.get('caniscreenwrite_plan_json') == (kit / 'stage-plan.json').read_text(encoding='utf-8')
         and scene.get('caniscreenwrite_exchange_json') == (kit / 'camera-exchange.json').read_text(encoding='utf-8')
         and scene.get('caniscreenwrite_kit_files_sha256') == kit_hash
         and scene.get('caniscreenwrite_plan_file_sha256') == entries['stage-plan.json']
         and scene.get('source_hash') == plan['sourceHash'] and scene.get('shot_id') == plan['shotId'],
         'The saved scene does not carry the exact originating kit and source.')
    reject_external_dependencies(scene)
    camera = scene.camera
    need(camera is not None and camera.type == 'CAMERA' and scene.unit_settings.scale_length == 1,
         'An active camera and meter-scale scene are required.')
    start, end = scene.frame_start, scene.frame_end
    frame_count = end - start + 1
    need(1 <= frame_count <= 4320 and start >= 0 and scene.frame_step == 1,
         'Use 1–4320 contiguous scene frames with frame step one.')
    need(1 <= scene.render.fps <= 120 and math.isfinite(scene.render.fps_base)
         and 0 < scene.render.fps_base <= 100 and scene.render.fps / scene.render.fps_base <= 120,
         'Unsupported scene frame rate.')
    need(scene.render.pixel_aspect_x == 1 and scene.render.pixel_aspect_y == 1,
         'This preview requires square pixels.')
    original = {'engine': scene.render.engine, 'resolution': [scene.render.resolution_x, scene.render.resolution_y],
                'resolutionPercentage': scene.render.resolution_percentage,
                'frameRate': scene.render.fps, 'frameRateBase': scene.render.fps_base,
                'frameRange': [start, end]}
    width = max(2, math.floor(scene.render.resolution_x * scene.render.resolution_percentage / 100))
    height = max(2, math.floor(scene.render.resolution_y * scene.render.resolution_percentage / 100))
    scale = min(1, 960 / width, 540 / height)
    width, height = max(2, math.floor(width * scale / 2) * 2), max(2, math.floor(height * scale / 2) * 2)
    sample_frames = sorted({start, (start + end) // 2, end})
    observations = []
    for frame in range(start, end + 1):
        sample = camera_sample(scene, camera, frame)
        if frame in sample_frames:
            observations.append(sample)
    scene.frame_set(start)
    # Object colors keep authored proxy parts readable under neutral studio light.
    # This low-cost preview treatment remains separate from the final look.
    scene.render.engine = 'BLENDER_WORKBENCH'
    shading = scene.display.shading
    shading.light = 'STUDIO'
    shading.color_type = 'OBJECT'
    shading.background_type = 'VIEWPORT'
    shading.background_color = (0.08, 0.08, 0.08)
    shading.show_shadows = True
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.resolution_percentage = 100
    scene.render.use_border = False
    scene.render.use_crop_to_border = False
    scene.render.use_compositing = False
    scene.render.use_sequencer = False
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'FFMPEG'
    scene.render.ffmpeg.format = 'MPEG4'
    scene.render.ffmpeg.codec = 'H264'
    scene.render.ffmpeg.audio_codec = 'NONE'
    scene.render.ffmpeg.constant_rate_factor = 'MEDIUM'
    scene.render.ffmpeg.ffmpeg_preset = 'GOOD'
    scene.render.ffmpeg.use_autosplit = False
    scene.render.use_file_extension = True
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    video = output / 'internal-previs.mp4'
    scene.render.filepath = str(video)
    completed = []

    def after_frame(render_scene, *unused):
        need(render_scene == scene and render_scene.camera == camera, 'Rendered scene or camera changed.')
        completed.append(render_scene.frame_current)
        print('QIMOVI_MOTION_PROGRESS=' + json.dumps({'completedFrames': len(completed), 'totalFrames': frame_count}), flush=True)

    bpy.app.handlers.render_post.append(after_frame)
    try:
        result = bpy.ops.render.render(animation=True)
    finally:
        bpy.app.handlers.render_post.remove(after_frame)
    need('FINISHED' in result and completed == list(range(start, end + 1)),
         'The renderer did not confirm every contiguous frame.')
    need(video.is_file() and not video.is_symlink() and 16 < video.stat().st_size <= 256 * 1024 * 1024,
         'Finished MP4 is missing or exceeds the application intake limit.')
    with video.open('rb') as handle:
        need(handle.read(12)[4:8] == b'ftyp', 'Renderer output is not an MP4 container.')
    need(digest(source) == scene_hash, 'The source scene changed during rendering.')
    _, _, final_entries, final_kit_hash = inspect_kit(kit)
    need(final_entries == entries and final_kit_hash == kit_hash, 'The original kit changed during rendering.')
    need(digest(script) == script_hash, 'The motion renderer changed during rendering.')
    receipt = {
        'schemaVersion': 'caniscreenwrite-blender-motion-preview/v1',
        'classification': 'INTERNAL_PREVIS', 'status': 'PENDING_REVIEW',
        'projectId': plan['projectId'], 'sourceHash': plan['sourceHash'],
        'sceneId': plan['sceneId'], 'shotId': plan['shotId'],
        'basisSha256': plan['basisSha256'], 'exchangeSha256': exchange['sha256'],
        'kitFilesSha256': kit_hash, 'planFileSha256': entries['stage-plan.json'],
        'inputScene': {'filename': source.name, 'sha256': scene_hash, 'unchanged': True},
        'renderer': {'application': 'Blender', 'version': bpy.app.version_string,
                     'scriptSha256': script_hash, 'engine': scene.render.engine,
                     'codec': 'H264', 'container': 'MPEG4', 'audio': 'NONE'},
        'savedSceneSettings': original,
        'previewSettings': {'width': width, 'height': height, 'frameRate': scene.render.fps,
                            'frameRateBase': scene.render.fps_base, 'frameRange': [start, end],
                            'renderedFrameCount': len(completed), 'everyFrameRendered': True,
                            'colorType': 'OBJECT',
                            'treatment': 'AUTHORED_OBJECT_COLOR_WORKBENCH_PREVIEW_NOT_FINAL_LOOK'},
        'camera': {'objectName': camera.name, 'coordinates': 'BLENDER_RIGHT_HANDED_Z_UP_WORLD_METERS',
                   'quaternionOrder': 'WXYZ', 'observations': observations},
        'video': {'filename': video.name, 'sha256': digest(video), 'byteLength': video.stat().st_size,
                  'mimeType': 'video/mp4'},
        'measuredMediaDurationMs': None, 'mediaProbeRequired': True,
        'sourceCoverage': 'NOT_ESTABLISHED', 'rightsStatus': 'UNKNOWN',
        'approvalGranted': False, 'finalMedia': False,
    }
    pending = output / 'motion-preview.json.partial'
    with pending.open('x', encoding='utf-8') as handle:
        json.dump(receipt, handle, indent=2, allow_nan=False)
        handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())
    pending.rename(output / 'motion-preview.json')
    print('CANISCREENWRITE_INTERNAL_PREVIS=' + str(video))
    print('CANISCREENWRITE_MOTION_RECEIPT=' + str(output / 'motion-preview.json'))


if __name__ == '__main__':
    main()
