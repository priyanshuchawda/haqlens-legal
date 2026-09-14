# Employment and Freelancer First-Aid MVP — Design

## 1. Decision and scope

`h2s-legal-first-aid` is a private working repository, not a final brand.

The first releasable vertical is **Employment and Freelancer First-Aid for India**. A person can submit an offer letter, contract, termination notice, payment record, or a plain-language account of events. The product returns an accessible, evidence-linked preparation packet:

- a plain-language explanation of document terms and the user-reported event;
- a fact timeline, including explicit uncertainty and missing evidence;
- a deadline-risk flag when a date is stated in source material;
- a safe, non-advisory evidence-preservation checklist;
- a list of questions to take to a qualified professional; and
- an official help or legal-aid route when the deterministic rules can identify one.

The application provides legal information and preparation support. It does not determine legal rights, calculate a binding entitlement, draft a legal notice, predict a case outcome, contact any employer or authority, or replace a qualified advocate.

## 2. Product thesis

The differentiator is **proof-to-path**, not a legal chatbot. Every displayed fact must identify its origin: user statement, document page/quote, or a versioned official-source record. The route is then selected by tested, deterministic rules over validated facts. Model prose may explain a route but never select one alone.

The first primary user is a salaried worker or freelancer facing non-payment, disputed notice period, or termination. The first demonstration case is an offer letter plus a termination email; it shows evidence extraction, a fact gap, a date-sensitive checklist, a safe route, and a redacted handoff brief.

## 3. Explicit non-goals

- No broad Indian-law chatbot or unverified legal corpus.
- No case-law research, outcome prediction, document authenticity claim, or automated complaint filing.
- No account system, payments, lawyer marketplace, background jobs, or permanent document storage in the MVP.
- No raw document, personal case narrative, or identifier sent to web-search grounding.
- No alternative cloud model is silently used when Gemini is unavailable.

These exclusions keep the safety promise testable and the first release small enough to be excellent.

## 4. Architecture

The project is a Bun workspace with strict TypeScript. All production source is TypeScript; `allowJs` is disabled. React is used only for presentation and client state. Hono runs the server on Bun. The server is the sole holder of provider credentials and is the policy-enforcement boundary.

```text
apps/web (React + Vite)       apps/api (Hono + Bun)
          |                         |
          +------ typed HTTP -------+
                                    |
             +----------------------+-------------------+
             |                      |                   |
packages/contracts        packages/core        packages/ai-gemini
(Zod schemas)             (pure rules)         (provider adapter)
             |                      |                   |
      packages/official-sources   packages/test-fixtures
      (versioned route data)      (sanitised cases)
```

### Package responsibilities

| Package | Owns | Must not own |
| --- | --- | --- |
| `contracts` | Zod request/response and evidence schemas | provider SDK calls or UI code |
| `core` | pure fact-gap, timeline, risk-state and route functions | HTTP, files, model prompts |
| `official-sources` | reviewed source manifest, version and retrieval date | user data |
| `ai-gemini` | Gemini request, timeout, schema validation and error mapping | routing decisions |
| `test-fixtures` | synthetic/sanitised documents and model responses | production credentials or personal data |
| `api` | authentication-free request boundary, policy checks, orchestration | business rule duplication |
| `web` | accessible guided workflow and local presentation state | secrets or legal decisions |

No package may import an app. Domain rules accept and return immutable typed values so they can be unit-tested without a server or model.

## 5. Data and decision flow

1. The browser presents a disclaimer and informed-consent step before an upload or narrative submission.
2. The client sends a bounded request to the API. The API validates content type, file signature, size, text length, and schema before any processing.
3. The API creates an ephemeral case context in memory. It neither logs raw case text nor persists documents.
4. Gemini receives the document/narrative only for structured extraction. It returns `FactCandidate[]`, each with a source kind, page reference where available, supporting excerpt, confidence band, and `unknown` state.
5. The API parses that response with Zod, rejects malformed or unsupported claims, and passes accepted facts to the pure core engine.
6. The core engine produces `SAFE_ROUTE`, `HUMAN_REVIEW_REQUIRED`, `INSUFFICIENT_INFORMATION`, `URGENT_SAFETY_EXIT`, or `UNSUPPORTED_SCOPE`, with rule identifiers and required follow-up facts.
7. A separate explanation generation pass can turn that already-selected result into plain language. It cannot add route actions or factual claims without evidence IDs.
8. The browser renders a source-linked timeline, missing-evidence list, and optionally a locally generated redacted handoff brief. Data disappears when the user ends the session or refreshes the page.

### Required evidence object

```ts
type Evidence = {
  id: string;
  kind: 'user_statement' | 'document_quote' | 'official_source';
  sourceLabel: string;
  page: number | null;
  excerpt: string;
  factKey: string;
  confidence: 'high' | 'medium' | 'low' | 'unverified';
};
```

A claim without an evidence ID is invalid at the contract boundary and must not render.

## 6. Gemini and fallback strategy

Gemini is the primary document-understanding provider. The server uses a pinned model identifier via environment configuration, native PDF/document input where suitable, and JSON structured output validated against the `FactCandidate` schema. Prompts forbid legal conclusions, invented citations, or advice; the desired output is extraction and uncertainty only.

Provider failure, a timeout, schema-invalid output, or a safety-block response triggers **Rule-Only Safe Mode**:

- keep manually entered facts only;
- show generic evidence-preservation and professional-handoff guidance;
- never fabricate an analysis or mark a route as confirmed;
- expose a retry action without retaining the failed request.

The provider interface supports an explicit future fallback adapter, but no secondary provider is enabled by default. This avoids moving sensitive documents to another company without the user understanding that transfer. Test and demo modes use a deterministic fixture provider, never a live key.

