import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'Starfarer — WebGPU Space Game',
  description:
    'A WebGPU space game built with Three.js TSL and Next.js — fly a procedural ship through an infinite, procedurally generated starfield rendered to a background FBO, with bloom and dithering.',
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
