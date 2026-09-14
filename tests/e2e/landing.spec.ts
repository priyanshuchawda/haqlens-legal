import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('presents the safety boundary and a keyboard skip link', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Employment First Aid');
  await expect(
    page.getByRole('heading', { name: 'Employment and Freelancer First Aid' }),
  ).toBeVisible();
  await expect(
    page.getByText('legal information and preparation support, not legal advice'),
  ).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to evidence form' })).toBeFocused();
});

test('validates evidence locally before submitting it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Extract facts for review' }).click();

  await expect(
    page.getByText(
      'Add a source label and an evidence excerpt to every evidence item before continuing.',
    ),
  ).toBeVisible();
});

test('shows clearly sourced facts returned by the extraction boundary', async ({ page }) => {
  await page.route('**/v1/extractions/facts', async (route) => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.postDataJSON()).toMatchObject({
      evidence: [{ id: 'evidence-1', kind: 'document_quote' }],
    });
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
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
    });
  });
  await page.goto('/');
  await page.getByLabel('Source label').fill('Synthetic termination email');
  await page
    .getByRole('textbox', { name: 'Evidence excerpt' })
    .fill('Employment ended on 2026-02-10.');
  await page.getByRole('button', { name: 'Extract facts for review' }).click();

  await expect(page.getByText('Extraction source: fixture')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Fact 1 value' })).toHaveValue('2026-02-10');
  await expect(
    page.getByText('Correct or remove every candidate before checking a preparation path.'),
  ).toBeVisible();
});

test('fails closed in the interface when extraction is unavailable', async ({ page }) => {
  await page.route('**/v1/extractions/facts', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        source: 'disabled',
        safeMode: true,
        error: 'rule_only_safe_mode',
        facts: [],
      }),
    }),
  );
  await page.goto('/');
  await page.getByLabel('Source label').fill('Synthetic termination email');
  await page
    .getByRole('textbox', { name: 'Evidence excerpt' })
    .fill('Employment ended on 2026-02-10.');
  await page.getByRole('button', { name: 'Extract facts for review' }).click();

  await expect(page.getByRole('status')).toContainText('Fact extraction is unavailable');
  await expect(page.getByText('We have not generated facts from this excerpt.')).toBeVisible();
});

test('requires reviewed facts and renders the deterministic preparation route', async ({
  page,
}) => {
  await page.route('**/v1/extractions/facts', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        source: 'fixture',
        safeMode: false,
        facts: [
          ['case_category', 'termination'],
          ['jurisdiction_country', 'India'],
          ['jurisdiction_state', 'Maharashtra'],
          ['worker_type', 'employee'],
          ['event_date', '2026-02-10'],
        ].map(([key, value]) => ({
          key,
          value,
          certainty: 'confirmed',
          evidenceIds: ['evidence-1'],
        })),
      }),
    }),
  );
  await page.route('**/v1/routes/prepare', async (route) => {
    expect(route.request().postDataJSON().facts).toHaveLength(5);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'safe_preparation_route',
        ruleId: 'scope.termination.preparation',
        actions: [{ id: 'preserve', label: 'Preserve original records.' }],
        missingFacts: [],
      }),
    });
  });
  await page.goto('/');
  await page.getByLabel('Source label').fill('Synthetic termination email');
  await page
    .getByRole('textbox', { name: 'Evidence excerpt' })
    .fill('Employment ended on 2026-02-10.');
  await page.getByRole('button', { name: 'Extract facts for review' }).click();
  await page.getByRole('button', { name: 'Check preparation path' }).click();
  await expect(page.getByRole('status')).toContainText('Preparation steps');
  await expect(page.getByRole('status')).toContainText(
    'This is preparation information, not legal advice.',
  );
});

test('prioritises an urgent safety route over ordinary preparation content', async ({ page }) => {
  await page.route('**/v1/extractions/facts', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        source: 'fixture',
        safeMode: false,
        facts: [
          {
            key: 'immediate_danger',
            value: 'yes',
            certainty: 'confirmed',
            evidenceIds: ['evidence-1'],
          },
        ],
      }),
    }),
  );
  await page.route('**/v1/routes/prepare', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'urgent_safety_exit',
        ruleId: 'safety.immediate-danger',
        actions: [{ id: 'help', label: 'Seek immediate local emergency support.' }],
        missingFacts: [],
      }),
    }),
  );
  await page.goto('/');
  await page.getByLabel('Source label').fill('Synthetic message');
  await page.getByRole('textbox', { name: 'Evidence excerpt' }).fill('I am in immediate danger.');
  await page.getByRole('button', { name: 'Extract facts for review' }).click();
  await page.getByRole('button', { name: 'Check preparation path' }).click();
  await expect(page.getByRole('status')).toContainText('Prioritise immediate safety');
  await expect(page.getByRole('status')).toContainText('Seek immediate local emergency support.');
});

test('has no detectable baseline accessibility violations', async ({ page }) => {
  await page.goto('/');

  const result = await new AxeBuilder({ page }).analyze();

  expect(result.violations).toEqual([]);
});
