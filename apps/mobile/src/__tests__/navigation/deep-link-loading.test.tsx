import { describe, it, expect } from '@jest/globals';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

describe('unified web root: reviewer deep-link guard', () => {
  it('cannot reopen the old reviewer route outside the shared web surface', async () => {
    renderRouter('./app', { initialUrl: '/reviewer/my-reviews' });

    await waitFor(() => expect(screen.getByTestId('docjob-web-app')).toBeTruthy());
    expect(screen.queryByTestId('reviewer-my-reviews-screen')).toBeNull();
  });
});
