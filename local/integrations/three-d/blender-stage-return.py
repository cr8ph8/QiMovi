"""Return a saved, filmmaker-edited rehearsal through its exact originating kit.

Run in a NEW background Blender process with --disable-autoexec. Never changes
the input .blend; creates an editable copy and three pending review stills.
"""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
import bpy


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scene', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if not bpy.app.background or bpy.data.filepath:
        raise RuntimeError('Use a new background process with no input .blend.')
    if bpy.context.preferences.filepaths.use_scripts_auto_execute:
        raise RuntimeError('Run Blender with --disable-autoexec.')
    base = Path(__file__).resolve().parent
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    manifest = json.loads((base / 'files.json').read_text())
    entries = {item['path']: item['sha256'] for item in manifest['files']}
    for name in ['stage-plan.json', 'camera-exchange.json', 'blender-stage.py', 'blender-stage-return.py']:
        if entries.get(name) != digest(base / name):
            raise RuntimeError('The originating kit changed: ' + name)
    source = Path(args.scene).expanduser().resolve(strict=True)
    output = Path(args.output).expanduser().resolve()
    if not source.is_file() or source.suffix.lower() != '.blend' or output.exists():
        raise RuntimeError('Choose a saved .blend and a new return directory.')
    before = digest(source)
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    plan_text = (base / 'stage-plan.json').read_text()
    exchange_text = (base / 'camera-exchange.json').read_text()
    if (scene.get('caniscreenwrite_plan_json') != plan_text
            or scene.get('caniscreenwrite_exchange_json') != exchange_text
            or scene.get('caniscreenwrite_kit_files_sha256') != digest(base / 'files.json')):
        raise RuntimeError('This scene does not carry the exact originating kit.')
    plan, exchange = json.loads(plan_text), json.loads(exchange_text)
    if plan['target'] != 'BLENDER' or scene.get('source_hash') != plan['sourceHash'] or scene.get('shot_id') != plan['shotId']:
        raise RuntimeError('Source or shot binding changed.')
    spec = importlib.util.spec_from_file_location('qimovi_rehearsal_export', base / 'blender-stage.py')
    exporter = importlib.util.module_from_spec(spec)
    # Keep the originating kit untouched, including no incidental __pycache__.
    bytecode_disabled = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(exporter)
    finally:
        sys.dont_write_bytecode = bytecode_disabled
    output.mkdir(parents=False, exist_ok=False)
    exporter.export_rehearsal(base, output, plan, exchange, scene, True)
    if digest(source) != before:
        raise RuntimeError('The original scene changed during export.')
    print('CANISCREENWRITE_EDITED_STAGE_RETURN=' + str(output / 'stage-return.zip'))


if __name__ == '__main__':
    main()
