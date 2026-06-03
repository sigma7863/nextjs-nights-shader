import type { JSX } from 'react';
import { Galaxy } from '@/components/galaxy/galaxy';

export default function Page(): JSX.Element {
  return (
    <div className="relative text-white bg-black min-h-lvh">
      <Galaxy />
    </div>
  );
}