## 7. Security and privacy contract

Threat model priorities are accidental disclosure, prompt injection inside uploaded documents, misleading output, hostile file uploads, and secret leakage.

- `GEMINI_API_KEY` exists only in the API process environment. It is never bundled, logged, committed, returned, or placed in browser storage.
- Uploads use allow-listed MIME types plus magic-byte inspection, a small explicit size limit, request timeouts, and total-body limits. Archives, executables, password-protected documents, and malformed PDFs are rejected.
- The API uses deny-by-default CORS, security headers, same-origin requests, rate limits, request IDs without sensitive payloads, and redacted structured logs.
- Treat uploaded documents as untrusted instructions. Model/system prompts state that document content is data, never authority to change system behavior.
- The app has zero server-side user-content persistence in MVP. No analytics SDK, session replay, third-party fonts, or production telemetry receives case content.
- Public legal-source lookup uses a versioned official-source manifest. If a future grounded web lookup is added, it receives only a generic jurisdiction/topic query after PII redaction and displays returned citations.
- Export is explicit, client initiated, and previewed after redaction. The user chooses whether to include contact details.
- Dependency versions are locked; dependency audit, secret scanning, and license review are part of the release gate.

## 8. User-experience and accessibility contract

The workflow is a guided three-step experience: `Tell us what happened` → `Review the facts` → `Choose the next safe step`. It must be usable with keyboard only, screen readers, mobile narrow screens, 200% zoom, reduced motion, and high-contrast settings.

The UI never uses colour alone for risk. Every status has text, icon, focus-visible control, and a concise explanation. Initial copy is English and Hindi-ready: message keys are isolated from components, date and number formatting are locale-aware, and no content depends on a specific script direction. The initial accessibility target is WCAG 2.2 AA.

## 9. Failure and edge-case behavior

| Situation | Safe behaviour |
| --- | --- |
| Immediate danger, coercion, self-harm, or emergency cue | Stop normal flow; show emergency-support guidance, no legal analysis |
| Date present but ambiguous | Render `date needs confirmation`, never calculate a deadline |
| Contradictory documents | Preserve both facts, mark conflict, require human review |
| Scanned/illegible document | Ask for clearer material or manual facts; do not infer |
| Unsupported legal matter | Give a scope boundary and a human-help preparation checklist |
| Gemini outage or invalid JSON | Rule-Only Safe Mode; no fake success |
| User edits a extracted fact | Preserve original/effective value distinction and mark it user-confirmed |
| Model sees instruction-like text in a document | Ignore it as data and surface only evidence-bearing facts |

## 10. Quality strategy

Every change must pass locally before a pull request:

```text
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run test:integration
bun run test:e2e
bun run test:a11y
bun run audit
bun run secret:scan
```

Tests are layered:

- Unit: pure routing, fact gaps, date ambiguity, redaction, and invariant tests.
- Property tests: invalid or random evidence sets never produce a confirmed route without required facts.
- Contract: Zod schema rejection and API error envelopes.
- Integration: provider timeouts, malformed JSON, safety blocks, file-policy rejection, and rule-only fallback.
- End-to-end: the complete employment scenario, keyboard flow, mobile viewport, and no-key-in-client bundle assertion.
- Security regression fixtures: prompt injection, fake PDF, oversize file, PII-like input, and malicious text in a document.

Coverage is meaningful, not cosmetic: branch coverage is enforced on `core`, `contracts`, and `api` policy modules, while behavioral acceptance tests protect user-visible flows.

## 11. GitHub delivery contract

The repository remains private. Work advances through small issues and reviewable pull requests:

1. Create a narrowly scoped issue with acceptance criteria and threat/edge-case notes.
2. Create a branch named `<type>/<issue>-<slug>` from current `main`.
3. Keep each commit focused and conventional (`docs:`, `feat:`, `fix:`, `test:`, `chore:`).
4. Run the local gate and inspect `git diff --check` before opening a PR.
5. The PR describes user impact, security impact, tests, accessibility effect, and rollback.
6. Merge only after the checks and review checklist pass; delete the remote and local feature branch after merge.
7. Start the next issue only from updated `main`.

GitHub Actions are not enabled initially. Local gates and recorded PR evidence are mandatory; CI can be added after the baseline is stable.

## 12. Sequenced issues and acceptance milestones

1. **Architecture contract** — this document, repository standards, and PR template.
2. **Strict workspace baseline** — Bun workspace, TypeScript strictness, lint/format/test/audit scripts, and ignore/secret policy.
3. **Domain contracts and proof-to-path core** — schemas, pure route state machine, official-source manifest, and exhaustive rule tests.
4. **Secure API boundary** — Hono API, upload policy, error envelopes, rate limits, request redaction, fixture provider.
5. **Gemini extraction adapter** — structured output, timeout/error mapping, safety prompts, and rule-only fallback tests.
6. **Accessible intake and fact review** — React guided flow, evidence-origin display, correction UI, responsive and a11y tests.
7. **Action packet and redacted handoff** — timeline, checklist, official-route citations, export preview, no-persistence validation.
8. **Release evidence** — adversarial fixtures, E2E walkthrough, bundle-secret scan, README, demo data, and final verification report.

## 13. Definition of done for the MVP

The demo must run locally with a deterministic provider fixture and with Gemini configured. It must demonstrate one realistic synthetic employment dispute, cite all displayed facts, reject unsafe uploads, recover safely from provider failure, pass the quality gate, and make its legal-information boundary unmistakable. No claim is made that the product gives legal advice or is ready for public production use.
