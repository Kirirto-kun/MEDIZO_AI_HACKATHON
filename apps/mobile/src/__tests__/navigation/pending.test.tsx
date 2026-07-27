import { describe, it, expect } from '@jest/globals';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

describe('unified web root: pending-account entry', () => {
  it('uses the shared web session gate rather than a separate native pending screen', async () => {
    renderRouter('./app', { initialUrl: '/(auth)/pending' });

    await waitFor(() => expect(screen.getByTestId('docjob-web-app')).toBeTruthy());
    expect(screen.queryByTestId('pending-screen')).toBeNull();
  });
});
