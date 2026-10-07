export function planTemplate(slug: string, title: string, createdAt: string, options: { light?: boolean; maxParallel?: number } = {}): string {
  const oracle = options.light === true ? "" : "- [ ] F2. The oracle role approves the whole change.\n";
  const limit = options.maxParallel === undefined ? "" : ` max-parallel=${options.maxParallel}`;
  return `# ${title}

<!-- omt-plan v1 slug=${slug} created=${createdAt}${limit} -->

## Objective

<what changes for the user, in one paragraph>

## Done when

- [ ] D1. <a check that can fail: a command, a test, or an observable result>

## Research

<research questions, their cited answers, and sources; or "none">

## Roles

<paste the output of \`omt roles\` here>

## Units

- [ ] U1. <title>
  - Role: execute
  - Scope: <files or directories>
  - Done when: <condition>
  - Verify: \`<command>\`
  - Depends on: none

## Final verification

- [ ] F1. The full test suite passes: \`<command>\`
${oracle}
## Log

- ${createdAt} plan created
`;
}
