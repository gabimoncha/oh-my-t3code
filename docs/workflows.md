# How the omt workflows run

This page tells you what omt does in a pull request review, when it commits and opens a PR, how it adds tests, how parallel workers share builds, and what a plan page shows. To change these steps, see [Configure roles and profiles](configuration.md).

## Review a pull request

In a T3 thread, run the skill:

```text
omt-review --profile pr-review <number>
```

The skill does these steps in order:

1. It reads and links the PR. When a step needs the PR checkout, it saves your branch and checks out the PR. A checkout needs a clean working tree.
2. It reads the project rules. A finding that breaks a written rule cites the file and line of the rule.
3. It reads the CI checks and saves the failure logs. For pending checks, it uses the T3 PR watch. If the PR has no CI checks, it runs the check command of the project.
4. If the project has a coverage command, it runs it once and saves the lcov file for the reviewers.
5. Reviewers read groups of files on the PR head. A verify task runs the changed screens, CLI commands, and API routes, and lists the tests that cover them.
6. It merges the findings. An oracle from the other model family checks them. A verified flow that fails becomes a P1 finding.
7. It sends each failing CI check to an execute task and reviews the fix. The fixes stay uncommitted.
8. It proposes deterministic checks, rule corrections, or new rules. It saves new proposals in `.omt/guardrails.md`, which git ignores, for separate work.
9. It reports CRAP for the changed functions. CRAP combines complexity and test coverage. A value above 30 becomes a P2 finding. Without coverage data, the calculation uses zero coverage.
10. It reports the findings, the CI fixes, the screenshots, the flows without tests, the proposals, and the command that returns you to your branch.
11. It offers a fix loop and the exact e2e test lines for verified flows without tests. Each offer needs your approval. If the project has no e2e framework, qa reports `INCONCLUSIVE`. Then it commits the approved changes and pushes them by the [git policy](#commit-push-and-open-a-pr).

The first-round reviewers and the oracle read the saved PR commits. Reviews after a fix read the working tree. The skill posts no GitHub comment and no GitHub review. Other profiles can skip steps with `workflow.review`. The [spec](spec.md#154-pull-request-review) lists the switches and the rules.

## Commit, push, and open a PR

The git policy in your config decides each commit, push, PR, and merge. Before each one, the skill runs `omt git check <commit|push|pr|merge>` and acts on its answer: on `auto` it acts, on `ask` it asks you first, and on `off` it skips the action and says so.

With the default policy, on a branch that is not the default branch:

- `omt-ulw` makes one commit for the run after the final checks pass. Then it pushes the branch and opens a ready PR, or the push updates the branch's open PR.
- `omt-review` commits the approved fixes and qa tests and pushes them to the PR branch with no further question. For a PR by another author, it asks you first.

A commit or push on the default branch asks you first. Each merge and each force push also asks you first. A config pinned to the default set `2026-10` has no `git` group, so each action that the config does not set asks. To change the policy, set `workflow.git` in a profile ([Write a custom profile](configuration.md#write-a-custom-profile)). The [spec](spec.md#515-omt-git) lists the rules.

## Grill a goal before you plan

Use the `omt-grill` skill when your goal is vague or you do not know its edge cases yet. In each round, one Claude task and one Codex task read the goal and the code, and they do not see each other. The models decide the areas that you do not know and give a reason for each decision. You answer the questions in the areas that you know, and you accept or change each edge case, in one reply per round. The skill writes the result to a grill file, and `omt-plan` reads it, asks no settled question again, and turns the accepted and changed edge cases into integration or unit tests.

## Add tests only from the plan

Workers add no tests on their own. The plan lists each proposed test under `## Tests`, with its flow, its file, and the reason for it. You approve these lines when you approve the plan. An empty list means no new tests.

First, verify runs the artifact and the existing checks. Then qa writes only the approved tests. In the `normal` profile, qa also proves that each new test can fail, in a private copy of the working tree.

## Share builds between parallel workers

Parallel workers share one checkout and edit different files. Commands that share build state take a lock, one lock name for each resource:

```sh
omt lock run build -- npm run build
omt lock list
```

A command waits up to 900 seconds for a busy lock. `--wait <seconds>` changes the wait. After a timeout, the command exits with code 75. The lock uses `flock` or `lockf`, and omt never takes a lock from its holder. If neither tool is installed, the command runs with a warning, and the planner runs shared builds one at a time.

A command that leaves a server or a watcher running cannot use the lock. The planner runs such commands one at a time, outside the lock.

## Read a plan page

When a plan is final, `omt-plan` shows it as a page in the T3 thread. The page has the plan summary, status cards, a flowchart of the units by dependency layer, a unit table, the checks, and diagrams that explain the design.

T3 does not draw flowcharts in chat. So `omt visual` builds the page, and the T3 `html_render` tool shows it. omt also saves a copy as `visuals/<slug>.html` in the evidence directory, which `omt paths --evidence` prints. You can open the copy in a browser.

To see a page at any time, ask for it, for example "show me the plan as a flowchart". The `omt-show` skill builds it. To turn off the plan page, see [Turn off plan pages](configuration.md#turn-off-plan-pages).
