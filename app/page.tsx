import type { JSX } from 'react';
import { Galaxy } from '@/components/galaxy/galaxy';
import { OpenInV0Button } from '@/components/open-in-v0-button';

export default function Page(): JSX.Element {
  return (
    <div className="relative text-white bg-black min-h-lvh">
      <Galaxy />
      <div className="fixed left-4 top-4 z-10">
        <OpenInV0Button url="https://github.com/vercel-labs/nextjs-nights-shader" />
      </div>
    </div>
  );
}
