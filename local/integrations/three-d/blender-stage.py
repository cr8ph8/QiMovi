"""CanIScreenwrite disposable rehearsal template. Run inside a NEW Blender process.
Source/exchange stay unchanged. No provider calls or application-store writes.
"""
import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path

import bpy
from mathutils import Vector


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_previz(value):
    if (not isinstance(value, dict) or set(value) != {'layout', 'depthLayers', 'subjectCount', 'lookNotes'}
            or value['layout'] not in {'OPEN_GROUND', 'ENCLOSED_ROOM', 'WOODED_PATH', 'VEHICLE_DECK', 'ALLEY', 'STAIRWELL'}
            or type(value['depthLayers']) is not bool or type(value['subjectCount']) is not int
            or not 1 <= value['subjectCount'] <= 6 or not isinstance(value['lookNotes'], str)
            or len(value['lookNotes'].encode('utf-16-le')) // 2 > 4000
            or any(ord(c) < 32 and c not in '\t\n\r' or ord(c) == 127 for c in value['lookNotes'])):
        raise RuntimeError('Invalid explicit greybox options.')


def proxy_box(name, location, dimensions, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    item = bpy.context.object
    item.name = name
    item.dimensions = dimensions
    item.parent = parent
    item['authority'] = 'AUTHORED_PROXY_NOT_RECONSTRUCTED_SET'
    item['source_identity_assigned'] = False
    return item


def make_greybox(scene, options):
    """Only enum/numeric settings construct geometry; prose is never interpreted."""
    scene.render.engine = 'BLENDER_WORKBENCH'
    shading = scene.display.shading
    shading.light = 'STUDIO'
    shading.color_type = 'SINGLE'
    shading.single_color = (0.55, 0.55, 0.55)
    shading.background_type = 'VIEWPORT'
    shading.background_color = (0.08, 0.08, 0.08)
    shading.show_shadows = True
    shading.show_cavity = True
    shading.cavity_type = 'BOTH'
    scene['phone_capture_status'] = 'NOT_CONNECTED'
    scene['previz_options_json'] = json.dumps(options, ensure_ascii=False)
    layout = options['layout']
    rig = None
    if layout == 'VEHICLE_DECK':
        rig = bpy.data.objects.new('VEHICLE_DECK_RIG_PLANNED', None)
        scene.collection.objects.link(rig)
        rig['authority'] = 'AUTHORED_IDENTITY_RIG_NO_VEHICLE_MOTION'
        rig['phone_capture_status'] = 'NOT_CONNECTED'
        proxy_box('PROXY_DECK', (0, -2, -0.12), (5, 16, 0.24), rig)
        for side in (-1, 1):
            proxy_box('PROXY_DECK_SIDE_RAIL_' + str(side), (side * 2.4, -2, 1), (0.12, 16, 0.12), rig)
            for index, y in enumerate((-9, -5, -1, 3, 5)):
                proxy_box('PROXY_DECK_RAIL_POST_%s_%s' % (side, index), (side * 2.4, y, 0.5), (0.12, 0.12, 1), rig)
    else:
        proxy_box('PROXY_GROUND', (0, 0, -0.12), (20, 24, 0.24))
    if layout in {'ENCLOSED_ROOM', 'ALLEY'}:
        for side in (-1, 1):
            proxy_box('PROXY_SIDE_WALL_' + str(side), (side * 3.5, 0, 2), (0.25, 18, 4))
        if layout == 'ENCLOSED_ROOM':
            proxy_box('PROXY_REAR_WALL', (0, 8.5, 2), (7, 0.25, 4))
    elif layout == 'WOODED_PATH':
        for side in (-1, 1):
            for index, y in enumerate((-3, 1, 5, 9)):
                bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.35, depth=4, location=(side * 3, y, 2))
                item = bpy.context.object
                item.name = 'PROXY_PATH_COLUMN_%s_%s' % (side, index)
                item['authority'] = 'UNASSIGNED_ENVIRONMENT_PROXY'
                item['source_identity_assigned'] = False
    elif layout == 'STAIRWELL':
        for index in range(8):
            height = (index + 1) * 0.2
            proxy_box('PROXY_STEP_%02d' % (index + 1), (0, 2 + index * 0.45, height / 2), (2.6, 0.45, height))
            for side in (-1, 1):
                proxy_box('PROXY_STAIR_RAIL_POST_%s_%s' % (side, index), (side * 1.4, 2 + index * 0.45, height + 0.5), (0.1, 0.1, 1))
                proxy_box('PROXY_STAIR_RAIL_%s_%s' % (side, index), (side * 1.4, 2 + index * 0.45, height + 1), (0.12, 0.55, 0.12))
        proxy_box('PROXY_LANDING', (0, 6.4, 0.8), (3, 2, 1.6))
    if options['depthLayers']:
        for label, y, x in [('FOREGROUND', -3, -1.25), ('MIDDLE_GROUND', 1.8, 2), ('BACKGROUND', 7, -2)]:
            marker = proxy_box('PROXY_DEPTH_' + label, (x, y, 0.6), (0.4, 0.4, 1.2), rig)
            marker['depth_layer'] = label
    columns = min(options['subjectCount'], 3)
    for index in range(options['subjectCount']):
        x = (index % columns - (columns - 1) / 2) * 1.2
        y = (index // columns) * 1.4
        name = 'UNASSIGNED_SUBJECT_%02d' % (index + 1)
        subject = bpy.data.objects.new(name, None)
        scene.collection.objects.link(subject)
        subject.parent = rig
        subject['source_identity_assigned'] = False
        subject['authority'] = 'UNASSIGNED_SUBJECT_PROXY_NOT_CASTING'
        proxy_box(name + '_BODY', (x, y, 0.75), (0.5, 0.35, 1.5), subject)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.22, location=(x, y, 1.72))
        head = bpy.context.object
        head.name = name + '_HEAD'
        head.parent = subject
        head['source_identity_assigned'] = False
    return rig


