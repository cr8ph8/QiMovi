"""Read an owned rehearsal in a second background process; never save it."""
import argparse
import hashlib
import json
import sys
from pathlib import Path
import bpy


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--kit', required=True)
    parser.add_argument('--returned', required=True)
    parser.add_argument('--receipt', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if not bpy.app.background or bpy.data.filepath:
        raise RuntimeError('Use a new background process without a loaded scene.')
    kit, returned = Path(args.kit).resolve(), Path(args.returned).resolve()
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    report = json.loads((returned / 'observation.json').read_text())
    blend = returned / 'rehearsal.blend'
    before = sha(blend)
    assert before == report['sceneFile']['sha256']
    bpy.ops.wm.open_mainfile(filepath=str(blend), load_ui=False, use_scripts=False)
    scene, camera = bpy.context.scene, bpy.context.scene.camera
    assert scene['caniscreenwrite_plan_json'] == (kit / 'stage-plan.json').read_text()
    assert scene['caniscreenwrite_exchange_json'] == (kit / 'camera-exchange.json').read_text()
    assert scene['caniscreenwrite_kit_files_sha256'] == sha(kit / 'files.json')
    assert camera.name == report['cameraObjectName']
    assert [scene.render.resolution_x, scene.render.resolution_y] == report['resolution']
    assert scene.render.fps == report['frameRate'] and scene.render.fps_base == report['frameRateBase']
    for expected in report['observedFrames']:
        scene.frame_set(expected['frame'])
        assert all(abs(a-b) < 1e-6 for a, b in zip(camera.matrix_world.translation, expected['worldPositionMeters']))
        assert all(abs(a-b) < 1e-6 for a, b in zip(camera.matrix_world.to_quaternion(), expected['worldQuaternionWXYZ']))
        assert abs(camera.data.lens - expected['lensMm']) < 1e-6
        assert abs(camera.data.sensor_width - expected['sensorWidthMm']) < 1e-6
        assert camera.data.sensor_fit == expected['sensorFit']
        if expected['media']:
            assert sha(returned / expected['media']['filename']) == expected['media']['sha256']
    assert sha(blend) == before
    evidence = {'schemaVersion': 'caniscreenwrite-blender-reopen/v1', 'sceneFileSha256': before,
                'kitFilesSha256': sha(kit / 'files.json'), 'applicationVersion': bpy.app.version_string,
                'embeddedInputsExact': True, 'cameraReadbackMatches': True, 'sceneFileUnchanged': True,
                'reopenedVerified': True, 'approvalGranted': False}
    with Path(args.receipt).open('x', encoding='utf-8') as handle:
        json.dump(evidence, handle, indent=2)
        handle.write('\n')


if __name__ == '__main__':
    main()
