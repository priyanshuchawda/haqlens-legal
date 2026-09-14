import { type FormEvent, useId, useState } from 'react';

type Fact = Readonly<{
  key: string;
  value: string;
  certainty: 'confirmed' | 'uncertain' | 'conflicting';
}>;

type ExtractionState =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'submitting' }>
  | Readonly<{ kind: 'safe-mode' }>
  | Readonly<{ kind: 'success'; source: 'fixture' | 'gemini'; facts: readonly Fact[] }>;

function isFact(value: unknown): value is Fact {
  if (typeof value !== 'object' || value === null) return false;

  const fact = value as Record<string, unknown>;
  return (
    typeof fact.key === 'string' &&
    typeof fact.value === 'string' &&
    (fact.certainty === 'confirmed' ||
      fact.certainty === 'uncertain' ||
      fact.certainty === 'conflicting')
  );
}

function isSuccessfulExtraction(value: unknown): value is {
  source: 'fixture' | 'gemini';
  safeMode: false;
  facts: Fact[];
} {
  if (typeof value !== 'object' || value === null) return false;

  const response = value as Record<string, unknown>;
  return (
    (response.source === 'fixture' || response.source === 'gemini') &&
    response.safeMode === false &&
    Array.isArray(response.facts) &&
    response.facts.every(isFact)
  );
}

export function App() {
  const sourceLabelId = useId();
  const excerptId = useId();
  const [sourceLabel, setSourceLabel] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [formError, setFormError] = useState('');
  const [extraction, setExtraction] = useState<ExtractionState>({ kind: 'idle' });

  async function submitEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedSourceLabel = sourceLabel.trim();
    const trimmedExcerpt = excerpt.trim();

    if (trimmedSourceLabel.length === 0 || trimmedExcerpt.length === 0) {
      setFormError('Add both a source label and an evidence excerpt before continuing.');
      return;
    }

    setFormError('');
    setExtraction({ kind: 'submitting' });

    try {
      const response = await fetch('/v1/extractions/facts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          evidence: [
            {
              id: 'evidence-1',
              kind: 'document_quote',
              sourceLabel: trimmedSourceLabel,
              page: null,
              excerpt: trimmedExcerpt,
            },
          ],
        }),
      });
      const payload: unknown = await response.json();

      if (response.ok && isSuccessfulExtraction(payload)) {
        setExtraction({ kind: 'success', source: payload.source, facts: payload.facts });
        return;
      }
    } catch {
      // Every API failure receives the same safe, non-diagnostic UI treatment.
    }

    setExtraction({ kind: 'safe-mode' });
  }

  return (
    <main className="shell" id="main-content">
      <a className="skip-link" href="#evidence-form">
        Skip to evidence form
      </a>
      <section aria-labelledby="page-title" className="hero">
        <p className="eyebrow">Private prototype</p>
        <h1 id="page-title">Employment and Freelancer First Aid</h1>
        <p className="lede">
          Turn a confusing work dispute into a clear, evidence-linked preparation packet.
        </p>
        <p className="notice" role="note">
          This tool provides legal information and preparation support, not legal advice. Your text
          is only held in this browser while you use this page; document upload is not enabled.
        </p>
      </section>

      <section aria-labelledby="evidence-title" className="workspace">
        <div>
          <p className="eyebrow">Step 1 of 2</p>
          <h2 id="evidence-title">Add one evidence excerpt</h2>
          <p className="supporting-copy">
            Use a short, relevant quote from an email, message, contract, or payslip. Do not add
            passwords, bank details, government IDs, or anything you would not share with a trusted
            support person.
          </p>
        </div>

        <form
          aria-describedby={formError.length > 0 ? 'form-error' : undefined}
          id="evidence-form"
          onSubmit={submitEvidence}
        >
          <div className="field">
            <label htmlFor={sourceLabelId}>Source label</label>
            <input
              id={sourceLabelId}
              maxLength={120}
              onChange={(event) => setSourceLabel(event.target.value)}
              placeholder="For example: termination email, 10 February"
              value={sourceLabel}
            />
          </div>
          <div className="field">
            <label htmlFor={excerptId}>Evidence excerpt</label>
            <textarea
              id={excerptId}
              maxLength={5000}
              onChange={(event) => setExcerpt(event.target.value)}
              placeholder="Paste a short factual excerpt."
              rows={6}
              value={excerpt}
            />
          </div>
          {formError.length > 0 ? (
            <p className="form-error" id="form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <button disabled={extraction.kind === 'submitting'} type="submit">
            {extraction.kind === 'submitting' ? 'Checking evidence…' : 'Extract facts for review'}
          </button>
        </form>

        <section aria-atomic="true" aria-live="polite" className="result-panel">
          {extraction.kind === 'idle' ? (
            <p>Nothing is sent until you select “Extract facts for review.”</p>
          ) : null}
          {extraction.kind === 'submitting' ? <p>Checking only the excerpt you provided.</p> : null}
          {extraction.kind === 'safe-mode' ? (
            <div className="safe-mode" role="status">
              <h3>Fact extraction is unavailable</h3>
              <p>
                We have not generated facts from this excerpt. Keep the original evidence, write a
                short timeline in your own words, and consider a qualified local support service.
              </p>
            </div>
          ) : null}
          {extraction.kind === 'success' ? (
            <div className="facts" role="status">
              <p className="source-status">Extraction source: {extraction.source}</p>
              <h3>Facts to review</h3>
              {extraction.facts.length === 0 ? (
                <p>
                  No factual candidates were found. The original evidence remains the source of
                  truth.
                </p>
              ) : (
                <ul>
                  {extraction.facts.map((fact) => (
                    <li key={`${fact.key}-${fact.value}`}>
                      <strong>{fact.key.replaceAll('_', ' ')}:</strong> {fact.value}{' '}
                      <span>({fact.certainty})</span>
                    </li>
                  ))}
                </ul>
              )}
              <p>Review every item against the original evidence before relying on it.</p>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
