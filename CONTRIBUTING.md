# Contributing

HaqLens Legal uses small, reviewable changes with a clear user or safety outcome.

## Workflow

1. Start from an up-to-date `main` branch.
2. Create one focused branch for one change.
3. Update contracts and documentation when behavior changes.
4. Include privacy, accessibility, and rollback notes in the pull request.
5. Run the local verification gate before merging.
6. Merge the pull request, then delete the topic branch.

GitHub Actions runs the same quality gate on pull requests and pushes to `main`. The local gate is:

```sh
bun run verify
bun run test:e2e
bun run test:a11y
bun run build
git diff --check
```

Never commit `.env`, provider keys, real legal documents, or personally identifying evidence. Use synthetic fixtures and keep Gemini opt-in.
