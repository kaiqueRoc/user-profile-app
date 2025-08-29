import { useEffect, useState } from 'react';
import Feed from './feed';

export default function Home() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setAuthed(!!localStorage.getItem('token'));
    }
  }, []);
  if (authed === null) return null;
  if (!authed) return (
    <div>
      <h1>Bem-vindo</h1>
      <p>Faça login ou crie uma conta para acessar o feed.</p>
    </div>
  );
  return <Feed />;
}
