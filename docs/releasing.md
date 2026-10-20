# Release oh-my-t3code

This page is for the owner. You publish each release by hand: two npm packages and one GitHub release. No CI job publishes. [Spec section 17](spec.md#17-packaging-and-release) describes what the release script writes.

## Set up once

1. Install the repository tools as a contributor does: run `mise install` and `bun install` in the clone.
2. Log in to npm with `npm login`. `bun publish` uses the token that npm saves in `~/.npmrc`. On a machine without npm, put an npm access token in `~/.npmrc` or in `bunfig.toml`.
3. Log in to GitHub with `gh auth login`, with write access to `gabimoncha/oh-my-t3code`.

## Publish a release

Do these steps in order, in the repository root. Start on `main` with a clean working tree: `git status --short` prints nothing. Each step must pass before you start the next step. Replace `<version>` with the new version, such as `0.2.0`.

1. Set the new version in the `version` field of `package.json`.
2. Run the type check and all tests:

   ```sh
   mise exec -- bun run verify
   ```

3. Commit the version change and push it:

   ```sh
   git commit -m "release v<version>" package.json
   git push origin main
   ```

4. Tag that commit and push the tag. The release must come from the commit that you tested:

   ```sh
   git tag v<version>
   git push origin v<version>
   ```

5. Write the release files from that commit:

   ```sh
   mise exec -- bun scripts/release.ts
   ```

   The script writes `dist/release/`: the npm packages in `npm/oh-my-t3code/` and `npm/omt3/`, and one archive per platform with `SHA256SUMS` in `github/`. It publishes nothing. At the end, it prints the publish commands. It refuses an unsafe output directory, and it refuses a `skills/` directory that holds untracked or ignored files, such as `.DS_Store`. Remove those files and run the script again.

6. Publish the main package:

   ```sh
   (cd dist/release/npm/oh-my-t3code && bun publish --access public)
   ```

7. Publish the one-shot package. It is the same build under the name `omt3`:

   ```sh
   (cd dist/release/npm/omt3 && bun publish --access public)
   ```

8. Create the GitHub release from the tag of step 4, with the archives and `SHA256SUMS`:

   ```sh
   gh release create v<version> --verify-tag dist/release/github/*
   ```

   `--verify-tag` stops the command when the tag is not on GitHub. Without it, `gh` creates the tag from the last commit of the default branch, which can differ from the commit that you released. The release script prints this command without `--verify-tag`. Use the command of this step.

9. Check each channel on a clean machine, or in a fresh user account. Each command must print the new version:

   ```sh
   mise use -g github:gabimoncha/oh-my-t3code@<version>
   omt --version
   npx omt3 --version
   bunx omt3 --version
   ```

   Check the one-shot package as `npx omt3`, not `npx omt`. `npx omt` downloads a different npm package named `omt`. `npx omt3` needs Node. `bunx omt3` also works with only Bun.

## If mise installs the binary under another name

The archive holds one file, `omt`, and mise keeps the name of the file in the archive. If `mise use github:gabimoncha/oh-my-t3code` installs the binary under another name than `omt`, use the `rename_exe` option of the mise [GitHub backend](https://mise.jdx.dev/dev-tools/backends/github.html) to name it `omt`. Then record the fix in the release binary section of [the install guide](install.md#release-binary), so that users run the same command.
