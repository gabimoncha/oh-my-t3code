# CodeRabbit scan assessment

The report `gabimoncha-oh-my-t3code-agent-findings.json` contains 14 findings against commit `5136861223a3e8d0943642436d96c17c2e88e496`. CodeRabbit generated it on 2026-10-26. The affected code is present at that commit. All 14 findings apply to operations on repository files or to the local config editor.

The changes address each finding as follows. Row numbers refer to the report.

| Row | Finding | Change | Regression coverage |
| --- | --- | --- | --- |
| 1 | Ledger and plan writes follow external symlinks. | Ledger appends reject symlinked state directories, symlinked leaves, and hard links. Plan writes check the resolved destination against the project root. | `test/ledger/ledger.test.ts`, `test/plan/plan.test.ts` |
| 2 | Inline link matching repeats searches over the same text. | The renderer caches delimiter positions and limits nested markup to 16 levels. Plan summaries have an 8,000-character limit. | `test/visual/inline.test.ts`, `test/visual/plan.test.ts` |
| 3 | Windows manager lookup falls back to a bare executable name. | An unresolved lookup fails before launch. Only absolute PATH entries take part. A command shim also requires an absolute ComSpec. | `test/commands/worktree-setup.test.ts` |
| 4 | A project manifest can authorize an external gitignore restore. | Planning and apply check the resolved destination. A manifest hash cannot authorize a write outside the project. | `test/install/project.test.ts` |
| 5 | A dangling project hook link can select absent user settings. | Scope checks resolve dangling links and ancestors. Project hook writes must resolve inside the project, including at apply time. | `test/install/project.test.ts` |
| 6 | Profile validation traverses complete unsupported inheritance chains. | Validation stops when it reaches the ninth profile. Diagnostics contain at most nine profile names. | `test/config/profiles.test.ts` |
| 7 | npmrc and TOML assignment expressions can backtrack quadratically. | The parsers locate the equals sign first and inspect the key and value separately. Lines over 16,384 characters fail inspection. | `test/commands/worktree-setup.test.ts` |
| 8 | Browser launcher arguments expose the editor token. | The launcher opens a public login page without the token. The user pastes the terminal's editor URL into that page. | `test/config/editor-server.test.ts` |
| 9 | Table padding multiplies oversized ledger fields across rows. | Displayed cells stop at 120 characters. Tables stop at 1,000,000 characters plus a truncation notice. JSON output keeps full values. | `test/util.test.ts` |
| 10 | JSONC edits repeatedly rescan arbitrarily many duplicate keys. | An initial scan rejects more than 16 excess duplicates along the edited path. Paths have at most 32 segments. | `test/config/jsonc-edit.test.ts` |
| 11 | Lock files and directories can redirect metadata writes. | Lock storage uses the same verified state-file open as the ledger, with no-follow leaf opens and descriptor checks. | `test/lock/lock.test.ts` |
| 12 | Ledger statistics compare each dispatch with every terminal record. | Statistics build task-ID and fallback-identity indexes once. Optional ledger fields are validated before indexing. | `test/ledger/ledger.test.ts` |
| 13 | Global channel matching can rescan repeated links segments. | Channel detection uses path segments. CLI paths stop at 32,768 characters, and shim inspection stops at 65,536 characters. | `test/update/channel.test.ts` |
| 14 | Plan graphs reach dependency reduction and layout without limits. | Plans allow at most 60 units and 120 direct dependencies before graph work starts. Lane ordering indexes its dependencies. | `test/visual/plan.test.ts`, `test/visual/flow.test.ts` |

Project hooks and `.omt/.gitignore` links to external dotfiles now fail when an operation would write their targets. Links inside the project remain supported. Git exclude files retain their separate Git storage rules. User-scope settings retain their existing symlink behavior.

The state-file checks address planted links and verify the opened inode before content changes. Portable Node filesystem APIs do not provide directory-relative `openat` operations. These checks do not claim protection against every concurrent directory rename by another process with write access to the checkout.

Windows launch selection is tested with an injected Windows platform and file lookup. The local test run uses macOS and does not execute Windows binaries.

`mise exec -- bun run verify` passes the type check and all 809 tests. The four tests selected by the following command fail against the original commit and pass with these changes:

```sh
mise exec -- bun test test/install/security.test.ts test/install/project.test.ts \
  -t 'apply refuses|forged gitignore restore|project hooks refuse'
```

The comparison uses an extracted copy of the original sources. Its test context records the same installed CLI path as the current tests, so the temporary copy does not trigger the separate installer protection against temporary CLI paths.
