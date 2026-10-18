# oh-my-t3code contributor guide

If your user asks you to evaluate, install, or use omt, follow [docs/agents/quickstart.md](docs/agents/quickstart.md) and stop reading here. The rest of this file is for agents that change omt.

`omt` is a TypeScript CLI plus a set of skills for T3 Code. Node runs the TypeScript sources directly.

## Contract

`docs/spec.md` is the contract for the code, the skills, and the tests. Read the section for your module before you change it. When the code and the spec disagree, fix one of them in the same change. `docs/design.md` explains why each part exists.

## Commands

| Command | Use |
| --- | --- |
| `pnpm install` | Install the dev dependencies. |
| `pnpm check` | Typecheck and run all tests. Run it before you report done. |
| `pnpm test` | Run the tests (`node:test`, files `test/**/*.test.ts`). |
| `pnpm typecheck` | Run `tsc --noEmit`. |
| `node src/cli.ts <command>` | Run the CLI from source. |

## TypeScript rules

- Use ESM and erasable syntax only: no `enum`, no `namespace`, no parameter properties, no decorators.
- Use `import type` for type-only imports. End relative imports with `.ts`.
- The compiler runs with `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, and `erasableSyntaxOnly`.
- Format with 2-space indentation, double quotes, semicolons, and trailing commas in multi-line literals.
- Write a comment only for a reason that the code cannot show.
- Import shared types from `src/types.ts`. Throw `OmtError` from `src/util/errors.ts` for expected failures; use exit code 2 for usage errors.
- Write files atomically with the helpers in `src/util/fs.ts`.

## Dependencies

The package has zero runtime dependencies. Use only `node:` built-in modules. The only dev dependencies are `typescript` and `@types/node`. The CLI makes no network calls and sends no telemetry.

## Tests

- Put tests in `test/<module>.test.ts`. Use `node:test` and `node:assert/strict`.
- Tests never read or write the real home directory. Use the temp-directory helper and `fakeContext()` from `test/helpers.ts`, and pass `env` and `homedir` explicitly.
- A test that runs the CLI as a child process sets `HOME` and the `OMT_*`, `XDG_*`, `CLAUDE_*`, and `T3CODE_*` variables to temp paths.
