import { describe, it, expect } from '@jest/globals';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

describe('unified web root: authenticated entry', () => {
  it('mounts the shared web product instead of the divergent native tab bar', async () => {
    renderRouter('./app', { initialUrl: '/' });

    await waitFor(() => expect(screen.getByTestId('docjob-web-app')).toBeTruthy());
    expect(screen.queryByTestId('search-screen')).toBeNull();
    expect(screen.queryByTestId('login-screen')).toBeNull();
  });
});
