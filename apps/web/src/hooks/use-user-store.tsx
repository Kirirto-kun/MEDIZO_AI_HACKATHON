'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { SerializedUser as CoreSerializedUser } from '@docjob/core';
import { trpc } from '@/lib/trpc/react';

// Legacy-compatible User type (role is lowercase for existing callers)
export type UserRole = 'admin' | 'doctor' | 'reviewer';

export type User = {
  id: string;
  name: string;
  email: string;
  specialty: string;
  role: UserRole;
  password?: string;
  fullName?: string | null;
  region?: string | null;
  age?: number | null;
  phoneNumber?: string | null;
  workplace?: string | null;
  academicDegree?: string | null;
  profilePhotoUrl?: string | null;
  consentAcceptedAt?: string | null;
};

function serializedToUser(s: CoreSerializedUser): User {
  return {
    id: s.id,
    name: s.name,
    email: s.email,
    specialty: s.specialty ?? '',
    role: s.role.toLowerCase() as UserRole,
    fullName: s.fullName,
    region: s.region,
    age: s.age,
    phoneNumber: s.phoneNumber,
    workplace: s.workplace,
    academicDegree: s.academicDegree,
    profilePhotoUrl: s.profilePhotoUrl,
    consentAcceptedAt: s.consentAcceptedAt,
  };
}

export type LoginResult = {
  ok: boolean;
  error?: string;
  reason?: 'pending' | 'unsupported_role' | 'invalid' | 'network';
};

type UserStore = {
  currentUser: User | null;
  updateUser: (user: User) => Promise<void>;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  allUsers: User[];
  addUser: (user: Omit<User, 'role'> & { role: Exclude<UserRole, 'admin'>; password?: string }) => Promise<void>;
  refreshUsers: () => Promise<void>;
  isInitialized: boolean;
};

const UserContext = createContext<UserStore | null>(null);

/**
 * `getUsers`/`updateUser`/`registerUser` Server Actions retired (SP-2 Task
 * 5) -> `trpc.users.{list,updateProfile,register}`. Public API (`currentUser`,
 * `allUsers`, `addUser`, `updateUser`, `refreshUsers`, `login`, `logout`,
 * `isInitialized`) is unchanged. `login`/`logout` stay on the dedicated
 * `POST /api/auth/login|logout` cookie routes (SP-1c) — the `users` tRPC
 * router deliberately has no login/logout procedure (see users.ts).
 */
