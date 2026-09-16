import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { App } from './App';

const window = new Window({ url: 'http://localhost/' });

Object.assign(globalThis, {
  document: window.document,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  navigator: window.navigator,
  window,
});

const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');

afterEach(cleanup);

function spyOnFetch(response: () => Promise<Response> = async () => new Response()) {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = Object.assign(
    async (..._arguments: Parameters<typeof fetch>) => {
      void _arguments;
      requests += 1;
      return response();
    },
    { preconnect: originalFetch.preconnect },
  );

  return {
    requests: () => requests,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function secondLabeledControl(label: string): HTMLElement {
  const control = screen.getAllByLabelText(label)[1];
  if (control === undefined) throw new Error(`Expected a second ${label} control.`);
  return control;
}

describe('App component', () => {
  test('renders the local-only safety boundary and bounded evidence controls', () => {
    render(<App />);

    const safetyNotice = screen.getByRole('note').textContent;
    expect(safetyNotice).toContain('legal information and preparation support, not legal advice');
    expect(safetyNotice).toContain('held only in this browser while you use this page');
    expect((screen.getByLabelText('Source label') as HTMLInputElement).maxLength).toBe(120);
    expect((screen.getByLabelText('Evidence excerpt') as HTMLTextAreaElement).maxLength).toBe(
      2_000,
    );
  });

  test('requires confirmation before clearing the in-memory session', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Clear this session' }));
    expect(screen.getByRole('alertdialog')).toBeDefined();
    expect(screen.getByRole('alertdialog').getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep working' }));
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Clear all local data' }),
    );
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep working' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear this session' }));
  });

  test('caps evidence drafts at the extraction contract limit', async () => {
    const user = userEvent.setup();
    render(<App />);

    for (let index = 1; index < 20; index += 1) {
      await user.click(screen.getByRole('button', { name: 'Add evidence' }));
    }

    expect(screen.getAllByRole('group', { name: /^Evidence \d+$/u })).toHaveLength(20);
    expect(screen.queryByRole('button', { name: 'Add evidence' })).toBeNull();
  });

  test('keeps incomplete evidence local instead of requesting extraction', async () => {
    const user = userEvent.setup();
    const fetchSpy = spyOnFetch();

    try {
      render(<App />);
      await user.click(screen.getByRole('button', { name: 'Extract facts for review' }));

      expect(
        screen.getByText(
          'Add a source label and an evidence excerpt to every evidence item before continuing.',
        ),
      ).toBeDefined();
      expect(fetchSpy.requests()).toBe(0);
    } finally {
      fetchSpy.restore();
    }
  });

  test('keeps unsafe evidence text local instead of requesting extraction', async () => {
    const user = userEvent.setup();
    const fetchSpy = spyOnFetch();

    try {
      render(<App />);
      fireEvent.change(screen.getByLabelText('Source label'), {
        target: { value: 'Termination\u0001email' },
      });
      await user.click(screen.getByRole('button', { name: 'Extract facts for review' }));

      expect(screen.getByText('Evidence text cannot contain control characters.')).toBeDefined();
      expect(fetchSpy.requests()).toBe(0);
    } finally {
      fetchSpy.restore();
    }
  });

  test('fails closed without rendering extraction transport details', async () => {
    const user = userEvent.setup();
    const fetchSpy = spyOnFetch(async () => {
      throw new Error('provider transport detail must stay private');
    });

    try {
      render(<App />);
      await user.type(screen.getByLabelText('Source label'), 'Termination email');
      await user.type(screen.getByLabelText('Evidence excerpt'), 'Employment ended today.');
      await user.click(screen.getByRole('button', { name: 'Extract facts for review' }));

      expect(
        await screen.findByRole('heading', { name: 'Fact extraction is unavailable' }),
      ).toBeDefined();
      expect(screen.queryByText('provider transport detail must stay private')).toBeNull();
      expect(fetchSpy.requests()).toBe(1);
    } finally {
      fetchSpy.restore();
    }
  });

  test('fails closed when an extraction response has malformed JSON', async () => {
    const user = userEvent.setup();
    const fetchSpy = spyOnFetch(
      async () =>
        new Response('{', { headers: { 'content-type': 'application/json' }, status: 200 }),
    );

    try {
      render(<App />);
      await user.type(screen.getByLabelText('Source label'), 'Termination email');
      await user.type(screen.getByLabelText('Evidence excerpt'), 'Employment ended today.');
      await user.click(screen.getByRole('button', { name: 'Extract facts for review' }));

      expect(
        await screen.findByRole('heading', { name: 'Fact extraction is unavailable' }),
      ).toBeDefined();
      expect(screen.queryByText('{')).toBeNull();
      expect(fetchSpy.requests()).toBe(1);
    } finally {
      fetchSpy.restore();
    }
  });

  test('shows bounded retry guidance without rendering a rate-limit payload', async () => {
    const user = userEvent.setup();
    const fetchSpy = spyOnFetch(
      async () =>
        new Response('provider payload must stay private', {
          headers: { 'retry-after': '12' },
          status: 429,
        }),
    );

    try {
      render(<App />);
      await user.type(screen.getByLabelText('Source label'), 'Termination email');
      await user.type(screen.getByLabelText('Evidence excerpt'), 'Employment ended today.');
      await user.click(screen.getByRole('button', { name: 'Extract facts for review' }));

      expect(
        await screen.findByRole('heading', { name: 'Please wait before trying again' }),
      ).toBeDefined();
      expect(
        screen.getByText('Try again in about 12 seconds. No facts were generated.'),
      ).toBeDefined();
      expect(screen.queryByText('provider payload must stay private')).toBeNull();
      expect(fetchSpy.requests()).toBe(1);
    } finally {
      fetchSpy.restore();
    }
  });

  test('renders an evidence-linked fact review after successful extraction', async () => {
    const user = userEvent.setup();
    const fetchSpy = spyOnFetch(async () =>
      Response.json({
        source: 'fixture',
        safeMode: false,
        facts: [
          {
            key: 'event_date',
            value: '2026-02-10',
            certainty: 'confirmed',
            evidenceIds: ['evidence-1'],
          },
        ],
      }),
    );

    try {
      render(<App />);
      await user.type(screen.getByLabelText('Source label'), 'Termination email');
      await user.type(screen.getByLabelText('Evidence excerpt'), 'Employment ended today.');
      await user.click(screen.getByRole('button', { name: 'Extract facts for review' }));

      expect(
        await screen.findByRole('heading', { name: 'Step 2 of 3: confirm facts' }),
      ).toBeDefined();
      expect(screen.getByText('Extraction source: fixture')).toBeDefined();
      expect((screen.getByLabelText('Fact 1 value') as HTMLInputElement).value).toBe('2026-02-10');
      expect(
        (screen.getByRole('checkbox', { name: 'Termination email' }) as HTMLInputElement).checked,
      ).toBe(true);
      expect(fetchSpy.requests()).toBe(1);
    } finally {
      fetchSpy.restore();
    }
  });

  test('renders a validated preparation route after fact review', async () => {
    const user = userEvent.setup();
    let responseNumber = 0;
    const fetchSpy = spyOnFetch(async () => {
      responseNumber += 1;
      return responseNumber === 1
        ? Response.json({
            source: 'fixture',
            safeMode: false,
            facts: [
              {
                key: 'event_date',
                value: '2026-02-10',
                certainty: 'confirmed',
                evidenceIds: ['evidence-1'],
              },
            ],
          })
        : Response.json({
            status: 'safe_preparation_route',
            ruleId: 'scope.termination.preparation',
            actions: [{ id: 'preserve', label: 'Preserve original records before sharing them.' }],
            missingFacts: [],
          });
    });

    try {
      render(<App />);
      await user.type(screen.getByLabelText('Source label'), 'Termination email');
      await user.type(screen.getByLabelText('Evidence excerpt'), 'Employment ended today.');
      await user.click(screen.getByRole('button', { name: 'Extract facts for review' }));
      await screen.findByRole('heading', { name: 'Step 2 of 3: confirm facts' });
      await user.click(screen.getByRole('button', { name: 'Check preparation path' }));

      expect(await screen.findByRole('heading', { name: 'Preparation steps' })).toBeDefined();
      expect(screen.getByText('Deterministic rule: scope.termination.preparation')).toBeDefined();
      expect(screen.getByText('Preserve original records before sharing them.')).toBeDefined();
      expect(fetchSpy.requests()).toBe(2);
    } finally {
      fetchSpy.restore();
    }
  });

  test('renders a source-linked excerpt brief only when its source targets are preserved', async () => {
    const user = userEvent.setup();
    let responseNumber = 0;
    const document = {
      sourceLabel: 'Termination email',
      text: 'Employment ended today.',
      segments: [
        {
          id: 'segment-1',
          page: null,
          sourceStart: 0,
          sourceEnd: 23,
          text: 'Employment ended today.',
        },
      ],
    };
    const fetchSpy = spyOnFetch(async () => {
      responseNumber += 1;
      return responseNumber === 1
        ? Response.json({
            source: 'fixture',
            safeMode: false,
            facts: [
              {
                key: 'event_date',
                value: '2026-02-10',
                certainty: 'confirmed',
                evidenceIds: ['evidence-1'],
              },
            ],
          })
        : Response.json({
            document,
            items: [
              {
                citation: { segmentIds: ['segment-1'] },
                kind: 'summary',
                severity: null,
                text: 'Review this source excerpt before taking any next step.',
              },
            ],
          });
    });

    try {
      render(<App />);
      await user.type(screen.getByLabelText('Source label'), document.sourceLabel);
      await user.type(screen.getByLabelText('Evidence excerpt'), document.text);
      await user.click(screen.getByRole('button', { name: 'Extract facts for review' }));
      await screen.findByRole('heading', { name: 'Step 2 of 3: confirm facts' });
      await user.click(screen.getByRole('button', { name: 'Create source-linked excerpt brief' }));

      expect(
        await screen.findByRole('heading', { name: 'Review the cited excerpt' }),
      ).toBeDefined();
      expect(
        screen.getByText('Review this source excerpt before taking any next step.'),
      ).toBeDefined();
      expect(
        screen.getByRole('link', { name: 'Termination email, excerpt 1' }).getAttribute('href'),
      ).toBe('#brief-source-segment-1');
      expect(screen.getAllByText('Employment ended today.')).toHaveLength(2);
      expect(fetchSpy.requests()).toBe(2);
    } finally {
      fetchSpy.restore();
    }
  });

  test('fails closed when a brief response substitutes its submitted source text', async () => {
    const user = userEvent.setup();
    let responseNumber = 0;
    const fetchSpy = spyOnFetch(async () => {
      responseNumber += 1;
      return responseNumber === 1
        ? Response.json({
            source: 'fixture',
            safeMode: false,
            facts: [
              {
                key: 'event_date',
                value: '2026-02-10',
                certainty: 'confirmed',
                evidenceIds: ['evidence-1'],
              },
            ],
          })
        : Response.json({
            document: {
              sourceLabel: 'Termination email',
              text: 'Substituted source text.',
              segments: [
                {
                  id: 'segment-1',
                  page: null,
                  sourceStart: 0,
                  sourceEnd: 24,
                  text: 'Substituted source text.',
                },
              ],
            },
            items: [],
          });
    });

    try {
      render(<App />);
      await user.type(screen.getByLabelText('Source label'), 'Termination email');
      await user.type(screen.getByLabelText('Evidence excerpt'), 'Employment ended today.');
      await user.click(screen.getByRole('button', { name: 'Extract facts for review' }));
      await screen.findByRole('heading', { name: 'Step 2 of 3: confirm facts' });
      await user.click(screen.getByRole('button', { name: 'Create source-linked excerpt brief' }));

      expect(
        await screen.findByRole('heading', { name: 'Source-linked brief is unavailable' }),
      ).toBeDefined();
      expect(screen.queryByText('Substituted source text.')).toBeNull();
    } finally {
      fetchSpy.restore();
    }
  });

  test('renders a deterministic comparison with links to both source excerpts', async () => {
    const user = userEvent.setup();
    let responseNumber = 0;
    const left = {
      sourceLabel: 'Earlier agreement',
      text: 'Old clause.',
      segments: [
        { id: 'segment-1', page: null, sourceStart: 0, sourceEnd: 11, text: 'Old clause.' },
      ],
    };
    const right = {
      sourceLabel: 'Revised agreement',
      text: 'New clause.',
      segments: [
        { id: 'segment-1', page: null, sourceStart: 0, sourceEnd: 11, text: 'New clause.' },
      ],
    };
    const fetchSpy = spyOnFetch(async () => {
      responseNumber += 1;
      return responseNumber === 1
        ? Response.json({
            source: 'fixture',
            safeMode: false,
            facts: [
              {
                key: 'event_date',
                value: '2026-02-10',
                certainty: 'confirmed',
                evidenceIds: ['evidence-1'],
              },
            ],
          })
        : Response.json({
            left,
            right,
            changes: [
              { kind: 'changed', leftSegmentIds: ['segment-1'], rightSegmentIds: ['segment-1'] },
            ],
          });
    });

    try {
      render(<App />);
      await user.type(screen.getByLabelText('Source label'), left.sourceLabel);
      await user.type(screen.getByLabelText('Evidence excerpt'), left.text);
      await user.click(screen.getByRole('button', { name: 'Add evidence' }));
      await user.type(secondLabeledControl('Source label'), right.sourceLabel);
      await user.type(secondLabeledControl('Evidence excerpt'), right.text);
      await user.click(screen.getByRole('button', { name: 'Extract facts for review' }));
      await screen.findByRole('heading', { name: 'Step 2 of 3: confirm facts' });
      await user.click(screen.getByRole('button', { name: 'Compare first two evidence excerpts' }));

      expect(
        await screen.findByRole('heading', { name: 'Review changes between excerpts' }),
      ).toBeDefined();
      expect(screen.getByRole('heading', { name: 'Changed excerpt' })).toBeDefined();
      expect(
        screen.getByRole('link', { name: 'Earlier agreement, excerpt 1' }).getAttribute('href'),
      ).toBe('#comparison-left-segment-1');
      expect(
        screen.getByRole('link', { name: 'Revised agreement, excerpt 1' }).getAttribute('href'),
      ).toBe('#comparison-right-segment-1');
      expect(fetchSpy.requests()).toBe(2);
    } finally {
      fetchSpy.restore();
    }
  });

  test('fails closed when a comparison response swaps the submitted source document', async () => {
    const user = userEvent.setup();
    let responseNumber = 0;
    const fetchSpy = spyOnFetch(async () => {
      responseNumber += 1;
      return responseNumber === 1
        ? Response.json({
            source: 'fixture',
            safeMode: false,
            facts: [
              {
                key: 'event_date',
                value: '2026-02-10',
                certainty: 'confirmed',
                evidenceIds: ['evidence-1'],
              },
            ],
          })
        : Response.json({
            left: {
              sourceLabel: 'Swapped source detail',
              text: 'Swapped source detail',
              segments: [],
            },
            right: {},
            changes: [],
          });
    });

    try {
      render(<App />);
      await user.type(screen.getByLabelText('Source label'), 'Earlier agreement');
      await user.type(screen.getByLabelText('Evidence excerpt'), 'Old clause.');
      await user.click(screen.getByRole('button', { name: 'Add evidence' }));
      await user.type(secondLabeledControl('Source label'), 'Revised agreement');
      await user.type(secondLabeledControl('Evidence excerpt'), 'New clause.');
      await user.click(screen.getByRole('button', { name: 'Extract facts for review' }));
      await screen.findByRole('heading', { name: 'Step 2 of 3: confirm facts' });
      await user.click(screen.getByRole('button', { name: 'Compare first two evidence excerpts' }));

      expect(
        await screen.findByRole('heading', { name: 'Source comparison is unavailable' }),
      ).toBeDefined();
      expect(screen.queryByText('Swapped source detail')).toBeNull();
    } finally {
      fetchSpy.restore();
    }
  });
});
