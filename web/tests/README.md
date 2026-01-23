# Resonate E2E Tests

End-to-end tests for the Resonate web application using [Playwright](https://playwright.dev).

## Prerequisites

- Node.js 18+
- Playwright browsers installed

```bash
# Install Playwright browsers (first time only)
npx playwright install chromium
```

## Running Tests

```bash
# Run all tests
npm run test:e2e

# Or directly with Playwright
npx playwright test

# Run with UI mode (interactive)
npx playwright test --ui

# Run specific test file
npx playwright test tests/catalog.spec.ts

# Run tests matching pattern
npx playwright test -g "HOME-01"

# Show HTML report after run
npx playwright show-report
```

## Test Files

| File | Description | Tests |
|------|-------------|-------|
| `catalog.spec.ts` | Home page and catalog functionality | 6 |
| `player.spec.ts` | Audio player controls and display | 5 |
| `upload.spec.ts` | Artist upload flow (auth gate) | 3 |
| `auth.spec.ts` | Authentication UI and navigation | 5 |
| `ui.spec.ts` | General UI component rendering | 4 |
| `aa.spec.ts` | Account abstraction flows (requires backend) | 2 |

## Test Categories

### Catalog & Home Page (`catalog.spec.ts`)
- `HOME-01`: Hero section renders title
- `HOME-02`: Mood chips displayed
- `HOME-03`: New Releases section exists
- `HOME-04`: Start session and Upload buttons visible
- `HOME-05`: AI Curated section exists
- `HOME-06`: Upload stems link navigates correctly

### Player (`player.spec.ts`)
- `PLAYER-01`: Player controls render (Play/Prev/Next)
- `PLAYER-02`: Now playing label visible
- `PLAYER-03`: Volume control present
- `PLAYER-04`: Track Info card exists
- `PLAYER-05`: Progress slider present

### Upload Flow (`upload.spec.ts`)
- `UPLOAD-01`: Auth gate shows for unauthenticated users
- `UPLOAD-02`: Upload page has correct title
- `UPLOAD-03`: Artist upload route accessible

### Authentication (`auth.spec.ts`)
- Connect wallet CTA visible
- Self-custody actions panel renders
- Sidebar navigation works

### Account Abstraction (`aa.spec.ts`)
> ⚠️ These tests require the backend server running on `localhost:3000`

- Session key issuance
- Smart account deployment

## Configuration

See [`playwright.config.ts`](../playwright.config.ts) for test configuration:

- **Browser**: Chromium
- **Base URL**: `http://localhost:3001` (dev server)
- **Timeout**: 30s per test
- **Retries**: 1 on CI

## Writing New Tests

```typescript
import { test, expect } from "@playwright/test";

test.describe("Feature Name", () => {
  test("TEST-ID: Description", async ({ page }) => {
    await page.goto("/route");
    
    // Use role-scoped selectors for specificity
    const main = page.getByRole("main");
    await expect(main.getByRole("button", { name: "Submit" })).toBeVisible();
    
    // Or use class-based locators
    await expect(page.locator(".component-class")).toContainText("Expected");
  });
});
```

### Selector Best Practices

1. **Scope to `main`** when testing page content to avoid sidebar matches
2. **Use `getByRole`** for interactive elements (buttons, links, inputs)
3. **Use `.locator(".class")`** for specific component classes
4. **Avoid `getByText` alone** if text appears in multiple places

## CI Integration

Tests run automatically on PR via GitHub Actions. The `aa.spec.ts` tests are skipped in CI when the backend is not available.
