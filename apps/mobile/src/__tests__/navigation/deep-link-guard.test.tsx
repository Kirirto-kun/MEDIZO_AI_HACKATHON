import { describe, it, expect } from '@jest/globals';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

describe('unified web root: legacy deep-link guard', () => {
  it('cannot reopen a divergent native screen through a legacy tab deep link', async () => {
    renderRouter('./app', { initialUrl: '/(tabs)/search' });

    await waitFor(() => expect(screen.getByTestId('docjob-web-app')).toBeTruthy());
    expect(screen.queryByTestId('search-screen')).toBeNull();
    expect(screen.queryByTestId('login-screen')).toBeNull();
  });
});
