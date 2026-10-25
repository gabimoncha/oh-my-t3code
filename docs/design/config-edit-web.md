# Design spec: the config editor page (`omt config edit --web`)

Status: approved

This spec is the contract for unit U6 of the plan `config-edit-web`. U6 builds the page in `templates/config-editor/index.html`, `app.css`, and `app.js` against the server API of U5 (`src/config/editor/api.ts`). The design is variant C, "Inspector", for every screen.

The owner approved these choices after round 1:

- Variant C for screens s1 to s7.
- The brand palette only. The winning layer is purple. An overridden layer is gray. No blue or pink.
- Edits go to the file that the global **Edit in** control selects (`user` or `project`). Inside that file, the edit panel offers a path choice: the selected profile's path or the root path. A warning shows when a higher layer overrides the edited path, for example "▲ project overrides this value".

## Implementation rules

- Plain HTML, CSS, and JS. No framework, no build step, no web fonts.
- No inline `style` attributes and no inline scripts. The CSP of U5 is `default-src 'none'; script-src 'self'; style-src 'self'`. Put every rule in `app.css` and every handler in `app.js`. To show or hide an element, toggle the `hidden` attribute or a class.
- Font stacks:
  - `--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;` for keys, values, paths, labels, buttons, and the diff.
  - `--font-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;` for sentences of prose: help text, explanations, error text, and free-text inputs such as descriptions.
- Theme: follow `prefers-color-scheme`. Dark is the default in `:root`. Light applies under `@media (prefers-color-scheme: light)`. The page has no theme toggle.
- Sizes in this spec are CSS pixels at 100% zoom. Write font sizes in `rem` (1rem = 16px) so that the browser text size setting scales the text. Layout widths stay in `px` and the main columns shrink as this spec says.
- Insert untrusted text (paths, descriptions, model ids, issue messages, values) with `textContent`.

## Tokens

### Color

Put these custom properties in `app.css`. The left value is dark, the right value is light.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` | `#0A0A0A` | `#FFFFFF` | Page background, the tree column. |
| `--bg-panel` | `#0D0D0D` | `#F7F7F7` | Command bar, inspector, editor panes, review panel, new-item forms. |
| `--bg-bar` | `#121212` | `#F2F2F2` | Status bar, the inline status line in a state card, the stack row of an unset layer. |
| `--bg-row-alt` | `#0F0F0F` | `#FAFAFA` | Group rows of the profile matrix. |
| `--line` | `#2A2A2A` | `#E0E0E0` | Section borders, card borders, table borders. |
| `--line-soft` | `#1D1D1D` | `#EDEDED` | Row dividers inside tables. |
| `--control` | `#3A3A3A` | `#CFCFCF` | Borders of inputs, selects, and segmented controls. Outline of an empty strip cell. The stack connector line. |
| `--text` | `#FFFFFF` | `#0A0A0A` | Primary text and values. |
| `--text-2` | `#C8C8C8` | `#3D3D3D` | Secondary text: keys of unselected rows, source labels. |
| `--text-muted` | `#9A9A9A` | `#5C5C5C` | Labels, section titles, hints, carets. |
| `--text-faint` | `#858585` | `#6E6E6E` | Placeholders, JSON punctuation in s5, diff line numbers, the "·" for "not set", radio outlines. |
| `--strip-over` | `#6B6B6B` | `#8C8C8C` | Strip cell of an overridden layer, stack dot of an overridden layer. |
| `--layer-self` | `#C8C8C8` | `#3D3D3D` | The own-layer cell in a pipeline card strip. |
| `--accent` | `#AB7DF8` | `#6E3FD0` | Winning layer, selection, links, primary action fill. |
| `--on-accent` | `#0A0A0A` | `#FFFFFF` | Text on `--accent`. |
| `--accent-tint` | `#17131F` | `#F3EDFF` | Selected row, winning stack card, edited matrix cell. |
| `--accent-tint-2` | `#121016` | `#F6F0FF` | Selected path option. |
| `--accent-line` | `#5B4A80` | `#C9B3F5` | Border of the winning stack card. |
| `--primary` | `#FFFFFF` | `#0A0A0A` | Fill of a primary button (Queue, Queue edit, Reload…). |
| `--on-primary` | `#0A0A0A` | `#FFFFFF` | Text on `--primary`. |
| `--ok` | `#3FB950` | `#1A7F37` | "present", the connected dot, "✓ no new errors", added diff marks. |
| `--ok-tint` | `#0F2A17` | `#E6FFEC` | Added diff line. |
| `--warn` | `#D29922` | `#8F5F00` | "▲ N warnings", "absent", the dashed border of a queued stack card and of an absent file card. |
| `--warn-text` | `#E3C27A` | `#7D5400` | Override warnings and other inline warning sentences. |
| `--warn-tint` | `#1A1608` | `#FFF8E1` | A role editor row whose queued value a higher layer overrides. |
| `--err` | `#F85149` | `#CF222E` | Error text, error borders, the stopped dot, destructive button text. |
| `--on-err` | `#0A0A0A` | `#FFFFFF` | Text on an `--err` fill. |
| `--err-tint` | `#1A0F0F` | `#FFF1F0` | Row with a validation error. |
| `--err-tint-2` | `#2D1214` | `#FFEBE9` | Conflict banner, removed diff line. |
| `--err-line` | `#6E2A27` | `#F3B5B0` | Border of "Remove role" and "Remove profile". |

