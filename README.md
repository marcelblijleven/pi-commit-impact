# pi-commit-impact

Pi extension that estimates the production regression risk of a commit/range using deterministic local heuristics plus optional TypeSafe.ai Jev HTTP analysis.

## Run locally

```bash
npm install
pi --extension .
```

Then use the Pi slash command:

```text
/commit-impact
/commit-impact HEAD --format markdown --fail-on high
/commit-impact --last 3 --format markdown
/commit-impact main..HEAD --format json --config pi-commit-impact.config.json
```

The extension also registers a model-callable `commit_impact` tool with the same core options. The tool supports `lastCommits`, so Pi can directly answer natural requests such as “what's the risk score of the last 3 commits?” without translating that into a git range itself.

## Use from other agents

Other coding agents can call the CLI through their shell tool:

```bash
npx pi-commit-impact --last 3 --format json
commit-impact HEAD --format markdown --fail-on high
commit-impact main..HEAD --config pi-commit-impact.config.json
```

When developing from this repo, run the local executable directly:

```bash
./commit-impact.js --last 3 --format json
```

The CLI exits with code `1` when `--fail-on` is supplied and the analyzed risk tier meets or exceeds the threshold, making it suitable for CI or agent guardrails.

## Configuration

Create `pi-commit-impact.config.json` at the repository root. See `pi-commit-impact.config.example.json`.

Secrets are not stored in config. Configure the TypeSafe System One endpoint (`https://api.typesafe.ai/v1/systemone`) in config and set `jev.tokenEnv` to the name of an environment variable containing the API key, commonly `TYPESAFE_API_KEY`.

The Jev request uses typed System One questions: a production-regression `score`, a critical-behavior-change `noul`, and a validation-focus `choice`. If `jev` is absent from config, the extension silently uses heuristic-only analysis. If `jev` is configured but invalid or the HTTP call fails, it returns heuristic-only analysis with a warning.

## Signals

The MVP scores:

- conventional commit type and configurable keywords
- changed file count
- line churn
- critical path globs
- file types/extensions
- whether tests changed
- Jev HTTP score/tier/evidence when configured

Output is Markdown or JSON and does not require custom TUI rendering.
