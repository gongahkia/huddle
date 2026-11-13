import Link from 'next/link';
import Review from './review';
export default function Page() {
  return <main><h1>Next.js server-rendered integration</h1><Review/><Link href="/other">Next page</Link></main>;
}
