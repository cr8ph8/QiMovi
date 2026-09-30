"""QiMovi's bounded stdio MCP server for the installed Resolve scripting API.

No application launch, project switch, import, export, render or modification.
The vendor API is loaded only when an explicitly requested tool needs it.
"""
import argparse
import importlib.util
import json
import math
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True

PROTOCOL = "2025-06-18"
LIMIT_TIMELINES = 50
LIMIT_TRACKS = 12
LIMIT_ITEMS = 50
LIMIT_TOTAL_ITEMS = 200
MAX_REQUEST_BYTES = 16384
SERVER = {"name": "qimovi-resolve-readonly", "version": "1.0.0"}
EMPTY = {"type": "object", "properties": {}, "additionalProperties": False}
TOOLS = [
    {"name": "qimovi_resolve_probe", "title": "Check local Resolve scripting", "description": "Read the running local Resolve product and version. Does not launch or configure Resolve.", "inputSchema": EMPTY},
    {"name": "qimovi_resolve_current_project", "title": "Inspect the open project", "description": "Read only the open project and at most 50 timeline identities. Does not open another project.", "inputSchema": EMPTY},
    {"name": "qimovi_resolve_current_timeline", "title": "Inspect the open timeline", "description": "Read the expected current project and timeline, at most 12 tracks per type and 200 item summaries. No media paths or editing.", "inputSchema": {"type": "object", "properties": {"expectedProjectId": {"type": "string", "minLength": 1, "maxLength": 256}, "expectedTimelineId": {"type": "string", "minLength": 1, "maxLength": 256}}, "required": ["expectedProjectId", "expectedTimelineId"], "additionalProperties": False}},
]
for tool in TOOLS:
    tool["annotations"] = {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False}


class ResolveReadError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise ResolveReadError(code)


def text(value, limit=1024):
    require(isinstance(value, str) and len(value) <= limit and "\x00" not in value, "RESOLVE_RESPONSE_INVALID")
    return value


def number(value):
    require(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value), "RESOLVE_RESPONSE_INVALID")
    return value


def count(value):
    require(isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 1000000, "RESOLVE_RESPONSE_INVALID")
    return value


def identity(value):
    require(value is not None, "RESOLVE_NO_CURRENT_PROJECT")
    result = {"id": text(value.GetUniqueId(), 256), "name": text(value.GetName())}
    require(bool(result["id"]), "RESOLVE_IDENTITY_UNAVAILABLE")
    return result


def connect(app_root):
    module_path = app_root / "Contents/Resources/Developer/Scripting/Modules/DaVinciResolveScript.py"
    library_path = app_root / "Contents/Libraries/Fusion/fusionscript.so"
    require(module_path.is_file() and library_path.is_file(), "RESOLVE_SDK_UNAVAILABLE")
    os.environ["RESOLVE_SCRIPT_LIB"] = str(library_path)
    try:
        spec = importlib.util.spec_from_file_location("DaVinciResolveScript", str(module_path))
        require(spec is not None and spec.loader is not None, "RESOLVE_SDK_UNAVAILABLE")
        module = importlib.util.module_from_spec(spec)
        sys.modules["DaVinciResolveScript"] = module
        spec.loader.exec_module(module)
        # The vendor loader installs its extension under this module identity.
        module = sys.modules["DaVinciResolveScript"]
        resolve = module.scriptapp("Resolve")
    except ResolveReadError:
        raise
    except Exception:
        raise ResolveReadError("RESOLVE_SDK_LOAD_FAILED")
    require(resolve is not None, "RESOLVE_SCRIPTING_UNAVAILABLE")
    return resolve


def current_project(resolve):
    manager = resolve.GetProjectManager()
    require(manager is not None, "RESOLVE_PROJECT_MANAGER_UNAVAILABLE")
    project = manager.GetCurrentProject()
    require(project is not None, "RESOLVE_NO_CURRENT_PROJECT")
    return manager, project


def inspect_project(resolve):
    manager, project = current_project(resolve)
    basis = identity(project)
    timeline_count = count(project.GetTimelineCount())
    current = project.GetCurrentTimeline()
    current_identity = identity(current) if current is not None else None
    timelines = []
    for index in range(1, min(timeline_count, LIMIT_TIMELINES) + 1):
        timeline = project.GetTimelineByIndex(index)
        require(timeline is not None, "RESOLVE_PROJECT_CHANGED")
        timelines.append(dict(identity(timeline), index=index))
    require(identity(manager.GetCurrentProject())["id"] == basis["id"] and count(project.GetTimelineCount()) == timeline_count, "RESOLVE_PROJECT_CHANGED")
    after = project.GetCurrentTimeline()
    require((identity(after) if after is not None else None) == current_identity, "RESOLVE_TIMELINE_CHANGED")
    return {"project": dict(basis, timelineCount=timeline_count, currentTimeline=current_identity, timelines=timelines, timelinesTruncated=timeline_count > LIMIT_TIMELINES)}


