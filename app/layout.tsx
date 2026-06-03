import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'Galaxy Shader',
  description:
    'A WebGPU galaxy shader built with Three.js TSL and Next.js — instanced billboard stars, a hover fluid, bloom, dithering, and a logo-mask reveal.',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-black text-white font-sans">{children}</body>
    </html>
  );
}
