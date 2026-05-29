import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Allyvate Brain',
  description: 'Phase 1 Brain tester — ask a question, see the top artifact + reasoning trace.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
