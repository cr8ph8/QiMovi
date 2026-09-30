# Third-party notices and reserved material

QiMovi's original code is released under the root MIT [LICENSE](LICENSE). That grant does not replace upstream licenses or grant rights to creative assets and branding.

## Dependency inventory

| Component group | Where to find the exact inventory | Notes |
|---|---|---|
| React/Vite/TypeScript interface and UI/media libraries | `package.json`, `bun.lock`, and installed package license files | Includes React, Radix UI, Three.js, document/export libraries, and other dependencies. Each retains its upstream terms. |
| Local service runtime dependencies | `package.json` and the dependency closure staged by `script/stage_desktop.mjs` | The native bundle includes Node and the required runtime dependency tree. Preserve their notices when redistributing a binary. |
| Apple frameworks and SF Symbols | SDK/platform components referenced by the Swift targets | SwiftUI, AppKit, WebKit, UIKit, Foundation, Core Motion, and related APIs are provided by Apple. Their implementations are not vendored here. |
| Python 3 standard library | `iphone/scripts/prepare-project.py` | Used for Xcode-project generation, supplied by the developer's environment. |
| External DCC/editor/model/generation tools | Integration code under `local/` | Connecting to an application or service does not sublicense it, provide credentials, or include a subscription. |

This table is an index, not a substitute for upstream license texts. The lockfile records dependency versions. Do not assume every installed dependency is MIT or that every dependency is emitted into the local build.

## Packaged notices

`script/stage_licence_notices.mjs` collects available upstream notices from installed production dependencies and the selected Node version into the app's `Contents/Resources/Notices` directory. Its generated index records component versions, hashes, retained texts, and missing notices.

Check that index before redistributing a build. Missing notices require resolution; a generated index is not legal clearance. Repackaging external executables may require additional source, notices, or redistribution conditions under their own licenses. Keep optional GPL or other separately licensed runtimes outside an assumed MIT-only distribution until their obligations are satisfied.

## Creative assets and branding

Private screenplays, story worlds, characters, film footage, performances, production budgets, documents, and artwork are excluded from the public source release unless separately marked and cleared. QiMovi and Quotient Intelligent names, logos, and branding are reserved and are not licensed under MIT.

Use synthetic or separately cleared examples. Use your own cleared branding for derivative products. The presence of an asset reference, hash, export feature, NFT preparation, or participation record does not establish ownership or a transferable right.

References to Apple, Blender, Unity, DaVinci Resolve, Codex, and QiCanIScreenwrite describe platforms or interoperability and do not imply endorsement.
