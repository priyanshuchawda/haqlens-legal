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
    page.getByText('Add both a source label and an evidence excerpt before continuing.'),
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

  await expect(page.getByRole('status')).toContainText('Extraction source: fixture');
  await expect(page.getByRole('status')).toContainText('event date: 2026-02-10');
  await expect(page.getByText('Review every item against the original evidence')).toBeVisible();
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

test('has no detectable baseline accessibility violations', async ({ page }) => {
  await page.goto('/');

  const result = await new AxeBuilder({ page }).analyze();

  expect(result.violations).toEqual([]);
});
