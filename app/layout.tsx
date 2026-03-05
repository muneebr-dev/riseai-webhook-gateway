import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Webhook Gateway',
  description: 'Development webhook fanout gateway',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
