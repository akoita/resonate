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

# Run only authenticated tests
npx playwright test --grep "authenticated"

# Show HTML report after run
npx playwright show-report
```

## Test Files

### Unauthenticated Tests
| File | Description | Tests |
|------|-------------|-------|
| `catalog.spec.ts` | Home page and catalog functionality | 6 |
| `player.spec.ts` | Audio player controls and display | 5 |
| `upload.spec.ts` | Upload page auth gate | 3 |
| `auth.spec.ts` | Authentication UI and navigation | 5 |
| `ui.spec.ts` | General UI component rendering | 4 |
| `aa.spec.ts` | Account abstraction flows (requires backend) | 2 |

### Authenticated Tests
| File | Description | Tests |
|------|-------------|-------|
| `upload.authenticated.spec.ts` | Full upload form functionality | 7 |
| `player.authenticated.spec.ts` | Player with auth context | 5 |
| `error-handling.spec.ts` | Form validation and errors | 4 |

### Auth Fixtures
| File | Description |
|------|-------------|
| `auth.setup.ts` | Mock auth injection for authenticated tests |

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

### Authenticated Upload (`upload.authenticated.spec.ts`)
- `UPLOAD-02`: Upload form shows when authenticated
- `UPLOAD-03`: File drop zone is visible
- `UPLOAD-04`: File input accepts audio files
- `UPLOAD-05`: Form input fields present
- `UPLOAD-06`: Publish button present
- `UPLOAD-07`: Supported formats displayed
- `UPLOAD-08`: Release settings section exists

### Authenticated Player (`player.authenticated.spec.ts`)
- `PLAYER-AUTH-01`: Player accessible when authenticated
- `PLAYER-AUTH-02`: Track info card visible
- `PLAYER-AUTH-03`: Player with trackId shows info card
- `PLAYER-AUTH-04`: Volume slider interactive
- `PLAYER-AUTH-05`: Now playing label visible

### Error Handling (`error-handling.spec.ts`)
- `ERR-01`: Upload page shows form when authenticated
- `ERR-02`: Publish button exists
- `ERR-03`: Form has required input fields
- `ERR-04`: File drop zone has instructions

## Authentication

The `auth.setup.ts` file provides fixtures for authenticated testing:

```typescript
import { test, expect } from "./auth.setup";

test("authenticated test", async ({ authenticatedPage }) => {
  await authenticatedPage.goto("/artist/upload");
  // Page is now authenticated - AuthGate is bypassed
});
```

This works by injecting mock credentials into localStorage before page load.

## Configuration

See [`playwright.config.ts`](../playwright.config.ts) for test configuration:

- **Browser**: Chromium
- **Base URL**: `http://localhost:3001` (dev server)
- **Timeout**: 30s per test
- **Retries**: 1 on CI

## Writing New Tests

### Selector Best Practices

1. **Scope to `main`** when testing page content to avoid sidebar matches
2. **Use `getByRole`** for interactive elements (buttons, links, inputs)
3. **Use `.locator(".class")`** for specific component classes
4. **Use `.first()`** when multiple elements may match

### Example

```typescript
import { test, expect } from "@playwright/test";

test.describe("Feature Name", () => {
  test("TEST-ID: Description", async ({ page }) => {
    await page.goto("/route");
    
    const main = page.getByRole("main");
    await expect(main.getByRole("button", { name: "Submit" })).toBeVisible();
  });
});
```

## CI Integration

Tests run automatically on PR via GitHub Actions. The `aa.spec.ts` tests are skipped when the backend is not available.
