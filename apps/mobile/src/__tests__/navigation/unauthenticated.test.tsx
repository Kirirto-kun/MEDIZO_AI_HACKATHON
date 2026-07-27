import { describe, it, expect } from '@jest/globals';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

describe('unified web root: unauthenticated entry', () => {
  it('delegates authentication to the same web login and registration pages', async () => {
    renderRouter('./app', { initialUrl: '/' });

    await waitFor(() => expect(screen.getByTestId('docjob-web-app')).toBeTruthy());
    expect(screen.queryByTestId('login-screen')).toBeNull();
    expect(screen.queryByTestId('login-email-input')).toBeNull();
  });
});