Contrast was measured with the WCAG 2 formula. Text needs 4.5:1. Strip cells, dots, and focus rings need 3:1.

| Pair | Dark | Light |
| --- | --- | --- |
| `--text` on `--bg` | 19.8 | 19.8 |
| `--text-2` on `--bg` | 11.8 | 10.9 |
| `--text-muted` on `--bg-panel` | 6.9 | 6.2 |
| `--text-muted` on `--bg-bar` | 6.7 | 6.0 |
| `--text-faint` on `--bg-panel` | 5.3 | 4.8 |
| `--accent` on `--bg` | 6.6 | 6.4 |
| `--accent` on `--accent-tint` | 6.1 | 5.6 |
| `--on-accent` on `--accent` | 6.6 | 6.4 |
| `--warn` on `--bg-bar` | 7.4 | 4.9 |
| `--warn-text` on `--warn-tint` | 10.6 | 6.3 |
| `--ok` on `--ok-tint` | 6.1 | 4.8 |
| `--err` on `--err-tint-2` | 5.2 | 4.7 |
| `--on-err` on `--err` | 5.9 | 5.4 |
| `--strip-over` on `--bg` | 3.7 | 3.4 |

The control borders (`--control`) are below 3:1. Each control also has a visible label or a value inside it, so the border is not the only way to find the control.

### Type

| Token | Size / line height | Weight | Font | Use |
| --- | --- | --- | --- | --- |
| `--t-value` | 34 / 42, letter-spacing -0.02em | 800 | mono | The effective value in the inspector. |
| `--t-h1` | 20 / 24 | 700 | mono | Title of the states board only. |
| `--t-h2` | 18 / 22 | 700 | mono | Editor titles: `roles.execute`, `profiles.hackathon`. |
| `--t-h3` | 16 / 20 | 700 | mono | Inspector path, "root settings". |
| `--t-stack` | 15 / 18 | 700 | mono | Value at the right of a stack card. |
| `--t-input` | 13 / 16 | 400 | mono | Values in inputs, the wordmark, JSON keys in s5, pipeline card values. |
| `--t-body` | 12 / 16 | 400 or 700 | mono | Default text: tree rows, buttons, menus, diff lines (line height 20). |
| `--t-meta` | 11 / 14 | 400 | mono | Section labels in caps, source labels, hints, status bar. |
| `--t-micro` | 10 / 12 | 400 | mono | "present" and "absent" badges, field labels in new-item forms, select carets. |
| `--t-prose` | 12 / 18, or 13 / 19 in state cards | 400 | sans | Explanations and help sentences. |

Section labels ("INSPECTOR", "SOURCE STACK · TOP TO BOTTOM", "EDIT IN user · PATH IN THIS FILE") use `--t-meta` in `--text-muted`, upper case, with the variable part in lower case.

### Spacing, borders, and radius

- Spacing scale: 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28 px. Use `--s-2` … `--s-28` with the number in the name.
- Page gutters: 24px left and right in the command bar, pipeline, tree, and status bar. 28px in the editor panes of s3, s4, and s5.
- Control padding: inputs and selects 5px × 10px (6px × 10px for full-width text inputs). Buttons 6px × 12px. Segmented items 5px × 10px. Strip and dot sizes are below in the components.
- Borders: 1px solid. Section and card borders use `--line`. Controls use `--control`. "Not set here" controls in s4 and s5 use a 1px **dashed** `--control` border.
- Selected row: background `--accent-tint` and a 3px left border in `--accent`. Reduce the left padding by 3px so that the text stays in its lane.
- Edited cell or JSON row (s4, s5): background `--accent-tint` and `box-shadow: inset 2px 0 0 var(--accent)`.
- Radius: 4px for cards, panels, the command bar controls, and path options. 3px for inputs, buttons, and chips. 0 for strip cells. 5px (round) for 10px stack dots. 6px for the 12px radio dot.

## Layout grid

The design width is 1280px. The page works from 1024px wide. Below 1024px the page scrolls horizontally. It does not reflow to one column.

Every screen stacks three bands from top to bottom:

1. **Command bar**, full width, height about 41px. Padding 12px × 24px, gap 18px, background `--bg-panel`, bottom border `--line`. Content from left: `omt` (accent, bold), `config`, the version, a flexible spacer, "profile" and the profile picker, "edit in" and the **Edit in** segmented control.
2. **Content**, which fills the height between the bars. Each column scrolls on its own.
3. **Status bar**, full width, padding 8px × 24px, gap 20px, background `--bg-bar`, top border `--line`. It stays at the bottom of the viewport (`position: sticky; bottom: 0`).

Content per screen:

| Screen | Columns |
| --- | --- |
| s1, s2 | The layer pipeline across the full width (padding 14px × 24px, bottom border). Below it: the key tree (`flex: 1; min-width: 0`) and the inspector (460px, left border `--line`, background `--bg-panel`). |
| s3, s4 | A list sidebar (260px, right border) and the editor pane (`flex: 1`, background `--bg-panel`). |
| s5 | The JSON-shaped form (`flex: 1`, padding 20px × 28px) and the preview panel (420px, left border, background `--bg-panel`, padding 20px × 24px). |
| s6 | The current screen stays behind the review panel at 35% opacity and is inert. The review panel is fixed to the bottom of the viewport above the status bar, full width, with a 2px top border in `--accent`. Its height is the viewport minus 190px. Inside it: tabs, the edits column (400px, right border), and the diff (`flex: 1`). |

