# Employment and Freelancer

A private prototype that helps an Indian employee or freelancer prepare a clear, evidence-linked next-step packet. It provides legal information and preparation support, never legal advice or automated legal action.

The MVP architecture and safety boundaries are in [the design specification](docs/superpowers/specs/2026-09-14-employment-first-aid-design.md).
The bounded machine-readable endpoint contract is [OpenAPI](docs/openapi.json).

## Local development

Prerequisites: Bun `1.4.2` and a current Chromium installation for browser tests.

```sh
bun install
cp .env.example .env
bun run dev:api
bun run dev:web
```

`AI_PROVIDER=disabled` is the safe default. Gemini extraction is enabled only with
`AI_PROVIDER=gemini` and a non-empty `GEMINI_API_KEY`; keep that key only in the ignored local
`.env` file or an equivalent server-side secret store. Never put it in the web app, a commit, a
browser environment variable, or evidence text.

## API privacy and deployment boundary

The API exposes `POST /v1/extractions/facts` and `POST /v1/routes/prepare`. Both accept JSON only,
have a 64 KiB request limit, and return `Cache-Control: no-store`. The browser also explicitly sends
these evidence-bearing requests with `cache: 'no-store'`. The prototype does not persist evidence,
facts, routes, uploads, accounts, or analytics data.

Anonymous write endpoints use an in-memory limit of 30 requests per peer per minute. A rejected
request returns `429`, `{ "error": "rate_limited" }`, and `Retry-After`; it does not parse the body
or invoke Gemini/routing. The table is bounded and expires entries, but is intentionally not a
distributed production rate limiter.

The Bun server uses its direct peer address, never `X-Forwarded-For` or another request-supplied
header. If deployed behind a reverse proxy, do not assume the peer address represents the end user:
add and review an explicit trusted-proxy identity integration first. Do not log evidence text or use
forwarded client identity until that boundary is designed and verified.

## Verification

```sh
bun run verify
bun run build
bun run test:e2e
bun run test:a11y
bun run validate:openapi
```

GitHub Actions are currently disabled by project choice. Every pull request records local checks,
security/privacy impact, accessibility impact, and rollback information; GitGuardian remains the
remote secret-scanning check.
