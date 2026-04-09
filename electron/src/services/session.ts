import type { Session } from '../../../src/shared/types';

let activeSession: Session | null = null;

export const setSession = (session: Session | null) => {
  activeSession = session;
};

export const getSession = () => activeSession;

export const requireSession = () => {
  if (!activeSession) {
    throw new Error('Not authenticated. Please log in.');
  }
  return activeSession;
};

export const requireAdmin = () => {
  const session = requireSession();
  if (session.role !== 'Admin') {
    throw new Error('Only admin users can perform this action.');
  }
  return session;
};