### Navigation

The page uses the URL hash for screens, so that the browser Back button works and a reload stays on the screen.

| Hash | Screen |
| --- | --- |
| `#/` or empty | s1 tree and inspector. `#/?key=limits.maxParallel` selects a key (s2 is s1 with a key selected). |
| `#/role/<name>` | s3 role editor. |
| `#/profile/<name>` | s4 profile editor. |
| `#/root` | s5 root settings. |

The review panel (s6) is an overlay on the current hash, not a route. To go back to s1 from s3, s4, or s5, the user clicks the `config` text in the command bar (a link to `#/`), presses Esc when no field has focus, or uses the browser Back button.

## Screens

Each screen lists what it reads from the API. All field names are from `src/config/editor/api.ts` and `src/config/explain.ts`.

### s1 · Effective view

What runs for the selected profile, with the layer that set each value.

- **Layer pipeline**: four cards and the effective card, joined by "→" in `--text-muted`, with "=" in `--accent` before the effective card.
  1. `1 · DEFAULTS`: `state.defaults.selected` in `--t-input`. Below it: "pinned in user", "pinned in project", or "latest", from `state.defaults.source` (a path: compare it with `state.files[k].path`. The string `latest`: "latest").
  2. `2 · USER` and 3. `3 · PROJECT`: `state.files[k].path`, and "present" (`--ok`) or "absent" (`--warn`) from `files[k].present`. The third line is "N keys", where N counts the `explain.root` entries with `source.kind === k`.
  4. `4 · PROFILE`: `explain.profile.name`. The second line is "from user" or "from project" (from the `declaredIn` of the profile's entries, or "preset" for the preset profiles) and "extends X" from the `explain.root` entry with path `["profiles", name, "extends"]` when it exists.
  - Effective card: "EFFECTIVE" in `--accent`, "what runs" in `--text`, background `--accent-tint`, border `--accent`.
  - Card widths: flex 1, 1.3, 1.3, 1.1, and 120px fixed for the effective card. Padding 8px × 12px. The first card has a 4px left radius and the last file card a 4px right radius.
- **Filter row**: an input with the "/" prefix and the placeholder "filter keys, e.g. roles.review", then the strip legend: "strip = D U P F", a sample strip, and "purple wins · gray overridden".
- **Key tree**: groups in this order: `roles`, `profiles`, `limits`, `harnesses · visuals · models · defaults`. Each group header shows the name in bold, the count, and an action link at the right ("+ role", "+ profile"). Paths that start with `roles`, `limits`, `models`, or `workflow` come from `explain.effective`. All other paths come from `explain.root`. Collapse a role to one row (`▸ review.crossFamily`) when only one field differs from the defaults. Collapse roles that only the default set defines into one row: "▸ N roles · defaults 2026-10 only".
  - A value that differs from the root value shows "(root X)" after it in `--text-muted`. X is the value of the `explain.root` entry with the same path.
  - Entries in `explain.removed` show as rows with the struck-through key and the label "removed by <source>".
- **Inspector** (s2 describes it in full) shows the selected key. With no key selected, it shows "Select a key to see where its value comes from." in `--t-prose` `--text-muted`.

API: `GET api/state` (`version`, `defaults`, `files`, `profiles`, `selectedProfile`, `issues`, `explain`, `vocab`). When the user picks another profile, `GET api/explain?profile=<name>` replaces `explain`.

### s2 · Source stack and edit

The inspector for one key. The final frame shows `limits.maxParallel` with **Edit in: user**: the user file sets 4, the project file sets 2 and wins, and a queued user edit sets 3.

1. **Header**: "INSPECTOR", the dotted path in `--t-h3`, the effective value in `--t-value`, and the source label in `--t-body` (`--accent` when the source is a profile).
2. **Source stack · top to bottom**: one row per layer in the order defaults, user, project, profile. Each row has a 20px rail column (a 10px dot and a 1px connector line) and a body.
   - The winning layer: a filled `--accent` dot, an `--accent` connector, and a card with `--accent-tint` fill, a `--accent-line` border, the bold title "N <layer> · wins", the file path or "declared in <path>" below, and the value at the right in `--t-stack`.
   - An overridden layer: a filled `--strip-over` dot, the title, "overridden by <layers>" below, and the value at the right, struck through in `--text-muted`.
   - A layer that does not set the path: an outlined `--strip-over` dot, the title in `--text-2`, "not set · X passes through" or "does not set <key>" below, and "·" at the right in `--text-faint`.
   - A layer with a queued edit for this key (only the layer of the **Edit in** file): a dashed `--warn` dot and a card with a dashed 1px `--warn` border, the title "N <layer> · file has X · your edit Y" (or "your edit Y" when the file does not set it), and a status line in `--warn-text`: "queued · this layer would now win", or "queued · ▲ project overrides this value".
   - The last line is "= effective X" with "=" in `--accent`.
   - Data: the entry's `source` and `overridden` (highest first). Map each `ExplainSource` to its layer: `defaults` to 1, `user` to 2, `project` to 3, `profile` to 4. For a profile source, the title is "4 profile <profile>" and the second line is "declared in <declaredIn path>".
3. **Edit panel** (see the components): "EDIT IN user · PATH IN THIS FILE", the path choice, the value control, the explanation sentence, Queued and Undo buttons, and Reset to inherited.

API: the same `explain` entry as s1, and `vocab` for the value control (`limitRanges`, `effort`, `access`, and others).

### s3 · Role editor

Opens from a role row in the tree, from a role in the sidebar list, or with "+ role".

- **Sidebar**: "ROLES", one row per role with its layer letters at the right (for example "D F": defaults and the profile set fields of this role). The selected role uses the selected-row style. "… N more" expands the list. Below the list, the **new role form** (see the components).
- **Editor header**: the dotted path in `--t-h2`, the role strip, and the sources ("defaults 2026-10 + profile hackathon (user)"). The second line: "edit in user · path in this file" and the path choice as a segmented control: `roles.execute` | `profiles.hackathon.roles.execute`. The selected segment has `--accent-tint` fill and an inset 1px `--accent` ring.
- **Field rows**: label column 150px in `--text-muted`, the control (flex 1), and the source at the right: the strip letter and the label ("D  defaults 2026-10"). Fields: `description` (text input, sans), `access` (segmented: `edit` | `read-only`), `result` and `t3Role` (two selects), `interactionMode` (segmented), `runtimeMode` (select), `crossFamily` (checkbox), `fast` (checkbox). The values come from `vocab.access`, `vocab.result`, `vocab.t3Role`, `vocab.interactionMode`, and `vocab.runtimeMode`.
- A field with a queued edit that a higher layer overrides gets the `--warn-tint` row and the sentence "queued for <path> · ▲ <layer> overrides this value" in `--warn-text`.
- **Chain editor** (see the components) under the heading "chain", with "replaces the inherited chain as a whole · 1–10 rungs" (from `vocab.chainMin` and `vocab.chainMax`).
- **Footer**: "Remove role" (destructive, writes `roles.<name>: null`, shown only when the selected path is the root path), the note "writes roles.execute: null", a spacer, "Reset to inherited" (secondary), and "Queue N edits" (primary).

API: the role's `explain.effective` and `explain.root` entries (paths `roles.<name>.*`), `vocab.roleKeys`, `vocab.rungKeys`, `vocab.effort`, `vocab.roleNamePattern`, `vocab.descriptionMax`, `vocab.modelMax`, `vocab.providerPattern`.

### s4 · Profile editor

- **Sidebar**: "PROFILES", one row per name in `state.profiles` with its origin at the right: "U · selected", "D · preset". The preset names come from `vocab.presetProfiles`. Below the list, the **new profile form**.
- **Editor header**: `profiles.<name>` in `--t-h2`, "declared in user", and at the right "edit in user · path" with the chip `profiles.<name>.*`. A profile path is fixed, so there is no path choice here.
- **Description and extends**: a full-width text input (sans) and a 200px select of the other profile names.
- **Inheritance matrix** (see the components).
- Links under the matrix: "+ limit", "+ role override", "+ model".
- **Footer**: "Remove profile" (hidden for the preset profiles), the note "writes profiles.<name>: null · presets have no Remove", and "Queue edits".

API: `explain.root` entries under `profiles.*`. The matrix reads each ancestor's own values from the `explain.root` paths `profiles.<ancestor>.<field>`, so the ancestor columns need no extra call. The first column is the `normal` profile. The effective column comes from `explain.effective` when the edited profile is the selected profile, else from `GET api/explain?profile=<name>`. Rules come from `vocab.workflow` (`values` to a select, `minimum`/`maximum` to a number input with the range as the placeholder, `auto: true` adds the option "auto", `items` to a group of checkboxes), `vocab.profileKeys`, and `vocab.profileChainMax`.

### s5 · Root settings

A form shaped like the JSON file of the **Edit in** file.

- Header: "root settings" in `--t-h3` and "edit in project · root paths of <path>".
- The form shows `{`, then one row per root key, then `}`, in `--text-faint` punctuation. Key labels are 150px wide. A key that this file sets has a solid control and the label in `--text`. A key that this file does not set has a dashed control, the inherited value inside it in `--text-muted`, and the label in `--text-muted`.
- Rows:
  - `"defaults"`: a select with "latest" and each name in `state.defaults.sets`. The hint at the right: "sets: latest · <latest>". After a change, the row gets the edited style and the note "new in project · was 2026-10 from user" in `--warn-text`.
  - `"profile"`: a select of `state.profiles`, plus "inherit" (remove the key). The hint: "user sets \"hackathon\"".
  - `"limits"`: one number input (64px) per key in `vocab.limitKeys`, with the range from `vocab.limitRanges` in the hint ("1–32"), and the override note when a profile or the project file sets the key, for example "1–500 · inherited · ▲ profile hackathon overrides this value (sets 12)".
  - `"harnesses"`: chips of driver kinds. A filled `--accent` square marks a kind in the list. A dashed chip with an outlined square is a known kind that is not in the list. "+ kind" opens an input that checks `vocab.providerPattern`. "remove key (every driver)" queues `remove: true`. A sentence in `--warn-text` warns when a removed kind leaves roles without a driver.
  - `"visuals"`: `{ "plan": ` and a segmented `true` | `false` and `}`.
  - `"models"`: one row per model id from `explain.root` paths `models.<id>.fast`, with a select `true` | `false` | `inherit (X)`. "+ model" adds a row with an id input.
- Footer sentence in `--t-prose` `--text-muted`: "Solid box: the project file sets this key. Dashed box: not set here, the value is inherited. Profiles cannot set defaults, harnesses, or visuals."
- **Preview panel**: "PREVIEW · defaults A -> B", then one line per item in `defaultsChanges` (`path: from -> to`). An item with `overriddenBy` shows in `--text-muted` with "(overridden by <path>)". A dashed `--line` divider, then the sentence "Lines that end with \"overridden by\" change nothing for you, because a file sets that value." When the `defaults` pin has no queued change, the panel shows "Pick another default set to see what changes." in `--text-muted`.

API: `state.defaults` (`selected`, `source`, `latest`, `sets`), `vocab.limitKeys`, `vocab.limitRanges`, `vocab.visualsKeys`, `vocab.modelKeys`, `vocab.harnessesMin`, `vocab.harnessesMax`, `vocab.providerPattern`, and `explain.root`. The preview list comes from `POST api/preview` with the queued edits of this file: `defaultsChanges` is in the response when an edit's path is `["defaults"]`. Call it 300ms after the last change of the `defaults` select.

### s6 · Review

Opens with "Review changes ⏎" in the status bar or Ctrl+Enter (Cmd+Enter on macOS).

- **Tabs**: "REVIEW", then one tab per file with queued edits: "user · 3", "project · 2". The active tab has the `--accent` fill and `--on-accent` text. At the right: "esc to close".
- **Edits column** (400px): "EDITS → <path>", then one block per edit: a marker and the dotted path (`~` changed, `+` new, `-` removed), the change "12 → 16" or "not set → true" in `--text-2`, and the override warning in `--warn-text` when it applies ("▲ project overrides this value (sets 2)").
- **Check** block under a top border: "CHECK", then:
  - "✓ no new errors (validateLayer + merge)" in `--ok` when `newErrors` is empty. Otherwise "✕ N new errors" in `--err`, and one line per item of `newErrors` (`path: message`).
  - "▲ N warnings already in <file> · does not block" in `--warn` when `issues` has warnings.
  - "✓ comments outside the edited values kept" in `--text-2`.
- **Diff**: from `diff` (`{ op, line }[]`). Show each changed block with up to 3 context lines around it. Each block starts with a header row: "@@" in `--text-faint` and a label in `--text-muted`. The label is the dotted path of the first queued edit whose last key appears as `"<key>"` in a changed line of the block, else "lines A–B". Each line: the line number (40px, right aligned, `--text-faint`), the op mark (20px, centered), and the text in `white-space: pre`. Count the old line number for `-` and context lines, and the new line number for `+` lines. Removed lines: `--err-tint-2` background, `--err` number and mark, `--text` text. Added lines: `--ok-tint` background, `--ok` number and mark, `--text` text. Line height 20px. The diff scrolls horizontally.
- **Footer**: "The write stops with \"changed on disk\" if another tool edited the file after the page read it." in `--text-muted`, "Back" (secondary), and "Write N edits to <file>" (accent fill). The Write button is disabled while `newErrors` is not empty.

API: `POST api/preview` with `{ file, base: files[k].hash, edits }` returns `{ text, diff, issues, newErrors, defaultsChanges? }`. Only the Write button calls `POST api/write` with the same body. On success (`{ ok: true, state }`), replace the page state with `state`, clear that file's queue, close the panel when no queue remains, and show "✓ wrote N edits to <file>" in the status bar in `--ok` for 4 seconds. Errors are in s7.

### s7 · States

The states board shows eight cards. Each state appears where its card says.

1. **Conflict: 409 `config_changed`**. In the review panel footer and in the status bar. A banner with `--err-tint-2` fill: "✕ CHANGED ON DISK" in bold `--err`, the server `message` in `--text`, and "Reload…" (primary). "Reload…" opens a confirm row on `--bg-panel`: "Reload drops the N queued edits for user. Edits for project stay.", "Keep editing" (secondary), and "Drop N edits and reload" (`--err` fill, `--on-err` text). The confirm drops only the queue of the file that failed, then calls `GET api/state`.
2. **New validation error: 422 `config_invalid`**. The tree row of each `newErrors` path gets the `--err-tint` fill, a 3px `--err` left border, the value and the message in `--err`, and "✕ error" at the right. The inspector (or the editor pane) shows "WRITE BLOCKED · N NEW ERROR", the message in `--text`, and "Add a rung, then open the review again. Nothing was written." in `--t-prose`. Field controls in s3 to s5 with an error get a 1px `--err` border and the message beside them in `--err` (s5 shows this on `maxDepth`).
3. **Absent file**. When `files[k].present` is false: the pipeline card has a dashed `--warn` border and "absent", the **Edit in** segment for that file is disabled, and the card text says "Edit in project is off and the project layer is empty. The editor does not create files." with the command `omt init` (project) or `omt config init` (user) and a "copy" link. A 404 `config_not_found` from the API shows the same card.
4. **Stopped**. When `api/ping` fails: the status bar shows the `--err` dot and "disconnected · the editor stopped" and "user: N queued (not written)". Every control becomes disabled. A card says "The page is read-only now. Queued edits were not written. Start the editor again:" with `omt config edit --web` and "copy".
5. **Loading**. Before `api/state` returns: "reading config files…" in `--text-2` and two placeholder rows ("▾ roles" and "▾ limits" followed by a `░` bar) in `--text-faint`. Set `aria-busy="true"` on the tree.
6. **Empty filter**. The filter text, then "no key matches. Did you mean <closest key>?" The closest key is the tree key with the smallest edit distance. Without a key within distance 3, the sentence is "no key matches."
7. **File does not parse: 422 `jsonc_parse`**. When `files[k].issues` has an error with `path: ""`, or the API returns `jsonc_parse`: "✕ <path>: <message>" in `--err`, "Edit in project is off until the file parses. Fix it, then reload.", and "Edits for user still work." The **Edit in** segment for that file is disabled.
8. **Profile does not resolve: 422 `profile_invalid`**. When `api/explain` returns `profile_invalid`, or `explain.effective` is empty: the profile picker keeps the name, and the tree shows only `explain.root` values with the message "profile lab: <message>. The tree shows root values only. Pick another profile, or fix extends in the profile editor."

Other errors from the API (`bad_request`, `unknown_profile`, `forbidden`, `not_found`, any 5xx) show in the status bar as "✕ <message>" in `--err`, with the `hint` after it when the response has one.

Each screen also has these quieter states:

| Screen | Empty | Loading | Error |
| --- | --- | --- | --- |
| s1, s2 | No key selected (see s1). | State 5. | States 2, 7, 8. |
| s3 | The role has no chain: the chain table shows "No rungs. Add 1 to 10." and the Queue button is disabled. | State 5. | State 2 at the field. |
| s4 | A profile with no fields: every hackathon cell shows "inherit". | State 5. | State 2 at the cell. |
| s5 | The file sets no root key: every control is dashed. | State 5. Preview: "checking…" in `--text-muted`. | State 2 at the field, State 7. |
| s6 | No queue: "Review changes" is disabled. | "checking…" in the diff column while `api/preview` runs. | States 1 and 2. |

## Components

### Edit in control

A segmented control in the command bar, `role="radiogroup"` with `aria-label="Edit in"`. Items: `user` and `project`. The selected item has the `--accent` fill, `--on-accent` text, and bold weight. The other item has `--text-2` text. A disabled item (absent file or parse error) has `--text-faint` text, `aria-disabled="true"`, and a `title` that names the reason. The default selection is `user` when the user file is present, else `project`. Every edit control on every screen writes to this file.

### Profile picker

A select-style button in the command bar: the name, a "▼" caret in `--text-muted`, a 1px `--control` border, radius 4px. It lists `state.profiles`. It opens a native `<select>` or a listbox. Picking a name calls `api/explain`. It does not write the `profile` key. s5 writes that key.

### Layer pipeline legend

See s1. Each card starts with a 4-cell strip at 12px high where only the card's own layer cell is filled with `--layer-self`, then "N · LAYER" in `--t-meta` `--text-muted`.

### Key tree row and the D U P F strip

- Row: padding 5px × 24px, gap 10px. Indent 20px per tree level (44px for a leaf in a group, 70px inside an expanded role). Key column 176px (150px when indented under a role). Value column flex 1. Strip column 30px. Source label column 210px.
- Strip: four cells, each 6px × 14px with a 2px gap, in the order defaults, user, project, profile. Cell styles:
  - Winning layer: `--accent` fill.
  - Overridden layer (in `overridden`): `--strip-over` fill.
  - A layer that does not set the path: 1px `--control` outline, no fill.
  - A layer that cannot set the path: an empty 6px slot with no outline. The profile cell is empty for `defaults`, `profile`, `harnesses`, `visuals`, and `profiles.*`. The defaults cell is empty for `defaults`.
- The strip has `role="img"` and an `aria-label` such as "project wins; defaults and user overridden".
- Source label: `defaults <set>`, `user`, `project`, or `profile <name> (<declared label>)` in `--text-2`. A profile source uses `--accent`. "· new role" follows when the source layer created the role.
- Rows are `role="treeitem"` inside `role="tree"`. A collapsed group row has `aria-expanded="false"` and a "▸" mark. An expanded one has "▾".

### Inspector

See s2. Sections are separated by a 1px `--line` top border. Paddings: header 20px top, 16px bottom, 24px sides. Stack 16px × 24px. Edit 16px top, 24px bottom and sides, gap 12px.

### Source stack

See s2. The rail is 20px wide, the dot 10px, the connector 1px. The connector of the winning row and of the rows below it is `--accent`. The others are `--control`. Stack cards have padding 8px × 12px and radius 4px. Rows below a card have 14px bottom padding.

### Edit panel, path choice, and override warning

- Label: "EDIT IN <file> · PATH IN THIS FILE".
- **Path choice**: a radiogroup of option cards, gap 6px. Each card: padding 8px × 10px, radius 4px, a 12px radio, the dotted path in `--t-body`, and a note at the right in `--t-meta` `--text-muted`. The selected card has the `--accent-tint-2` fill, a 1px `--accent` border, a radio with a 4px `--accent` ring, and `--text` path. An unselected card has a `--line` border, a 1px `--text-faint` radio, and `--text-2` path.
- Options for a path P with the selected profile S:
  - P starts with `roles`, `limits`, or `models`: `profiles.S.P` and `P` (root). Show the profile option first when the entry's source is a profile, else the root option first. The first option is selected by default.
  - P starts with `workflow`: only `profiles.S.P`. Show it as one selected card.
  - Any other P (`defaults`, `profile`, `harnesses`, `visuals`, `profiles.*`): only `P`.
- Notes: "wins" when the option would set what runs. "would win" on an unselected option that would set what runs.
- **Override warning**: a full-width line inside the card, under the path, indented 22px to the path text, in `--warn-text`, starting with "▲". The card wraps (`flex-wrap: wrap`) so the warning takes its own line. Show one line per higher layer that sets the edited path, highest first:
  - Root path P in the user file: "▲ project overrides this value · it sets X" when the `explain.root` entry for P has `source.kind === "project"`.
  - Root path P in either file: "▲ profile S overrides this value" when the `explain.effective` entry for P has `source.kind === "profile"`.
  - Profile path `profiles.S.P` in the user file: "▲ project overrides this value" when the `explain.root` entry for `["profiles", S, ...P]` has `source.kind === "project"`.
  - The same warning shows in the stack card of the queued edit, in the role editor row, in the s5 hint, and in the s6 edit list.
- **Value control**: a 90px number input with the range from `vocab.limitRanges` in `--t-meta` (for limits), a segmented control for booleans and short value lists, a select for longer lists, and a text input for strings.
- **Explanation**: one `--t-prose` sentence in `--text-2`. It names the path, the value, and the file. When a higher layer overrides the path, it adds "What runs stays X, because <layer> sets it. To change what runs, pick the profile path or switch Edit in to <file>."
- **Buttons**: "Queue edit" (primary). After the queue it reads "Queued ✓", and "Undo" (secondary) drops the queued edit.
- **Reset to inherited**: an underlined `--text` link, then a `--t-prose` `--text-muted` sentence: "Removes <path> from the <file> file. What runs stays X from <layer>." It queues `{ path, remove: true }`. It is disabled with the sentence "Reset to inherited is off: the <file> file does not set this key." when the file does not set the path.

### Chain editor

- A table with a 1px `--line` border and radius 3px. Header row: `#` (34px), provider (110px), driver (110px), model (150px), effort (70px), fast (44px), options (flex), actions (60px). Gap 10px, padding 7px × 10px, header text `--t-micro` `--text-muted`.
- Rung rows: padding 6px × 10px, divider `--line-soft`. Cells are inputs with a 1px `--control` border, padding 3px × 6px. Effort is a select of `vocab.effort`. Fast is a checkbox, shown as "—" when unset. Options shows `key=value` pairs and "+ key=value" in `--accent`.
- The first column shows the drag handle "⋮⋮" and the rung number. Actions: "↑↓" (two buttons) and "✕". Each button has an `aria-label`, for example "Move rung 2 up" and "Remove rung 2".
- "+ rung" under the table in `--accent`. It is disabled at `vocab.chainMax` rungs. "✕" is disabled at `vocab.chainMin` rungs.
- The whole chain is one edit: `{ path: [...roles.<name>.chain], value: [...] }`.

### New role and new profile forms

Inline in the sidebar on `--bg-panel` with top and bottom `--line` borders, padding 14px × 20px, gap 8px. Title "+ NEW ROLE · in <file>" in `--accent` `--t-meta`. Fields with `--t-micro` labels: name (checks `vocab.roleNamePattern`), description, access (segmented, `read-only` first), and first rung ("provider · model · effort"). The profile form has name, description (required), and extends. Buttons "Queue" (primary) and "Cancel".

### Profile inheritance matrix

- A table with a `--line` border. Columns: key (200px), one column per ancestor in the extends chain from `normal` to the parent (120px each), the edited profile (170px, header in `--accent` with "✎"), and "effective" (flex). With more than 3 ancestors, the matrix scrolls horizontally and the key column stays sticky.
- Group rows ("workflow.build", "limits · roles · models") on `--bg-row-alt`, bold. Collapsed groups show "12 keys, all from normal · expand".
- Ancestor cells: the value of the ancestor that wins has `--accent-tint` fill and a 2px `--accent` inset left mark. A value that a later profile overrides is struck through in `--text-muted`. "·" in `--text-faint` means not set.
- Edited-profile cells: a set value is a control with a 1px `--accent` border. An unset value is a dashed control with "inherit" in `--text-muted`. Changing a cell queues `profiles.<name>.<field>`. Picking "inherit" queues `remove: true`.
- Effective cell: the effective value, and "· root X" in `--text-muted` when it differs from the root value.

### Root settings form

See s5. Rows have padding 5px, 20px left for root keys and 40px for nested keys. A row with a validation error gets the `--err-tint` fill and `box-shadow: inset 2px 0 0 var(--err)`.

### Review panel

See s6.

### Status bar

From left: the connection dot (7px, `--ok` or `--err`) and "connected · 127.0.0.1" or "disconnected · the editor stopped", the issue summary ("▲ N warnings" in `--warn` and the first warning's `path (source): message` in `--text-muted`, or "✕ N errors" in `--err`), a spacer, the queue counts "user: N queued · project: M" in `--text-2`, and "Review changes ⏎" (accent fill). The issue summary reads `state.issues` and every `files[k].issues`. Clicking it opens a list of all issues above the bar.

## Flows

1. **Look up a value.** The page loads (`api/state`, then `api/ping` every 5 seconds). The user filters or browses the tree and selects a row. The inspector shows the stack.
2. **Change a value.** The user sets **Edit in**, selects a key, picks the path in the path choice, enters a value, and clicks "Queue edit". The tree row shows "· <file> X queued". The status bar count goes up.
3. **Edit a role or a profile.** The user opens s3 or s4, changes fields, and clicks "Queue N edits". The edits join the queue of the **Edit in** file.
4. **Change root settings.** The user opens s5 from the "harnesses · visuals · models · defaults" group header or `#/root`. A change of the `defaults` pin shows the preview list before any write.
5. **Review and write.** The user opens s6. The page calls `api/preview` for each file with queued edits. The user reads the diff and clicks "Write N edits to <file>". The page calls `api/write` and loads the returned state.
6. **Recover.** A 409 leads to state 1. A 422 leads to state 2. A failed ping leads to state 4.
7. **Close.** On `pagehide` the page sends `navigator.sendBeacon("api/close")`. A reload sends close and pings again, so the server stays.

The queue is per file and keyed by the dotted path. A second edit of the same path replaces the first. Switching **Edit in** does not move queued edits. Each file keeps its own queue and `base` hash (`files[k].hash` from the last state).

## Focus and keyboard

- Every interactive element shows a focus ring on `:focus-visible`: `outline: 2px solid var(--accent); outline-offset: 2px`. Inside tables and the tree, use `outline-offset: -2px`.
- Tab order follows the visual order: command bar, pipeline (not focusable), filter, tree, inspector, status bar.
- `/` focuses the filter when no input has focus. Esc in the filter clears it.
- Tree: Up and Down move between rows. Right expands a group or a role, and Left collapses it or moves to the parent. Enter on a key selects it into the inspector. Enter on a role or profile header opens s3 or s4. Home and End go to the first and the last row. Only the active row has `tabindex="0"`.
- Segmented controls and the path choice are radiogroups. Left and Right (or Up and Down) move the selection.
- Ctrl+Enter (Cmd+Enter on macOS) opens the review. In the review panel, focus moves to the first tab, Tab stays inside the panel, and Esc closes it and returns focus to the "Review changes" button.
- In the chain editor, Alt+Up and Alt+Down move the focused rung. The drag handle is for the mouse only.
- Confirm rows (state 1) move focus to the safe button ("Keep editing").
- Screen reader labels: the strip (`aria-label` as above), the "↑↓" and "✕" buttons, "copy" links ("Copy omt init"), the caret-only select buttons, and the connection dot ("Editor connected" or "Editor stopped"). The status bar region is `aria-live="polite"`. The review Check list is `aria-live="polite"`.

## Paper file and frames

Paper file: **oh-my-t3code config editor** (https://app.paper.design/file/01M5R06PH4GNHJJ8J5BKWGG14E).

- Page **C · Inspector**: the final dark frames. "C · s1 Effective · dark", "C · s2 Source stack · dark", "C · s3 Role editor · dark", "C · s4 Profile editor · dark", "C · s5 Root settings · dark", "C · s6 Review · dark", "C · s7 States · dark".
- Page **C · final light**: the final light frames with the same names and "· light".
- Pages **A · Ledger** and **B · Stack**: round 1 variants, kept for reference.

## Screenshots

Final, variant C:

| Screen | Dark | Light |
| --- | --- | --- |
| s1 Effective view | `docs/design/config-edit-web/final-s1-effective-dark.png` | `docs/design/config-edit-web/final-s1-effective-light.png` |
| s2 Source stack | `docs/design/config-edit-web/final-s2-source-stack-dark.png` | `docs/design/config-edit-web/final-s2-source-stack-light.png` |
| s3 Role editor | `docs/design/config-edit-web/final-s3-role-editor-dark.png` | `docs/design/config-edit-web/final-s3-role-editor-light.png` |
| s4 Profile editor | `docs/design/config-edit-web/final-s4-profile-editor-dark.png` | `docs/design/config-edit-web/final-s4-profile-editor-light.png` |
| s5 Root settings | `docs/design/config-edit-web/final-s5-root-settings-dark.png` | `docs/design/config-edit-web/final-s5-root-settings-light.png` |
| s6 Review | `docs/design/config-edit-web/final-s6-review-dark.png` | `docs/design/config-edit-web/final-s6-review-light.png` |
| s7 States | `docs/design/config-edit-web/final-s7-states-dark.png` | `docs/design/config-edit-web/final-s7-states-light.png` |

Round 1 files stay in the same folder as `s<k>-<name>-<a|b|c>-dark.png` and `s1-effective-<a|b|c>-light.png`.