def write_return_package(base, output, plan, exchange, report):
    """Retain exact originating inputs and a ZIP; this is pending evidence only."""
    for returned, original in [('stage-plan.json', 'stage-plan.json'),
                               ('camera-exchange.json', 'camera-exchange.json'),
                               ('kit-files.json', 'files.json')]:
        (output / returned).write_bytes((base / original).read_bytes())
    media = []
    for frame in report['observedFrames']:
        if frame['media']:
            media.append({'path': frame['media']['filename'], 'sha256': frame['media']['sha256'],
                          'role': 'OPENING' if frame['label'] == 'opening' else 'ENDING' if frame['label'] == 'ending' else 'MOMENT',
                          'frame': frame['frame']})
    names = ['stage-plan.json', 'camera-exchange.json', 'kit-files.json', 'observation.json', report['sceneFile']['filename']]
    names.extend(item['path'] for item in media)
    receipt = {
        'schemaVersion': 'caniscreenwrite-dcc-stage-return/v1', 'authority': 'DCC_RETURN_PENDING_REVIEW',
        'kitFilesSha256': sha(base / 'files.json'),
        'origin': {'projectId': plan['projectId'], 'sourceHash': plan['sourceHash'], 'sceneId': plan['sceneId'],
                   'shotId': plan['shotId'], 'target': 'BLENDER', 'basisSha256': plan['basisSha256'],
                   'exchangeSha256': exchange['sha256'], 'planFileSha256': sha(base / 'stage-plan.json'),
                   'exchangeFileSha256': sha(base / 'camera-exchange.json')},
        'application': {'name': 'Blender', 'version': bpy.app.version_string},
        'observation': {'path': 'observation.json', 'sha256': sha(output / 'observation.json')},
        'sceneFile': {'path': report['sceneFile']['filename'], 'sha256': report['sceneFile']['sha256']},
        'media': media,
        'files': [{'path': name, 'sha256': sha(output / name), 'byteLength': (output / name).stat().st_size} for name in names],
        'measuredMediaDurationMs': None, 'rightsStatus': 'UNKNOWN',
        'reopenedVerified': False, 'approvalGranted': False, 'finalMedia': False,
    }
    (output / 'stage-return.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    with zipfile.ZipFile(output / 'stage-return.zip', 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for name in ['stage-return.json', *names]:
            archive.write(output / name, arcname=name)


def export_rehearsal(base, output, plan, exchange, scene, render):
    """Export an owned scene copy with actual camera observations; inputs stay frozen."""
    camera = scene.camera
    if camera is None or camera.type != 'CAMERA':
        raise RuntimeError('The rehearsal needs an active camera.')
    if scene.frame_end - scene.frame_start < 2:
        raise RuntimeError('Use at least three frames for opening, midpoint and ending.')
    if scene.render.image_settings.file_format != 'PNG':
        raise RuntimeError('Set rehearsal output format to PNG before returning frames.')
    if scene.unit_settings.scale_length != 1:
        raise RuntimeError('Use scene unit scale 1.0 before returning world-meter camera observations.')
    # A compositor File Output can write beyond render.filepath. This bounded
    # return only permits its three owned PNG destinations, including in groups.
    if render and scene.use_nodes and scene.node_tree:
        pending, visited = [scene.node_tree], set()
        while pending:
            tree = pending.pop()
            identity = tree.as_pointer()
            if identity in visited:
                continue
            visited.add(identity)
            for node in tree.nodes:
                if node.type == 'OUTPUT_FILE':
                    raise RuntimeError('Remove compositor File Output nodes before returning preview frames; they can write outside the return directory.')
                nested = getattr(node, 'node_tree', None)
                if nested:
                    pending.append(nested)
    original_frame, original_subframe = scene.frame_current, scene.frame_subframe
    original_filepath = scene.render.filepath
    blend = output / 'rehearsal.blend'
    samples = [('opening', scene.frame_start), ('midpoint', (scene.frame_start + scene.frame_end) // 2), ('ending', scene.frame_end)]
    try:
        # The v2 receipt names one camera. Never label another camera's rendered
        # view with the first camera's observations after a timeline marker cut.
        for _, frame in samples:
            scene.frame_set(frame)
            if scene.camera != camera:
                raise RuntimeError('Use one active camera across opening, midpoint and ending samples; return separate shots for camera cuts.')
        scene.frame_set(original_frame, subframe=original_subframe)
        scene.camera = camera
        # copy=True preserves the input file and saved edit position.
        bpy.ops.wm.save_as_mainfile(filepath=str(blend), copy=True)
        frames = []
        for name, frame in samples:
            scene.frame_set(frame)
            item = {'label': name, 'frame': frame, 'worldPositionMeters': list(camera.matrix_world.translation),
                    'worldQuaternionWXYZ': list(camera.matrix_world.to_quaternion()), 'lensMm': camera.data.lens,
                    'sensorWidthMm': camera.data.sensor_width, 'sensorFit': camera.data.sensor_fit, 'media': None}
            if render:
                image = output / (name + '.png')
                scene.render.filepath = str(image)
                bpy.ops.render.render(write_still=True)
                item['media'] = {'filename': image.name, 'sha256': sha(image), 'role': 'REHEARSAL_PREVIEW_PENDING_REVIEW'}
            frames.append(item)
        report = {'schemaVersion': 'caniscreenwrite-blender-rehearsal-observation/v2',
                  'sourceHash': plan['sourceHash'], 'projectId': plan['projectId'], 'sceneId': plan['sceneId'], 'shotId': plan['shotId'],
                  'basisSha256': plan['basisSha256'], 'planFileSha256': sha(base / 'stage-plan.json'),
                  'exchangeFileSha256': sha(base / 'camera-exchange.json'), 'exchangeSha256': exchange['sha256'],
                  'kitFilesSha256': sha(base / 'files.json'), 'applicationVersion': bpy.app.version_string,
                  'cameraObjectName': camera.name,
                  'sceneFile': {'filename': blend.name, 'sha256': sha(blend)},
                  'coordinates': 'BLENDER_RIGHT_HANDED_Z_UP_WORLD_METERS;OBSERVED_QUATERNION_WXYZ',
                  'frameRate': scene.render.fps, 'frameRateBase': scene.render.fps_base,
                  'frameRange': [scene.frame_start, scene.frame_end],
                  'resolution': [scene.render.resolution_x, scene.render.resolution_y],
                  'resolutionPercentage': scene.render.resolution_percentage, 'observedFrames': frames,
                  'measuredMediaDurationMs': None, 'reopenedVerified': False, 'approvalGranted': False, 'finalMedia': False}
        (output / 'observation.json').write_text(json.dumps(report, indent=2) + '\n')
        write_return_package(base, output, plan, exchange, report)
    finally:
        scene.frame_set(original_frame, subframe=original_subframe)
        scene.camera = camera
        scene.render.filepath = original_filepath


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if not bpy.app.background or bpy.data.filepath:
        raise RuntimeError('Use a new background Blender process without an input .blend file.')
    base = Path(__file__).resolve().parent
    manifest = json.loads((base / 'files.json').read_text())
    entries = {item['path']: item['sha256'] for item in manifest['files']}
    for name in ['stage-plan.json', 'camera-exchange.json', 'blender-stage.py']:
        if entries.get(name) != sha(base / name):
            raise RuntimeError('The exported kit changed: ' + name)
    plan = json.loads((base / 'stage-plan.json').read_text())
    exchange = json.loads((base / 'camera-exchange.json').read_text())
    if (plan['target'] != 'BLENDER' or plan['exchangeSha256'] != exchange['sha256']
            or plan['sourceHash'] != exchange['source']['sourceHash']
            or plan['projectId'] != exchange['source']['projectId'] or plan['sceneId'] != exchange['scene']['id']
            or plan['basisSha256'] != exchange['basis']['sha256']
            or not any(shot['id'] == plan['shotId'] for shot in exchange['scene']['shots'])):
        raise RuntimeError('Plan/source binding mismatch.')
    if 'previz' in plan:
        validate_previz(plan['previz'])
        for name in ['previz-brief.json', 'previz-prompts.md']:
            if entries.get(name) != sha(base / name):
                raise RuntimeError('The exported greybox brief changed: ' + name)
    output = Path(args.output).expanduser().resolve()
    output.mkdir(parents=False, exist_ok=False)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = 'CanIScreenwrite rehearsal ' + plan['shotId']
    scene['caniscreenwrite_plan_json'] = (base / 'stage-plan.json').read_text()
    scene['caniscreenwrite_exchange_json'] = (base / 'camera-exchange.json').read_text()
    scene['caniscreenwrite_kit_files_sha256'] = sha(base / 'files.json')
    scene['caniscreenwrite_plan_file_sha256'] = sha(base / 'stage-plan.json')
    scene['source_hash'] = plan['sourceHash']
    scene['shot_id'] = plan['shotId']
    scene['authority'] = 'AUTHORED_TEMPLATE_PENDING_REVIEW'
    if 'previz' in plan:
        scene['caniscreenwrite_previz_brief_json'] = (base / 'previz-brief.json').read_text()
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    settings = plan['cameraTemplate']
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.fps = settings['frameRate']
    scene.render.resolution_x = settings['widthPixels']
    scene.render.resolution_y = settings['heightPixels']
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.frame_start = 1
    scene.frame_end = settings['durationSeconds'] * settings['frameRate']
    camera_rig = None
    if 'previz' in plan:
        camera_rig = make_greybox(scene, plan['previz'])
    else:
        bpy.ops.mesh.primitive_plane_add(size=20)
        bpy.context.object.name = 'Proposed neutral floor — not source scenery'
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 1))
        block = bpy.context.object
        block.name = 'Unassigned blocking stand-in'
        block.scale = (0.65, 0.65, 2)
        block['source_identity_assigned'] = False
        bpy.ops.object.light_add(type='AREA', location=(0, -3, 6))
        light = bpy.context.object
        light.data.energy = 1200
        light.data.shape = 'DISK'
        light.data.size = 5
        light.rotation_euler = (0.3, 0, 0)
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.name = 'CAM_PHONE' if 'previz' in plan else 'Proposed camera ' + plan['shotId']
    if 'previz' in plan:
        camera.parent = camera_rig
        camera['authority'] = 'PLANNED_CAMERA_NOT_DEVICE_CAPTURE'
        camera['phone_capture_status'] = 'NOT_CONNECTED'
    camera.data.lens = settings['lensMm']
    camera.data.sensor_width = settings['sensorWidthMm']
    camera.data.sensor_fit = 'HORIZONTAL'
    camera.rotation_mode = 'QUATERNION'
    scene.camera = camera
    start = Vector([value / 1000 for value in settings['blenderStartPositionMillimeters']])
    target = Vector([value / 1000 for value in settings['blenderLookAtMillimeters']])
    end = start.copy()
    end.y += (1 if settings['motion'] == 'DOLLY_IN' else -1 if settings['motion'] == 'DOLLY_OUT' else 0) * settings['travelMm'] / 1000
    for frame, position in [(scene.frame_start, start), (scene.frame_end, end)]:
        camera.location = position
        camera.rotation_quaternion = (target - position).to_track_quat('-Z', 'Y')
        camera.keyframe_insert(data_path='location', frame=frame)
        camera.keyframe_insert(data_path='rotation_quaternion', frame=frame)
    # Two explicit pose keys are rehearsal instructions. Read actual sampled poses below.
    scene.frame_set(scene.frame_start)
    export_rehearsal(base, output, plan, exchange, scene, args.render)
    print('CANISCREENWRITE_REHEARSAL_OUTPUT=' + str(output))
    print('CANISCREENWRITE_STAGE_RETURN=' + str(output / 'stage-return.zip'))


if __name__ == '__main__':
    main()
