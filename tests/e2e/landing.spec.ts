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
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
});

test('has no detectable baseline accessibility violations', async ({ page }) => {
  await page.goto('/');

  const result = await new AxeBuilder({ page }).analyze();

  expect(result.violations).toEqual([]);
});
