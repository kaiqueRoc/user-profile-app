import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
const getApi = () => (typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL as string) : '');

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (e: any) => {
    e.preventDefault();
    setMessage(null);
  setLoading(true);
  // basic validation
  if (!displayName || displayName.trim().length < 2) { setMessage('Informe um nome (min 2 caracteres)'); setLoading(false); return; }
  if (!email || !email.includes('@')) { setMessage('Email inválido'); setLoading(false); return; }
  if (!password || password.length < 6) { setMessage('Senha deve ter ao menos 6 caracteres'); setLoading(false); return; }
  const API = getApi();
  const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({email, password, displayName})
    });
    if (!res.ok) {
      let text = 'Erro ao registrar';
      try {
        const body = await res.json();
        // backend returns { error: '...' } or a string
        text = body.error || body.message || String(body);
      } catch (_) {
        // ignore parse error
      }
      setMessage(text);
      setLoading(false);
      return;
    }
    setMessage('Registrado! Redirecionando para o login...');
    setTimeout(() => router.push('/login'), 900);
  };

  // redirect logged-in users away from register
  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('token')) {
      window.location.href = '/feed';
    }
  }, []);

  return (
    <main style={{padding: 24}}>
      <h1>Register</h1>
      <form onSubmit={submit}>
        <input placeholder="displayName" value={displayName} onChange={e=>setDisplayName(e.target.value)} />
        <input placeholder="email" value={email} onChange={e=>setEmail(e.target.value)} />
        <input placeholder="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
        <div className="center"><button className="primary" type="submit">Criar conta</button></div>
      </form>
      {message && <p style={{marginTop:12}}>{message}</p>}
    </main>
  );
}
