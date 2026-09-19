# HaqLens Legal — Release Readiness

## What is finished

This is a complete, locally verifiable document-preparation workflow for Indian users. It supports:

- source-exact evidence segmentation and citations;
- reviewed official-support links;
- cited document briefs;
- deterministic document comparison;
- confirmed-only calendar arithmetic;
- grounded document questions with safe refusal;
- local redacted preparation-packet preview and download;
- secure text/PDF/image file classification;
- review-gated scan transcription with page provenance and confidence;
- opt-in Gemini extraction/transcription with bounded payloads and safe failure;
- English/Hindi safety-boundary onboarding;
- no-persistence browser sessions and no client-side secrets.

## Evidence of readiness

The local release gate passes on `main`:

- 137 tests and 315 assertions;
- coverage, lint, type-check, dependency audit, and secret scan;
- OpenAPI contract validation;
- 11 Chromium end-to-end scenarios;
- 2 accessibility scenarios;
- API and web production builds;
- `git diff --check`.

GitHub Actions runs the quality gate on pull requests and pushes to `main`. GitGuardian is waived by project choice; the local secret scanner remains required.

## Safe operating boundary

The product is legal-information preparation support, not legal advice, legal representation, deadline determination, or automated filing. Provider output is evidence-bound and transcription remains unconfirmed until the user checks it against the original. No document, result, account, or analytics data is persisted.

## Local release command

```sh
bun run test:coverage
bun run test:e2e
bun run test:a11y
bun run verify
bun run build
git diff --check
```

## Hosted surface

The public deployment is [haqlens-legal.vercel.app](https://haqlens-legal.vercel.app). The hosted
default keeps Gemini disabled and does not accept a client-side provider key.
