# Configure roles and profiles

omt reads two config files:

- The user config, `~/.config/oh-my-t3code/config.jsonc`, applies to all projects. `omt install` and `omt config init` create it.
- The project config, `.omt/config.jsonc`, overrides the user config for one project. `omt install --project` and `omt init` create it.

`omt config path` prints both paths and says which files exist. `omt config init` writes the user starter config, and `--force` overwrites an existing file.

Run `omt config validate` after each change. It checks every key of both files and every profile, also the profiles that you do not select, and it exits 1 on an error. The [spec](spec.md#62-layer-validation) has the full schema and the merge rules.

To let omt make a change for you, ask the agent in a T3 thread to set up omt. The `omt-setup` skill runs the commands on this page, shows each change, and asks before it writes. For help with a question, ask `$omt-help`.

## Get autocomplete in your editor

Each starter config has a `$schema` line near the top, below a few comment lines. A config file with only this line and the version looks like this:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/gabimoncha/oh-my-t3code/main/schema/omt.schema.json",
  "version": 1
}
```

An editor that reads JSON Schema, such as VS Code, uses this line to complete keys and values and to mark an unknown key. Add the line to a config file that does not have it. omt itself ignores the line.

## Default roles

A role, such as `execute` or `review`, maps to an ordered chain of provider, model, and effort. The agent uses the first entry that T3 accepts. Each entry in the chain is a rung.

| Role | Use | First choice | Fallback |
| --- | --- | --- | --- |
| `explore` | Answer one narrow question about this repository | GPT-6-Luna, low | Claude Sonnet 5.5, low |
| `research` | Answer a question from docs, the web, and code | GPT-6.1-Sol, low | Claude Opus 5.5, low |
| `plan` | Turn a goal into a plan file | Claude Opus 5.5, xhigh | GPT-6-Astra, xhigh |
| `plan-review` | Check a plan for gaps | GPT-6-Astra, high | Claude Opus 5.5, high |
| `grill` | Test a goal before it has a plan: edge cases, questions, and options | GPT-6-Astra, high | Claude Opus 5.5, high |
| `execute` | Implement one planned unit | Claude Opus 5.5, medium | GPT-6.1-Sol, xhigh |
| `quick` | Make a small, mechanical change | GPT-6-Luna, high | Claude Sonnet 5.5, low |
| `deep` | Solve a hard or cross-cutting problem | Claude Opus 5.5, max | GPT-6-Astra, xhigh |
| `review` | Review a diff against its brief | GPT-6-Astra, high | Claude Opus 5.5, high |
| `oracle` | Attack the finished change before it counts as done | GPT-6-Astra, high | Claude Opus 5.5, high |
| `verify` | Run the artifact, existing checks, and device flows | Claude Haiku 5.5, medium | Claude Sonnet 5.5, low; then GPT-6.1-Sol, low |
| `qa` | Write only the approved test lines after verification | GPT-6.1-Sol, medium | Claude Sonnet 5.5, medium |
| `guardrail` | Propose checks and rule fixes for review findings | Claude Opus 5.5, high | GPT-6-Astra, high |
| `writing` | Write or edit documentation | Claude Opus 5.5, high | GPT-6-Astra, medium |
| `design` | Design screens and flows, and write a design spec | Claude Opus 5.5, high | none |
| `ui` | Implement one UI unit from its design spec | Claude Opus 5.5, medium | none |

The fallback runs only when T3 refuses the first choice. `design` and `ui` have no fallback. Designs come only from Claude Opus 5.5, and you are the design review.

`plan-review`, `grill`, `review`, and `oracle` are cross-family roles. The reviewer comes from the other model family than the worker. GPT-6-Astra reviews Claude work, and Claude Opus 5.5 reviews GPT work. The skills pass the worker to `omt brief --against`, and the CLI puts the rungs of the other family first. When the other family is not available, the same family reviews. A build oracle uses the family that did not do most of the implementation. A review oracle uses the family that did not do most of the reviews.

Claude models run on the `claudeAgent` driver, and GPT models run on the `codex` driver. Each default rung also names the T3 built-in provider instance of its driver. T3 checks a named instance again before it refuses it. A target with only a driver can fail because of an old provider snapshot.

The read-only roles are `explore`, `research`, `plan-review`, `grill`, `review`, `oracle`, and `guardrail`. They run in T3 plan mode. On Claude, Codex, Cursor, and OpenCode, plan mode stops the child from editing files. T3 has no plan mode for Pi, so only its brief stops a Pi child in a read-only role. No default role uses Pi.

Run `omt roles` to see how each role resolves with your config.

## Change a role

This example turns off cross-family review. After the change, `review` always starts on GPT-6-Astra and falls back to Claude Opus 5.5, also when GPT made the change.

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/gabimoncha/oh-my-t3code/main/schema/omt.schema.json",
  "version": 1,
  "roles": {
    "review": {
      "crossFamily": false
    }
  }
}
```

