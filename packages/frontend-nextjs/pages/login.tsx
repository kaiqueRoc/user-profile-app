import { useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL as string;

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: any) => {
    e.preventDefault();
    setErr(null);
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({email, password})
    });
    if (!res.ok) { setErr('Invalid credentials'); return; }
    const data = await res.json();
    localStorage.setItem('token', data.token);
    window.location.href = '/feed';
  };

  return (
    <main style={{padding: 24}}>
      <h1>Login</h1>
      <form onSubmit={submit}>
        <input placeholder="email" value={email} onChange={e=>setEmail(e.target.value)} /><br/>
        <input placeholder="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} /><br/>
        <button type="submit">Entrar</button>
      </form>
      {err && <p style={{color:'red'}}>{err}</p>}
    </main>
  );
}
