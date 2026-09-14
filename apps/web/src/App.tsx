import { type FormEvent, useId, useState } from 'react';
import {
  extractionFromResponse,
  factKeys,
  routeFromResponse,
  type Fact,
  type RouteDecision,
} from './api';

type ExtractionState = 'idle' | 'submitting' | 'safe-mode' | 'success';
type RouteState = 'idle' | 'submitting' | 'safe-mode' | 'success';
const factLabel = (key: string) => key.replaceAll('_', ' ');

export function App() {
  const sourceLabelId = useId();
  const excerptId = useId();
  const [sourceLabel, setSourceLabel] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [facts, setFacts] = useState<Fact[]>([]);
  const [source, setSource] = useState<'fixture' | 'gemini' | null>(null);
  const [extraction, setExtraction] = useState<ExtractionState>('idle');
  const [route, setRoute] = useState<RouteDecision | null>(null);
  const [routeState, setRouteState] = useState<RouteState>('idle');
  const [formError, setFormError] = useState('');
  const evidence = [
    {
      id: 'evidence-1',
      kind: 'document_quote',
      sourceLabel: sourceLabel.trim(),
      page: null,
      excerpt: excerpt.trim(),
    },
  ];

  async function submitEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sourceLabel.trim() || !excerpt.trim()) {
      setFormError('Add both a source label and an evidence excerpt before continuing.');
      return;
    }
    setFormError('');
    setExtraction('submitting');
    setRoute(null);
    setRouteState('idle');
    try {
      const response = await fetch('/v1/extractions/facts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ evidence }),
      });
      const result = extractionFromResponse(await response.json());
      if (response.ok && result) {
        setFacts(result.facts);
        setSource(result.source);
        setExtraction('success');
        return;
      }
    } catch {
      /* Fail closed without rendering transport or provider details. */
    }
    setExtraction('safe-mode');
  }
  function updateFact(index: number, patch: Partial<Fact>) {
    setFacts((current) =>
      current.map((fact, itemIndex) => (itemIndex === index ? { ...fact, ...patch } : fact)),
    );
  }
  async function submitRoute() {
    if (!facts.length || facts.some((fact) => !fact.value.trim())) {
      setFormError('Add a value to every fact you want to check, or remove it.');
      return;
    }
    setFormError('');
    setRouteState('submitting');
    setRoute(null);
    try {
      const response = await fetch('/v1/routes/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ evidence, facts }),
      });
      const result = routeFromResponse(await response.json());
      if (response.ok && result) {
        setRoute(result);
        setRouteState('success');
        return;
      }
    } catch {
      /* Fail closed without diagnostics. */
    }
    setRouteState('safe-mode');
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
          is held only in this browser while you use this page; document upload is not enabled.
        </p>
      </section>
      <section aria-labelledby="evidence-title" className="workspace">
        <div>
          <p className="eyebrow">Step 1 of 3</p>
          <h2 id="evidence-title">Add one evidence excerpt</h2>
          <p className="supporting-copy">
            Use a short relevant quote. Do not add passwords, bank details, government IDs, or
            anything you would not share with a trusted support person.
          </p>
        </div>
        <form
          aria-describedby={formError ? 'form-error' : undefined}
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
              maxLength={2000}
              onChange={(event) => setExcerpt(event.target.value)}
              placeholder="Paste a short factual excerpt."
              rows={6}
              value={excerpt}
            />
          </div>
          {formError ? (
            <p className="form-error" id="form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <button disabled={extraction === 'submitting'} type="submit">
            {extraction === 'submitting' ? 'Checking evidence…' : 'Extract facts for review'}
          </button>
        </form>
        <section aria-atomic="true" aria-live="polite" className="result-panel">
          {extraction === 'idle' ? (
            <p>Nothing is sent until you select “Extract facts for review.”</p>
          ) : null}
          {extraction === 'safe-mode' ? (
            <div className="safe-mode" role="status">
              <h3>Fact extraction is unavailable</h3>
              <p>
                We have not generated facts from this excerpt. Keep the original evidence and
                consider a qualified local support service.
              </p>
            </div>
          ) : null}
          {extraction === 'success' ? (
            <div className="facts">
              <p className="source-status">Extraction source: {source}</p>
              <h3>Step 2 of 3: confirm facts</h3>
              <p>
                Correct or remove every candidate before checking a preparation path. Original
                evidence remains the source of truth.
              </p>
              {facts.map((fact, index) => (
                <fieldset className="fact-card" key={`${fact.key}-${index}`}>
                  <legend>Fact {index + 1}</legend>
                  <label>
                    Type
                    <select
                      aria-label={`Fact ${index + 1} type`}
                      onChange={(event) =>
                        updateFact(index, { key: event.target.value as Fact['key'] })
                      }
                      value={fact.key}
                    >
                      {factKeys.map((key) => (
                        <option key={key} value={key}>
                          {factLabel(key)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Value
                    <input
                      aria-label={`Fact ${index + 1} value`}
                      maxLength={500}
                      onChange={(event) => updateFact(index, { value: event.target.value })}
                      value={fact.value}
                    />
                  </label>
                  <label>
                    Certainty
                    <select
                      aria-label={`Fact ${index + 1} certainty`}
                      onChange={(event) =>
                        updateFact(index, { certainty: event.target.value as Fact['certainty'] })
                      }
                      value={fact.certainty}
                    >
                      <option value="confirmed">confirmed</option>
                      <option value="uncertain">uncertain</option>
                      <option value="conflicting">conflicting</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setFacts((current) => current.filter((_, itemIndex) => itemIndex !== index))
                    }
                  >
                    Remove fact {index + 1}
                  </button>
                </fieldset>
              ))}
              <button
                type="button"
                onClick={() =>
                  setFacts((current) => [
                    ...current,
                    {
                      key: 'case_category',
                      value: '',
                      certainty: 'uncertain',
                      evidenceIds: ['evidence-1'],
                    },
                  ])
                }
              >
                Add fact
              </button>{' '}
              <button disabled={routeState === 'submitting'} type="button" onClick={submitRoute}>
                {routeState === 'submitting' ? 'Checking route…' : 'Check preparation path'}
              </button>
            </div>
          ) : null}
          {routeState === 'safe-mode' ? (
            <div className="safe-mode" role="status">
              <h3>Preparation path is unavailable</h3>
              <p>
                No route has been generated. Keep the original evidence and seek qualified support
                if needed.
              </p>
            </div>
          ) : null}
          {routeState === 'success' && route ? (
            <div className={`route route-${route.status}`} role="status">
              <p className="source-status">Deterministic rule: {route.ruleId}</p>
              <h3>
                {route.status === 'urgent_safety_exit'
                  ? 'Prioritise immediate safety'
                  : route.status === 'human_review_required'
                    ? 'Human review is needed'
                    : route.status === 'insufficient_information'
                      ? 'More facts are needed'
                      : route.status === 'unsupported_scope'
                        ? 'Human handoff is needed'
                        : 'Preparation steps'}
              </h3>
              <ul>
                {route.actions.map((action) => (
                  <li key={action.id}>{action.label}</li>
                ))}
              </ul>
              {route.missingFacts.length ? (
                <p>Missing facts: {route.missingFacts.map(factLabel).join(', ')}.</p>
              ) : null}
              <p>This is preparation information, not legal advice.</p>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