def inspect_timeline(resolve, args):
    manager, project = current_project(resolve)
    project_basis = identity(project)
    require(project_basis["id"] == args["expectedProjectId"], "RESOLVE_PROJECT_CHANGED")
    timeline = project.GetCurrentTimeline()
    require(timeline is not None, "RESOLVE_NO_CURRENT_TIMELINE")
    basis = identity(timeline)
    require(basis["id"] == args["expectedTimelineId"], "RESOLVE_TIMELINE_CHANGED")
    result = dict(basis, startFrame=number(timeline.GetStartFrame()), endFrame=number(timeline.GetEndFrame()), startTimecode=text(timeline.GetStartTimecode(), 80), frameRate=text(str(timeline.GetSetting("timelineFrameRate")), 80), width=text(str(timeline.GetSetting("timelineResolutionWidth")), 80), height=text(str(timeline.GetSetting("timelineResolutionHeight")), 80), tracks=[], tracksTruncated=False)
    retained = 0
    for kind in ("video", "audio", "subtitle"):
        track_count = count(timeline.GetTrackCount(kind))
        result["tracksTruncated"] |= track_count > LIMIT_TRACKS
        for index in range(1, min(track_count, LIMIT_TRACKS) + 1):
            clips = timeline.GetItemListInTrack(kind, index)
            require(isinstance(clips, list), "RESOLVE_RESPONSE_INVALID")
            capacity = min(LIMIT_ITEMS, max(0, LIMIT_TOTAL_ITEMS - retained))
            summaries = []
            for clip in clips[:capacity]:
                summaries.append({"name": text(clip.GetName()), "startFrame": number(clip.GetStart()), "endFrame": number(clip.GetEnd()), "durationFrames": number(clip.GetDuration())})
            retained += len(summaries)
            result["tracks"].append({"type": kind, "index": index, "name": text(timeline.GetTrackName(kind, index)), "itemCount": len(clips), "items": summaries, "itemsTruncated": len(clips) > len(summaries)})
    require(identity(manager.GetCurrentProject())["id"] == project_basis["id"], "RESOLVE_PROJECT_CHANGED")
    after = project.GetCurrentTimeline()
    require(after is not None and identity(after)["id"] == basis["id"], "RESOLVE_TIMELINE_CHANGED")
    return {"project": project_basis, "timeline": result}


def call_tool(name, args, app_root, connector=connect):
    require(isinstance(args, dict), "RESOLVE_ARGUMENTS_INVALID")
    require(name in [tool["name"] for tool in TOOLS], "RESOLVE_TOOL_NOT_ALLOWED")
    if name == "qimovi_resolve_current_timeline":
        require(set(args) == {"expectedProjectId", "expectedTimelineId"}, "RESOLVE_ARGUMENTS_INVALID")
        for value in args.values():
            require(isinstance(value, str) and 0 < len(value) <= 256 and not any(ord(char) < 32 or ord(char) == 127 for char in value), "RESOLVE_ARGUMENTS_INVALID")
    else:
        require(not args, "RESOLVE_ARGUMENTS_INVALID")
    if name == "qimovi_resolve_probe":
        try:
            resolve = connector(app_root)
            return {"available": True, "productName": text(resolve.GetProductName()), "version": text(resolve.GetVersionString(), 80), "reason": None}
        except ResolveReadError as error:
            return {"available": False, "reason": str(error), "productName": None, "version": None}
    resolve = connector(app_root)
    return inspect_project(resolve) if name == "qimovi_resolve_current_project" else inspect_timeline(resolve, args)


def serve(app_root):
    # Native SDK diagnostics sometimes write directly to fd 1. Keep protocol
    # output on a private duplicate so stdout remains valid MCP JSON lines.
    output = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    sys.stdout = sys.stderr
    initialized = False
    ready = False

    def send(value):
        output.write(json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(",", ":")) + "\n")

    while True:
        raw = sys.stdin.buffer.readline(MAX_REQUEST_BYTES + 1)
        if not raw:
            break
        if len(raw) > MAX_REQUEST_BYTES:
            break
        request = None
        try:
            request = json.loads(raw)
            require(isinstance(request, dict) and request.get("jsonrpc") == "2.0" and set(request) <= {"jsonrpc", "id", "method", "params"}, "RESOLVE_PROTOCOL_INVALID")
            method = request.get("method")
            params = request.get("params", {})
            require(isinstance(params, dict), "RESOLVE_PROTOCOL_INVALID")
            if method == "notifications/initialized" and "id" not in request:
                require(initialized and not params, "RESOLVE_PROTOCOL_INVALID")
                ready = True
                continue
            require(isinstance(request.get("id"), (str, int)) and not isinstance(request.get("id"), bool), "RESOLVE_PROTOCOL_INVALID")
            if method == "initialize":
                require(not initialized and params.get("protocolVersion") == PROTOCOL and isinstance(params.get("capabilities"), dict) and isinstance(params.get("clientInfo"), dict), "RESOLVE_PROTOCOL_INVALID")
                initialized = True
                result = {"protocolVersion": PROTOCOL, "capabilities": {"tools": {}}, "serverInfo": SERVER}
            elif method == "tools/list":
                require(ready and not params, "RESOLVE_PROTOCOL_INVALID")
                result = {"tools": TOOLS}
            elif method == "tools/call":
                require(ready and set(params) == {"name", "arguments"}, "RESOLVE_PROTOCOL_INVALID")
                try:
                    data = call_tool(params["name"], params["arguments"], app_root)
                    result = {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=True, allow_nan=False)}], "structuredContent": data, "isError": False}
                except ResolveReadError as error:
                    result = {"content": [{"type": "text", "text": str(error)}], "structuredContent": {"error": str(error)}, "isError": True}
                except Exception:
                    result = {"content": [{"type": "text", "text": "RESOLVE_READ_FAILED"}], "structuredContent": {"error": "RESOLVE_READ_FAILED"}, "isError": True}
            elif method == "ping":
                result = {}
            else:
                send({"jsonrpc": "2.0", "id": request["id"], "error": {"code": -32601, "message": "Method not supported"}})
                continue
            send({"jsonrpc": "2.0", "id": request["id"], "result": result})
        except (ValueError, ResolveReadError):
            send({"jsonrpc": "2.0", "id": request.get("id") if isinstance(request, dict) else None, "error": {"code": -32600, "message": "Invalid request"}})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-root", required=True)
    args = parser.parse_args()
    serve(Path(args.app_root).resolve())
