# Frontend design skill

Anthropic's [frontend-design skill](https://github.com/anthropics/skills/tree/main/skills/frontend-design) guides visual choices during design and UI implementation without a design spec. It is optional and is not bundled with omt.

## Check availability

Look for Anthropic's `frontend-design` skill in the current harness's skill catalog, including plugin-prefixed names. If the catalog has no entry, inspect the project and user skill directories configured for that harness. Use the installed skill's actual path.

When it is missing, recommend installing the official skill linked above. Offer to install it for the user's harness and chosen scope. Install only when the user asks. A missing skill or a declined installation does not block setup, design, or UI implementation.

## Design

Before making design variants, load the installed `frontend-design` skill when available. Apply it with the existing brand, platform conventions, and the owner's requirements. It works with Paper or with HTML mockups when no design tool is available.

When a child draws the variants, put the installed skill's path in its brief and tell it to load the skill before it draws. Keep the owner's design review and approval.

## UI implementation

When the task cites an approved design spec, follow that spec. The implementation does not need to load `frontend-design` again.

Without an approved design spec, implement the UI directly from the task requirements unless the user requested a design pass first. Load the installed `frontend-design` skill when available. For a `ui` child, put the skill's path and the UI requirements in its brief. When the skill is missing, follow the existing app's patterns and the task requirements.

Paper, Figma, a design spec, and the external skill are not prerequisites for direct UI implementation.
