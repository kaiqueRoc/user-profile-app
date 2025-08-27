import { useState, useEffect } from 'react';
import { getApi } from '../utils/api';
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
      try {
        // fetch profile and store locally for header and other components
        const API = getApi();
        const p = await fetch(`${API}/api/profiles/me`, { headers: { Authorization: `Bearer ${data.token}` } }).then(r=>r.json()).catch(()=>null);
        if (p) try { localStorage.setItem('profile', JSON.stringify(p)); } catch(e) {}
      } catch (e) {}
  setEmail(''); setPassword('');
      router.push('/');
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
