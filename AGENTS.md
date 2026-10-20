# oh-my-t3code contributor guide

If your user asks you to evaluate, install, or use omt, follow [docs/agents/quickstart.md](docs/agents/quickstart.md) and stop reading here. The rest of this file is for agents that change omt.

`omt` is a TypeScript CLI plus a set of skills for T3 Code. In a clone, Bun runs the TypeScript sources directly. Users install the npm bundle or the release binary, never a clone.

## Setup

Clone the repository, then run `mise install` (it installs the Bun version that `mise.toml` pins) and `bun install`. Then run `bun run verify` to check the setup.

## Contract

`docs/spec.md` is the contract for the code, the skills, and the tests. Read the section for your module before you change it. When the code and the spec disagree, fix one of them in the same change. `docs/design.md` explains why each part exists.

## Commands

Run each command through `mise exec --` (or in a shell where mise is active), so that the Bun version that `mise.toml` pins runs.

| Command | Use |
| --- | --- |
| `bun install` | Install the dev dependencies. |
| `bun run verify` | Type-check and run all tests. Run it before you report done. |
| `bun test` | Run the tests (files `test/**/*.test.ts`). |
| `bun run typecheck` | Run `bun check`, the Bun type checker. |
| `bun run schema` | Write `schema/omt.schema.json` from `src/config/schema.ts`. |
| `bun src/cli.ts <command>` | Run the CLI from source. |

Do not add a package script named `check`. `bun check` runs a package script with that name instead of the type checker.

## TypeScript rules

- Use ESM and erasable syntax only: no `enum`, no `namespace`, no parameter properties, no decorators.
- Use `import type` for type-only imports. End relative imports with `.ts`.
- `tsconfig.json` sets `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, and `erasableSyntaxOnly`, and `bun check` enforces them.
- Format with 2-space indentation, double quotes, semicolons, and trailing commas in multi-line literals.
- Write a comment only for a reason that the code cannot show.
- Import shared types from `src/types.ts`. Throw `OmtError` from `src/util/errors.ts` for expected failures; use exit code 2 for usage errors.
- Write files atomically with the helpers in `src/util/fs.ts`.

## Dependencies

- Runtime dependencies: none.
- `src/` uses only `node:` built-in modules, because the npm bundle runs on Node. Scripts in `scripts/` and tests may use Bun APIs.
- The only dev dependency is `@types/bun`.
- Build scripts may download Bun cross-compile runtimes. The omt CLI makes no network calls and sends no telemetry.

## Tests

- Put tests in `test/<module>.test.ts`. `bun test` runs them. Use `bun:test` and `node:assert/strict`.
- Tests never read or write the real home directory. Use the temp-directory helper and `fakeContext()` from `test/helpers.ts`, and pass `env` and `homedir` explicitly.
- A test that runs the CLI as a child process sets `HOME` and the `OMT_*`, `XDG_*`, `CLAUDE_*`, and `T3CODE_*` variables to temp paths.
