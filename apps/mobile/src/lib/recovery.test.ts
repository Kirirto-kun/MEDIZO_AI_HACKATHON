import AsyncStorage from '@react-native-async-storage/async-storage';
import { PERSIST_KEY } from './query-persist';
import { clearLegacyMobileState } from './recovery';
import { tokenStore } from './token-store';

jest.mock('./token-store', () => ({
  __esModule: true,
  tokenStore: {
    clear: jest.fn(async () => undefined),
  },
}));

const mockedTokenClear = tokenStore.clear as jest.MockedFunction<
  typeof tokenStore.clear
>;

describe('clearLegacyMobileState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears retired native tokens and the persisted per-user query cache', async () => {
    await clearLegacyMobileState();

    expect(mockedTokenClear).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(PERSIST_KEY);
  });

  it('still clears the query cache when legacy token cleanup fails', async () => {
    mockedTokenClear.mockRejectedValueOnce(new Error('SecureStore unavailable'));

    await expect(clearLegacyMobileState()).resolves.toBeUndefined();
    expect(mockedTokenClear).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(PERSIST_KEY);
  });

  it('absorbs a synchronous native-storage bridge failure', async () => {
    (AsyncStorage.removeItem as jest.MockedFunction<typeof AsyncStorage.removeItem>)
      .mockImplementationOnce(() => {
        throw new Error('native storage bridge unavailable');
      });

    await expect(clearLegacyMobileState()).resolves.toBeUndefined();
    expect(mockedTokenClear).toHaveBeenCalledTimes(1);
  });
});
