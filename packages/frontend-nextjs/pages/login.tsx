import { useState, useEffect } from 'react';
// read API at runtime to avoid SSR/runtime mismatch
const getApi = () => (typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL as string) : '');
import { useRouter } from 'next/router';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  const router = useRouter();
  // redirect logged-in users away from login
  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('token')) router.push('/feed');
  }, []);
  const submit = async (e: any) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
  // basic validation
  if (!email || !email.includes('@')) { setErr('Email inválido'); setLoading(false); return; }
  if (!password || password.length < 6) { setErr('Senha deve ter ao menos 6 caracteres'); setLoading(false); return; }
  const API = getApi();
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({email, password})
      });
      if (!res.ok) { setErr('Credenciais inválidas'); setLoading(false); return; }
      const data = await res.json();
      localStorage.setItem('token', data.token);
  setEmail(''); setPassword('');
      router.push('/feed');
    } catch (err) {
      setErr('Erro ao conectar');
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>Login</h1>
      <form onSubmit={submit}>
        <input placeholder="email" value={email} onChange={e=>setEmail(e.target.value)} />
        <input placeholder="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
        <div className="center"><button className="primary" type="submit" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</button></div>
      </form>
      {err && <p style={{color:'#ff7b7b'}}>{String(err)}</p>}
    </div>
  );
}