export function UserProvider({ children }: { children: React.ReactNode }) {
  // `meUser` mirrors what NextAuth's `session.user` used to carry: just the
  // identity/role, refreshed from `GET /api/auth/me` on mount (and on
  // login/logout). `/api/auth/me` already returns the full current-user
  // profile (`SerializedUser`), so `currentUser` is derived directly from
  // `meUser` — it no longer needs `allUsers` (core's `listUsers` now
  // requires an admin actor, a security-hardening fix, so a non-admin
  // fetching it would 403). A self `updateUser` call shows up in
  // `currentUser` immediately by re-fetching `/api/auth/me` (`loadMe()`)
  // after the update, instead of via `refreshUsers`.
  const [meUser, setMeUser] = useState<User | null>(null);
  const [isMeLoaded, setIsMeLoaded] = useState(false);
  const utils = trpc.useUtils();

  const isAdmin = isMeLoaded && meUser?.role === 'admin';

  // Admin-only: `trpc.users.list` -> core's `listUsers` now asserts admin.
  // For non-admins this would 403 (TRPCError), so the query is simply
  // disabled — `allUsers` just stays `[]` for them. If a fetch does fail for
  // an admin (network blip, etc.) we still fall back to `[]` rather than
  // surfacing an error, same as before.
  const usersQuery = trpc.users.list.useQuery(undefined, { enabled: isAdmin });

  const allUsers = useMemo(
    () => (isAdmin ? (usersQuery.data ?? []).map(serializedToUser) : []),
    [isAdmin, usersQuery.data],
  );
  const isUsersLoaded = !isMeLoaded
    ? false
    : !isAdmin || usersQuery.isFetched || usersQuery.isError;

  const refreshUsers = useCallback(async () => {
    if (!isAdmin) return;
    await usersQuery.refetch();
  }, [isAdmin, usersQuery.refetch]);

  const loadMe = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const data = (await res.json()) as { user: CoreSerializedUser | null };
      setMeUser(data.user ? serializedToUser(data.user) : null);
    } catch {
      setMeUser(null);
    } finally {
      setIsMeLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const currentUser = meUser;

  const createUserMutation = trpc.users.create.useMutation();
  const addUser = useCallback(
    async (user: Omit<User, 'role'> & { role: Exclude<UserRole, 'admin'>; password?: string }) => {
      await createUserMutation.mutateAsync({
        email: user.email,
        password: user.password ?? 'changeme123',
        name: user.name,
        fullName: user.fullName ?? undefined,
        region: user.region ?? undefined,
        age: user.age ?? undefined,
        specialty: user.specialty,
        phoneNumber: user.phoneNumber ?? undefined,
        workplace: user.workplace ?? undefined,
        academicDegree: user.academicDegree ?? undefined,
        role: user.role === 'reviewer' ? 'REVIEWER' : 'DOCTOR',
      });
      await utils.users.list.invalidate();
    },
    [createUserMutation, utils],
  );

  const updateProfileMutation = trpc.users.updateProfile.useMutation();
  const updateUser = useCallback(
    async (user: User) => {
      await updateProfileMutation.mutateAsync({
        id: user.id,
        name: user.name,
        fullName: user.fullName ?? null,
        region: user.region ?? null,
        age: user.age ?? null,
        specialty: user.specialty || null,
        phoneNumber: user.phoneNumber ?? null,
        profilePhotoUrl: user.profilePhotoUrl ?? null,
      });
      // `updateUser` in this store is only ever called for a self-update
      // (see profile/page.tsx, its one caller) — re-fetch `/api/auth/me` so
      // `currentUser` (derived directly from `meUser`, not `allUsers`)
      // reflects the change immediately, without a re-login.
      await loadMe();
      await utils.users.list.invalidate();
    },
    [updateProfileMutation, loadMe, utils],
  );

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        // `POST /api/auth/login`'s success payload is only `{ id, role,
        // approvedAt }` (see `packages/auth/src/login.service.ts`'s
        // `LoginResult` — `@docjob/auth` can't depend on `@docjob/core`'s
        // richer `SerializedUser`, by the one-way package boundary). Re-fetch
        // `/api/auth/me` for the authoritative full profile rather than
        // fabricating one from that minimal shape.
        await loadMe();
        return { ok: true };
      }

      const body = (await res.json().catch(() => ({}))) as {
        status?: 'pending' | 'unsupported_role' | 'invalid' | 'locked';
        retryAfterSeconds?: number;
      };

      if (body.status === 'pending') {
        return { ok: false, error: 'PendingApproval', reason: 'pending' };
      }
      if (body.status === 'unsupported_role') {
        return { ok: false, error: 'UnsupportedRole', reason: 'unsupported_role' };
      }
      if (body.status === 'locked') {
        const wait = body.retryAfterSeconds ?? 60;
        return {
          ok: false,
          error: `Слишком много попыток входа. Повторите через ${wait} сек.`,
          reason: 'invalid',
        };
      }
      return { ok: false, error: 'Неверные учётные данные.', reason: 'invalid' };
    } catch {
      return { ok: false, error: 'Ошибка сети.', reason: 'network' };
    }
  }, [loadMe]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    setMeUser(null);
  }, []);

  const isInitialized = isMeLoaded && (!meUser || isUsersLoaded);

  return (
    <UserContext.Provider
      value={{ currentUser, updateUser, login, logout, allUsers, addUser, refreshUsers, isInitialized }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUserStore() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUserStore must be used within a UserProvider');
  }
  return context;
}
