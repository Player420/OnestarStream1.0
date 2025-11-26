import { redirect } from 'next/navigation';

export default function RootPage() {
  // Always send people to the app player
  redirect('/app');
}
