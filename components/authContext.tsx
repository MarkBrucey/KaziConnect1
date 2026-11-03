'use client';

// The shape of "who is logged in", kept apart from the provider so the login form and the provider
// can both use it without importing each other.

import { createContext, useContext } from 'react';
import type { AuthResponse, User } from '@/lib/contract';
import type { AuthMode } from './AuthForm';

export interface AuthValue {
  user: User | null;
  ready: boolean; // false until we know whether the saved token still works
  openAuth: (mode?: AuthMode, message?: string, kind?: 'error' | 'success') => void;
  signedIn: (auth: AuthResponse) => void;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
