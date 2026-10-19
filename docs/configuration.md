# Configure roles and profiles

omt reads two config files:

- The user config, `~/.config/oh-my-t3code/config.jsonc`, applies to all projects. `omt install` creates it.
- The project config, `.omt/config.jsonc`, overrides the user config for one project. `omt install --project` and `omt init` create it.

Run `omt config validate` after each change. The [spec](spec.md#67-profiles-and-workflow) has the full schema and the merge rules.

## Default roles

A role, such as `execute` or `review`, maps to an ordered chain of provider, model, and effort. The agent uses the first entry that T3 accepts. Each entry in the chain is a rung.

| Role | Use | First choice | Fallback |
| --- | --- | --- | --- |
| `explore` | Answer one narrow question about this repository | GPT-6-Luna, low | Claude Sonnet 5.5, low |
| `research` | Answer a question from docs, the web, and code | GPT-6.1-Sol, low | Claude Opus 5.5, low |
| `plan` | Turn a goal into a plan file | Claude Opus 5.5, xhigh | GPT-6-Astra, xhigh |
| `plan-review` | Check a plan for gaps | GPT-6-Astra, high | Claude Opus 5.5, high |
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

`plan-review`, `review`, and `oracle` are cross-family roles. The reviewer comes from the other model family than the worker. GPT-6-Astra reviews Claude work, and Claude Opus 5.5 reviews GPT work. The skills pass the worker to `omt brief --against`, and the CLI puts the rungs of the other family first. When the other family is not available, the same family reviews. A build oracle uses the family that did not do most of the implementation. A review oracle uses the family that did not do most of the reviews.

Claude models run on the `claudeAgent` driver, and GPT models run on the `codex` driver. Each default rung also names the T3 built-in provider instance of its driver. T3 checks a named instance again before it refuses it. A target with only a driver can fail because of an old provider snapshot.

The read-only roles are `explore`, `research`, `plan-review`, `review`, `oracle`, and `guardrail`. They run in T3 plan mode. On Claude, Codex, Cursor, and OpenCode, plan mode stops the child from editing files. T3 has no plan mode for Pi, so only its brief stops a Pi child in a read-only role. No default role uses Pi.

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

A `chain` replaces the old chain as a whole. The other fields of the role keep their values. In a rung, `provider` names one T3 provider instance and `driver` names its driver. To remove a role, set it to `null`.

## Add a custom role

Add the role under `roles` in either config file. A new role needs `description`, `access`, and `chain`. Its `result` field selects the result block: `work`, `review`, `test`, `research`, `plan`, or `guardrail`.

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

Add the profile to either config file:

```jsonc
{
  "profile": "hackathon",
  "profiles": {
    "hackathon": {
      "description": "Use the prototype workflow with fast workers and no check-ins.",
      "extends": "prototype",
      "workflow": { "build": { "checkpoint": "none" } },
      "roles": { "execute": { "fast": true }, "ui": { "fast": true } }
    }
  }
}
```

A custom profile without `extends` inherits `normal`. A profile can turn steps on or off and change their settings. It cannot add a step or change the order of the steps.

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

- `omt config show --defaults` prints the built-in profiles, roles, models, limits, and visuals.
- `omt config show` prints the merged config before omt applies the profile.
- `omt profile show <name> --json` prints the values after omt applies the profile.
- `omt config validate` reports problems in your files.
