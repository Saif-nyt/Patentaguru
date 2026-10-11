'use client';

import dynamic from 'next/dynamic';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';

// The whole app is a client-side SPA (Better Auth, localStorage, hash router),
// so it is rendered only in the browser. The server sends the shell + metadata;
// this keeps hydration mismatches away and preserves the existing app 1:1.
const App = dynamic(() => import('../../src/App'), {
  ssr: false,
  loading: () => <BootSpinner />,
});

function BootSpinner() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-8 text-center space-y-4 bg-white dark:bg-[#0D1117]">
      <div className="w-12 h-12 border-4 border-[#FB6C00] border-t-transparent rounded-full animate-spin" />
      <div className="space-y-1">
        <p className="text-sm font-black text-slate-900 dark:text-white">লোড হচ্ছে...</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">Patente Guru উপাদান প্রস্তুত হচ্ছে</p>
      </div>
    </div>
  );
}

export function AppShell() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
