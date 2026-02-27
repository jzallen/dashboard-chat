import '@testing-library/jest-dom';

import { vi } from 'vitest';

// Mock scrollIntoView since happy-dom doesn't support it
Element.prototype.scrollIntoView = vi.fn();

// Mock import.meta.env
vi.stubGlobal('import.meta', {
  env: {
    VITE_API_URL: 'http://localhost:8787',
  },
});
