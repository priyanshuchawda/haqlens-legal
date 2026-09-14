# Employment and Freelancer First Aid

A private prototype that helps an Indian employee or freelancer prepare a clear, evidence-linked next-step packet. It provides legal information and preparation support, never legal advice or automated legal action.

The MVP architecture and safety boundaries are in [the design specification](docs/superpowers/specs/2026-09-14-employment-first-aid-design.md).

## Local development

Prerequisites: Bun `1.4.2` and a current Chromium installation for browser tests.

```sh
bun install
cp .env.example .env
bun run dev:api
bun run dev:web
```

`AI_PROVIDER=disabled` is the safe default. A real `GEMINI_API_KEY` is needed only once the Gemini adapter is introduced; it must remain in the ignored local `.env` file.

## Verification

```sh
bun run verify
bun run build
bun run test:e2e
bun run test:a11y
```

GitHub Actions are intentionally not configured yet. Every pull request records these local checks, security/privacy impact, accessibility impact, and rollback information.
