import { Component, type ErrorInfo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { clearLegacyMobileState } from '../lib/recovery';
import { colors } from '../theme/colors';

type AppErrorBoundaryProps = {
  children: ReactNode;
  onRecover(): void;
};

type AppErrorBoundaryState = {
  error: Error | null;
  recovering: boolean;
};

/**
 * Last-resort boundary for failures in the native React tree itself.
 *
 * Web page failures are handled inside `WebAppShell`; this boundary remains
 * outside it so even a bad WebView prop, native bridge exception surfaced to
 * React, or future root-provider regression cannot leave the installed app on
 * React Native's unrecoverable error screen. Recovery clears retired native
 * credentials/cache and asks the root to mount a fresh WebView at login.
 */
export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    error: null,
    recovering: false,
  };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // This is deliberately a local recovery boundary. A remote error reporter
    // can be connected here later without changing the user-facing escape path.
  }

  private recover = () => {
    if (this.state.recovering) return;

    this.setState({ recovering: true });
    void clearLegacyMobileState();
    this.props.onRecover();
  };

  render() {
    const { error, recovering } = this.state;
    if (!error) return this.props.children;

    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            testID="native-crash-recovery"
          >
            <View style={styles.card}>
              <Text style={styles.title}>DocJob нужно восстановить</Text>
              <Text style={styles.description}>
                Экран приложения завершился с ошибкой. Нажмите кнопку ниже —
                локальная сессия будет очищена, и откроется безопасный вход.
              </Text>
              <Text style={styles.details} numberOfLines={3}>
                {error.message || 'Неизвестная ошибка приложения'}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={recovering}
                onPress={this.recover}
                style={({ pressed }) => [
                  styles.button,
                  (pressed || recovering) && styles.buttonPressed,
                ]}
                testID="native-crash-login-reset"
              >
                {recovering ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Text style={styles.buttonText}>Очистить сессию и войти</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    marginTop: 10,
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  details: {
    marginTop: 10,
    color: colors.textSubtle,
    fontSize: 12,
    textAlign: 'center',
  },
  button: {
    width: '100%',
    minHeight: 48,
    marginTop: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: colors.onPrimary,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
});
