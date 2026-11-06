# Research lab: install and use

Research lab runs a bounded, offline search over fixed title, text and tag weights on authored synthetic filmmaking references. It makes no LLM or provider calls. Its accepted configuration is stored separately; live production search, creative records, production approvals and financing do not consume it.

The `feat/hampton-research-loop` branch is stacked on [QiMovi PR #5](https://github.com/cr8ph8/QiMovi/pull/5), `fix/preserve-native-token-counts`, rather than `main`. That dependency and the paired [QiScreenwrite PR #3](https://github.com/cr8ph8/QiScreenwrite/pull/3) remain draft and unmerged. The lab does not require Discovery PR #6.

## Try a fresh local workspace

Use Node.js 24.10 or newer. The commands below install the locked dependencies with Bun 1.4.0 and create an isolated temporary checkout and workspace. Run them in one terminal; keep or export any work you want to retain before removing the temporary directory.

```sh
QI_RESEARCH_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/qimovi-research.XXXXXX")"
git clone --branch feat/hampton-research-loop --single-branch \
  https://github.com/cr8ph8/QiMovi.git "$QI_RESEARCH_ROOT/source"
cd "$QI_RESEARCH_ROOT/source"
npx --yes bun@1.4.0 install --frozen-lockfile
npx --yes bun@1.4.0 run build:local

QI_RESEARCH_WORKSPACE="$QI_RESEARCH_ROOT/workspace"
node local/server/cli.mjs create-project \
  --data "$QI_RESEARCH_WORKSPACE" --title "Research lab demo"
node local/server/cli.mjs serve \
  --data "$QI_RESEARCH_WORKSPACE" --dist dist-local --port 4317
```

Open <http://127.0.0.1:4317/> and complete the local owner login. The owner token is in the new workspace's private `config.json`; enter it in the app's password field. Setup downloads dependencies; the experiment itself runs offline. See [Quick start](../QUICKSTART.md) for the existing owner workflow.

## Run an experiment

1. Open **Research lab** beside **Costs** in the authenticated app.
2. Choose the maximum candidate trials, whole-job allowance and evaluation timeout, then select **Start bounded run**.
3. Inspect the development and confirmation results, admission decision, resource observations and accepted settings version.
4. Use **Cancel run** to stop active work, or **Export research audit** to retain the complete receipts.

Closing the panel leaves the run active. Stopping the local service cancels active research before its storage closes. Restarting does not resume unfinished work automatically. A lost response can be retried with **Retry same request**, which retains the original request ID.

The policy permits at most **24 candidate trials**, **300 seconds for the whole job**, and **10 seconds per evaluation**. Baseline and confirmation evaluations share the whole-job allowance. The current target has eight candidate configurations, so it can finish before the requested ceiling. Evaluation is finite parameter search, not an autonomous code-writing agent.

## What admission means

- Only **COMMIT** changes the lab's accepted research configuration. **DAMP**, **ESCALATE** and **REJECT** preserve it.
- The parent evaluator scores returned source IDs against its labels. Candidate-supplied scores or assertions are not admission evidence.
- One finalist is selected using development results before confirmation is evaluated. The two splits use different relevant documents, but public labels are reused between runs. A fixture improvement does not establish generalization to real projects.
- Source hashes bind each run to the project and saved record versions. Final source validation and accepted-state admission run under synchronous SQLite locks; edits during the experiment cause escalation instead of stale acceptance.
- The parent enforces deadlines and terminates real worker threads. Workers run fixed repository code and receive numeric configuration; this is not a sandbox for arbitrary generated code.
- Missing or failed required checks cannot authorize acceptance. Dataset, evaluator and policy hashes bind the recorded experiment contract. Local hash chains detect inconsistencies but have no external anchor.

## Costs and backups

Provider input/output tokens and provider charge are known zero because this target makes no provider calls. That does not make computation free: whole-job elapsed time and returned serialized bytes are recorded; worker CPU is recorded when available and otherwise remains unknown. Electricity, hardware cost and unobserved resource use remain unmeasured.

Research receipts live in the separate `research-loop.sqlite` journal. The resource journal records start, measured evaluation consumption, and the final decision separately from HTTP request duration. Decision-inclusive elapsed time excludes the last telemetry write itself; a missing final receipt is marked OUTCOME_UNCERTAIN while known consumption remains available. A missing completion is uncertain, not zero usage. Export the research audit and resource journal separately from creative backups; the research result bytes are not a measurement of total disk consumption.

## Stage a macOS development candidate

On macOS 14 or later with Xcode/Swift tools, run from the built checkout above:

```sh
QI_RESEARCH_STAGE="$(mktemp -d /private/tmp/qimovi-research-stage.XXXXXX)"
QI_NODE_BIN="$(command -v node)" \
QI_STAGE_DIRECTORY="$QI_RESEARCH_STAGE" \
  bash script/build_and_run.sh --stage-only
```

The script stages `QiMovi.app` inside that new directory. It can use the installed Vite through Node if Bun is absent from `PATH`. This command does not replace an installed app or launch it. The candidate uses ad-hoc signing and is not a notarized distribution release. A successful web build does not establish native launch or installation on your Mac. See [Desktop packaging](../desktop/README.md).
