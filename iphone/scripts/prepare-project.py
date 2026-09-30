#!/usr/bin/env python3
"""Generate the native QiMovi production companion's disposable Xcode project.

The maintained source is this repository's iphone/QiMovi directory. This script
does not read, copy, or compile QiCanIScreenwrite's application source. The alpha
bundle identifier intentionally stays stable so an installed alpha upgrades in
place without deleting the user's documents.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from xml.sax.saxutils import escape


def identifier(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:24].upper()


def encode(value, level: int = 0) -> str:
    pad = "\t" * level
    if isinstance(value, dict):
        return "{\n" + "".join(
            pad + "\t" + json.dumps(str(key)) + " = " + encode(item, level + 1) + ";\n"
            for key, item in value.items()
        ) + pad + "}"
    if isinstance(value, list):
        return "(\n" + "".join(pad + "\t" + encode(item, level + 1) + ",\n" for item in value) + pad + ")"
    return str(value) if isinstance(value, int) else json.dumps(value)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", nargs="?", default="/private/tmp/qimovi-production")
    parser.add_argument("--team", default=os.environ.get("QIMOVI_DEVELOPMENT_TEAM", ""), help="Your Apple development team ID; optional for Simulator")
    parser.add_argument("--bundle-id", default="com.hampton.qimovi.alpha", help="Use a unique identifier for your own device-signed build")
    args = parser.parse_args()
    source_root = Path(__file__).resolve().parents[1] / "QiMovi"
    destination = Path(args.destination).expanduser().resolve()
    project = destination / "QiMovi.xcodeproj"
    project.mkdir(parents=True, exist_ok=True)
    objects: dict[str, dict] = {}

    def add(label: str, **value) -> str:
        key = identifier(label)
        objects[key] = value
        return key

    sources, resources, children = [], [], []
    swift_files = sorted(path for path in source_root.rglob("*.swift")
                         if not any(part in {"Core", ".build", "Packages"} for part in path.relative_to(source_root).parts)
                         and path.name != "Package.swift")
    for path in swift_files:
        relative = str(path.relative_to(source_root))
        file_ref = add("file:" + relative, isa="PBXFileReference", lastKnownFileType="sourcecode.swift", path=str(path), sourceTree="<absolute>")
        children.append(file_ref)
        sources.append(add("source:" + relative, isa="PBXBuildFile", fileRef=file_ref))

    resource_root = source_root / "Resources"
    for path in sorted(resource_root.iterdir()) if resource_root.exists() else []:
        if path.name.startswith("."):
            continue
        relative = str(path.relative_to(source_root))
        file_type = "folder.assetcatalog" if path.suffix == ".xcassets" else "folder" if path.is_dir() else {
            ".json": "text.json", ".png": "image.png", ".jpg": "image.jpeg", ".jpeg": "image.jpeg"
        }.get(path.suffix.lower(), "file")
        file_ref = add("file:" + relative, isa="PBXFileReference", lastKnownFileType=file_type, path=str(path), sourceTree="<absolute>")
        children.append(file_ref)
        resources.append(add("resource:" + relative, isa="PBXBuildFile", fileRef=file_ref))

    info_ref = add("file:Info.plist", isa="PBXFileReference", lastKnownFileType="text.plist.xml", path=str(source_root / "Info.plist"), sourceTree="<absolute>")
    children.append(info_ref)
    product_ref = add("product", isa="PBXFileReference", explicitFileType="wrapper.application", includeInIndex=0, path="QiMoviAlpha.app", sourceTree="BUILT_PRODUCTS_DIR")
    source_group = add("source-group", isa="PBXGroup", children=children, name="QiMovi", sourceTree="<group>")
    product_group = add("product-group", isa="PBXGroup", children=[product_ref], name="Products", sourceTree="<group>")
    main_group = add("main-group", isa="PBXGroup", children=[source_group, product_group], sourceTree="<group>")
    source_phase = add("source-phase", isa="PBXSourcesBuildPhase", buildActionMask=2147483647, files=sources, runOnlyForDeploymentPostprocessing=0)
    resource_phase = add("resource-phase", isa="PBXResourcesBuildPhase", buildActionMask=2147483647, files=resources, runOnlyForDeploymentPostprocessing=0)
    framework_phase = add("framework-phase", isa="PBXFrameworksBuildPhase", buildActionMask=2147483647, files=[], runOnlyForDeploymentPostprocessing=0)
    project_configs, target_configs = [], []
    for name in ["Debug", "Release"]:
        project_configs.append(add("project-config:" + name, isa="XCBuildConfiguration", name=name, buildSettings={
            "CLANG_ENABLE_MODULES": "YES", "SDKROOT": "iphoneos", "IPHONEOS_DEPLOYMENT_TARGET": "17.0",
            "SWIFT_VERSION": "5.0", "SWIFT_STRICT_CONCURRENCY": "targeted",
            "SWIFT_OPTIMIZATION_LEVEL": "-Onone" if name == "Debug" else "-O",
            "DEBUG_INFORMATION_FORMAT": "dwarf" if name == "Debug" else "dwarf-with-dsym",
            "ENABLE_TESTABILITY": "YES" if name == "Debug" else "NO",
            "ONLY_ACTIVE_ARCH": "YES" if name == "Debug" else "NO",
            "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "$(inherited) DEBUG" if name == "Debug" else "$(inherited)",
        }))
        target_configs.append(add("target-config:" + name, isa="XCBuildConfiguration", name=name, buildSettings={
            "PRODUCT_NAME": "QiMoviAlpha", "PRODUCT_BUNDLE_IDENTIFIER": args.bundle_id,
            "MARKETING_VERSION": "0.5.0", "CURRENT_PROJECT_VERSION": "5",
            "DEVELOPMENT_TEAM": args.team, "CODE_SIGN_STYLE": "Automatic",
            "INFOPLIST_FILE": str(source_root / "Info.plist"), "GENERATE_INFOPLIST_FILE": "NO",
            "TARGETED_DEVICE_FAMILY": "1,2", "SUPPORTED_PLATFORMS": "iphoneos iphonesimulator",
            "SUPPORTS_MACCATALYST": "NO", "SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD": "NO",
            "ASSETCATALOG_COMPILER_APPICON_NAME": "QiMoviAppIcon", "SWIFT_EMIT_LOC_STRINGS": "YES",
            "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/Frameworks"],
            "ENABLE_USER_SCRIPT_SANDBOXING": "YES",
        }))
    project_list = add("project-config-list", isa="XCConfigurationList", buildConfigurations=project_configs, defaultConfigurationIsVisible=0, defaultConfigurationName="Release")
    target_list = add("target-config-list", isa="XCConfigurationList", buildConfigurations=target_configs, defaultConfigurationIsVisible=0, defaultConfigurationName="Release")
    target = add("target", isa="PBXNativeTarget", buildConfigurationList=target_list,
                 buildPhases=[source_phase, framework_phase, resource_phase], buildRules=[], dependencies=[],
                 name="QiMovi", productName="QiMoviAlpha", productReference=product_ref,
                 productType="com.apple.product-type.application")
    project_id = add("project", isa="PBXProject", attributes={"BuildIndependentTargetsInParallel": "YES", "LastUpgradeCheck": "2700", "TargetAttributes": {target: {"CreatedOnToolsVersion": "27.0", "ProvisioningStyle": "Automatic", "DevelopmentTeam": args.team}}},
                     buildConfigurationList=project_list, compatibilityVersion="Xcode 14.0", developmentRegion="en",
                     hasScannedForEncodings=0, knownRegions=["en", "Base"], mainGroup=main_group,
                     productRefGroup=product_group, projectDirPath="", projectRoot="", targets=[target])
    data = {"archiveVersion": 1, "classes": {}, "objectVersion": 56, "objects": objects, "rootObject": project_id}
    (project / "project.pbxproj").write_text("// !$*UTF8*$!\n" + encode(data) + "\n")
    scheme_dir = project / "xcshareddata" / "xcschemes"
    scheme_dir.mkdir(parents=True, exist_ok=True)
    buildable = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="QiMoviAlpha.app" BlueprintName="QiMovi" ReferencedContainer="container:{escape(project.name)}"/>'
    scheme = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.7">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries>
    <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{buildable}</BuildActionEntry>
  </BuildActionEntries></BuildAction>
  <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"/>
  <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{buildable}</BuildableProductRunnable></LaunchAction>
  <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{buildable}</BuildableProductRunnable></ProfileAction>
  <AnalyzeAction buildConfiguration="Debug"/>
  <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
'''
    (scheme_dir / "QiMovi.xcscheme").write_text(scheme)
    print(json.dumps({"project": str(project), "scheme": "QiMovi", "sourceRoot": str(source_root), "swiftFiles": len(swift_files), "resourceEntries": len(resources)}, indent=2))


if __name__ == "__main__":
    main()
