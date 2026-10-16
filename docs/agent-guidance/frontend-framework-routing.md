# Frontend Framework Routing

Use the `react` family for React APIs and the separate `nextjs` family for
Next.js framework behavior. Each family owns its version selection and local
references; a cross-stack task may load both families.

## Selection

1. Identify the target package and read its `package.json` (or lockfile) for
   `react`, `react-dom`, and `next` constraints. An explicit task target takes
   precedence over a repository-wide guess.
2. Resolve each family independently. For a monorepo, inspect the package that
   owns the changed files; select each target separately for a multi-target task.
3. Pause before versioned guidance or edits when the package, version range,
   manifest evidence, or React/React DOM versions conflict or remain ambiguous.
   Report the evidence needed to continue.
4. For migrations, distinguish the source version from the requested target.
   Load source and target references only when their compatibility details are
   needed.

## Compatibility map

| Next.js branch | React branch | Routing note |
| --- | --- | --- |
| 15.5 | 18 or 19 | Use `nextjs` for Next.js and `react` for the selected React version. |
| 16 | 18.2+ or 19 | Resolve the Next.js and React versions independently. |
| standalone | 18 or 19 | Use `react` without loading `nextjs`. |

The selected family owns API details, migration traps, and verification gates.