A `chain` replaces the old chain as a whole. The other fields of the role keep their values. To remove a role, set it to `null`.

A chain holds 1 to 10 rungs. A rung has these fields:

| Field | Value |
| --- | --- |
| `provider` | The id of one T3 provider instance, such as `codex`. |
| `driver` | The driver of the provider, such as `claudeAgent` or `codex`. A rung needs `provider`, `driver`, or both. |
| `model` | The model id. Required. |
| `effort` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. omt maps it to the effort option of the model. |
| `fast` | `true` or `false`. See [Set fast mode per role](#set-fast-mode-per-role). |
| `options` | Raw T3 model options, as an object of strings and booleans. |

`options` goes to T3 as it is, after omt applies the effort and fast mode, so a value in `options` wins over both. With `--capabilities`, omt checks each option id and value against the options that the model advertises. Without it, T3 checks them when the task starts. This rung asks Codex for the priority service tier:

```jsonc
{
  "roles": {
    "review": {
      "chain": [
        { "driver": "codex", "model": "gpt-6-astra", "effort": "high", "options": { "serviceTier": "priority" } },
        { "driver": "claudeAgent", "model": "claude-opus-5-5", "effort": "high" }
      ]
    }
  }
}
```

## Add a custom role

Add the role under `roles` in either config file. A new role needs `description`, `access`, and `chain`. The other fields are optional:

| Field | Values | Default for a new role |
| --- | --- | --- |
| `description` | Text of at most 300 characters. Agents read it in `omt roles` and in the skills. | Required. |
| `access` | `read-only` or `edit`. | Required. |
| `chain` | 1 to 10 rungs. | Required. |
| `result` | The result block that the child ends with: `work`, `review`, `test`, `research`, `plan`, `guardrail`, or `grill`. | `work` for `edit`, `research` for `read-only`. |
| `t3Role` | The `role` value that omt passes to the T3 `delegate_task` tool: `implementation`, `research`, `review`, `design`, `test`, or `general`. | `implementation` for `edit`, `research` for `read-only`. |
| `interactionMode` | The T3 interaction mode of the child: `inherit`, `default`, or `plan`. `plan` stops the child from editing files. | `default` for `edit`, `plan` for `read-only`. |
| `runtimeMode` | The T3 runtime mode of the child: `inherit`, `approval-required`, `auto-accept-edits`, `auto`, or `full-access`. A child cannot get a broader mode than its parent thread. | `inherit`. |
| `crossFamily` | `true` puts the rungs of the other family first when the skill names the worker. | `false`. |
| `fast` | `true` or `false`. | Not set. |

This role runs a security review on GPT-6-Astra in plan mode:

```jsonc
{
  "roles": {
    "security": {
      "description": "Review a diff for security problems and report findings by severity.",
      "access": "read-only",
      "result": "review",
      "t3Role": "review",
      "chain": [{ "driver": "codex", "model": "gpt-6-astra", "effort": "high" }]
    }
  }
}
```

To give a role its own persona, write `.omt/roles/<role>.md`. The file content is the persona and the rules for that role, and it replaces the bundled persona. omt looks in `.omt/roles/`, then in `~/.config/oh-my-t3code/roles/`, then in the bundled personas.

## Choose a profile

A profile is a named set of workflow switches, limits, and role overrides. omt has three presets:

- `normal` reviews every build round. It verifies each HEAVY unit and runs a final oracle. A LIGHT run uses the verify commands of the conductor.
- `prototype` reviews the first implementation round and verifies every unit. It skips the oracle and the failure proofs, allows 2 review rounds, and waits for you after each dependency layer.
- `pr-review` adds CI fixes, verification of changed flows, CRAP reports, test offers, and guardrail proposals to the normal review workflow.

Run `omt profile list` to see the presets and your custom profiles. Run `omt profile show prototype --json` to see the resolved workflow, limits, roles, and models of one profile.

To use the prototype profile for one build, type this in a T3 thread:

```text
ulw --profile prototype build a demo of the search screen
```

At a check-in, reply with "continue", with new directions, or with an instruction to stop check-ins for this run. "Continue" allows one more layer or unit.

To switch the profile of a running plan, run `omt plan profile <slug> normal`. `omt plan profile <slug> none` removes the plan override. The next wake reads the new profile.

omt selects the profile in this order: the `--profile` flag, the plan header, the project config, the user config, and then `normal`. omt merges the config files first. Then the selected profile applies the profiles that it extends.

## Write a custom profile

Add the profile under `profiles` in either config file. The starter configs hold a commented example, `fast-proto`. A profile has these fields:

| Field | Value |
| --- | --- |
| `description` | Text of at most 300 characters. Required for a new profile. Without it, omt drops the profile and `omt config validate` reports the error. |
| `extends` | The name of the parent profile. A profile without `extends` inherits `normal`. |
| `workflow` | Switches of the plan, design, build, and review steps, per group and key. The `git` group sets when the skills commit, push, open a PR, or merge without a question (`auto`) and when they ask first (`ask`). Its `owners` key lists the GitHub orgs whose repos count as your own; the default is none, so an org repo asks. The [spec](spec.md#67-profiles-and-workflow) lists every key and its values. |
| `limits` | Limits for runs with this profile. See [Set limits](#set-limits). |
| `roles` | Role overrides, with the fields of [Add a custom role](#add-a-custom-role). |
| `models` | Settings per model id. The only setting is `fast`. |

A profile cannot set `visuals`, `harnesses`, or `defaults`. These keys apply to the whole config file.

This profile builds like `prototype`, with no check-ins, fast `execute` and `ui` workers, a task limit of 12 instead of 24, and GPT-6.1-Sol without fast mode in the other roles:

```jsonc
{
  "profile": "hackathon",
  "profiles": {
    "hackathon": {
      "description": "Use the prototype workflow with fast workers and no check-ins.",
      "extends": "prototype",
      "workflow": { "build": { "checkpoint": "none" } },
      "limits": { "maxTasksPerRun": 12 },
      "roles": { "execute": { "fast": true }, "ui": { "fast": true } },
      "models": { "gpt-6.1-sol": { "fast": false } }
    }
  }
}
```

The role `fast` wins over the model `fast`. So in `execute`, the GPT-6.1-Sol fallback still gets `serviceTier: "priority"`. In `verify`, `qa`, and `research`, which do not set `fast`, GPT-6.1-Sol runs without fast mode. `omt route execute --profile hackathon` prints the targets.

A profile can turn steps on or off and change their settings. It cannot add a step or change the order of the steps. A profile applies after the root keys of the config files, so its `roles`, `limits`, and `models` win over the root values. `omt profile show <name> --json` prints the result.

## Set limits

Set limits at the root of a config file, or in a profile:

```jsonc
{
  "limits": { "maxParallel": 2, "maxReviewRounds": 3 }
}
```

| Limit | What it counts | Range | Default |
| --- | --- | --- | --- |
| `maxParallel` | Child tasks that run at the same time. | 1 to 32 | 6 |
| `maxTasksPerRun` | Child tasks in one run. A plan's own budget, set with `omt plan limit <slug> --tasks <n>`, replaces it. | 1 to 500 | 24 |
| `maxDepth` | Levels of child tasks below the conductor. At the maximum depth, a child does the work itself. | 0 to 3 | 1 |
| `maxReviewRounds` | Review rounds per unit, per plan review, and per design pass before the conductor stops and asks you. | 1 to 10 | 4 |

Each value must be an integer. `prototype` sets `maxReviewRounds` to 2.

## Set fast mode per role

```jsonc
{
  "roles": {
    "execute": { "fast": true },
    "verify": { "fast": false }
  }
}
```

The first value that is set wins: the rung `fast`, the role `fast`, the model `fast`, and then `false`. GPT-6.1-Sol has fast mode on by default. For a model that supports it, `true` becomes `serviceTier: "priority"` or `fastMode: true`. A model without fast mode keeps its target, and omt reports a note. A value in `rung.options` wins over this mapping. `false` adds no fast option.

## Pin the default set

Each omt release ships dated default sets. A set holds every built-in role, profile, limit, model setting, and visual setting. The sets today are `2026-10` and `2026-11`, which adds the `grill` role. A set does not change after its release. New defaults go into a new set with a later name.

The `"defaults"` key pins one set:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/gabimoncha/oh-my-t3code/main/schema/omt.schema.json",
  "version": 1,
  "defaults": "2026-11"
}
```

Each new starter config pins the latest set. Your overrides apply on top of the pinned set, and an omt update does not change them. The project config's pin wins over the user config's. A config without a pin follows the latest set, so its defaults can change when you update omt. For such a config, the `defaults` line of `omt doctor` says `2026-11 (latest, not pinned); run omt defaults use latest to pin`.

After an omt update, compare your set with the new one, then move the pin:

```sh
omt defaults list
omt defaults diff
omt defaults use latest --dry-run
omt defaults use latest
```

- `omt defaults list` prints each set. It marks the `latest` set and the `selected` set, with the file that selects it.
- `omt defaults diff` prints one line per value that changes from your set to the latest set: `<path>: <from> -> <to>`. A line that ends with `(overridden by <file>)` names a value that your config sets, so that change has no effect for you. With no change, it prints `no changes`. `omt defaults diff <from> <to>` compares two other sets.
- `omt defaults use latest` changes only the `defaults` key of one config file and keeps the rest of the file, comments included. It prints the change and asks first. `--dry-run` writes nothing, and `--yes` skips the question. `--project` or `--user` picks the file. Without a flag, it changes the project config when it exists, else the user config.

`omt config validate` reports an unknown set name, such as a set from a newer omt. `omt defaults use latest` repairs it.

## Match the harnesses on your machine

The default chains use two harnesses: Claude Code, on the `claudeAgent` driver, and Codex, on the `codex` driver. When your machine runs only one of them, the `"harnesses"` key tells omt to skip the rungs of the other:

```jsonc
{
  "harnesses": ["codex"]
}
```

With this value, `omt roles` marks each Claude rung as `harness claudeAgent is not enabled (harnesses: codex); run omt detect`, and the next rung runs. `design` and `ui` have only a Claude rung, so they become `unavailable`. The cross-family roles review with the same family. Without the key, omt uses every rung. The key holds 1 to 10 driver kinds, and a project value replaces the user value as a whole.

You do not have to write the key yourself. When `omt install` creates a config file, it detects the harnesses, shows the result in its plan, and writes the key only when a harness is missing. `omt detect` runs the same check at any time. `--project` or `--user` picks the config file to compare with or change. Without a flag, omt uses the project config when it exists, else the user config. `--write` changes only a file that exists, so run `omt init` or `omt config init` first. The sample uses the project config:

```sh
omt detect --project
omt detect --write --project --dry-run
omt detect --write --project
```

```text
claudeAgent  not detected  T3 disabled, claude not on PATH
codex        detected  T3 enabled, /usr/local/bin/codex
recommended: harnesses ["codex"]
design and ui: unavailable without claudeAgent
cross-family review: the same family reviews
<project>/.omt/config.jsonc: harnesses none -> ["codex"]
run omt detect --write to apply
```

A harness is detected when T3 does not disable it in `~/.t3/userdata/settings.json` (or `$T3CODE_HOME/userdata/settings.json`) and its executable, `claude` or `codex`, is on `PATH`. omt does not read T3's settings per project, so it can miss a harness that T3 turns on for one project only. An agent in a T3 thread saves the result of the T3 tool `orchestrator_capabilities` to a temp file and passes it with `--capabilities <file>`. Then a harness is detected when T3 has a provider of its driver that can run child tasks.

`--write` changes only the `harnesses` key of one file, with the same file rule, `--dry-run`, and `--yes` as `omt defaults use`. When every harness is detected, it removes the key. One case keeps the key: the file is the project config, and the user config sets a `harnesses` value that leaves out a detected harness. Then the project config gets the full list, so that it overrides the user value. `omt doctor` prints a `harnesses` line with the effective value.

## Move a `roles.test` override

The `test` role is now two roles. Move each `roles.test` override to `verify` for checks, or to `qa` for test writing. omt now reads the old key as a custom role and warns. A partial `roles.test` override fails validation, because it has no `description`, `access`, or `chain`.

## Turn off plan pages

By default, `omt-plan` shows a final plan as a page in the T3 thread. To get the plan summary as text in the reply instead, set:

```jsonc
{
  "visuals": { "plan": false }
}
```

## Inspect the config

- `omt config path` prints the paths of the user and project configs.
- `omt config show --defaults` prints the selected default set: the built-in profiles, roles, models, limits, and visuals.
- `omt config show` prints the merged config before omt applies the profile.
- `omt profile show <name> --json` prints the values after omt applies the profile.
- `omt config validate` reports problems in your files and in every profile.
- `omt defaults list` prints the default sets and the one that you use.
- `omt detect` prints the harnesses that omt finds and the `harnesses` value that fits them.
