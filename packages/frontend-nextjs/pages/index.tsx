import Link from 'next/link';

export default function Home() {
  return (
    <main style={{padding: 24, fontFamily: 'system-ui'}}>
      <h1>User Profile App</h1>
      <p>
        <Link href="/login">Login</Link> &middot{' '}
        <Link href="/register">Register</Link> &middot{' '}
        <Link href="/feed">Feed</Link> &middot{' '}
        <Link href="/profile">Meu Perfil</Link>
      </p>
    </main>
  );
}
