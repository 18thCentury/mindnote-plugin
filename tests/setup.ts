/**
 * Test Setup
 * Configure global test environment
 */
import { vi, beforeEach } from 'vitest';

// Mock window for Node environment
if (typeof window === 'undefined') {
    (global as any).window = {
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
    };
}

// Reset mocks before each test
beforeEach(() => {
    vi.clearAllMocks();
});

// Console error spy (for test assertions)
export const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
