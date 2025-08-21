import { useState } from 'react';
const API = process.env.NEXT_PUBLIC_API_URL as string;

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: any) => {
    e.preventDefault();
    setMessage(null);
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({email, password, displayName})
    });
    if (!res.ok) { setMessage('Erro ao registrar'); return; }
    setMessage('Registrado! Faça login.');
  };

  return (
    <main style={{padding: 24}}>
      <h1>Register</h1>
      <form onSubmit={submit}>
        <input placeholder="displayName" value={displayName} onChange={e=>setDisplayName(e.target.value)} /><br/>
        <input placeholder="email" value={email} onChange={e=>setEmail(e.target.value)} /><br/>
        <input placeholder="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} /><br/>
        <button type="submit">Criar conta</button>
      </form>
      {message && <p>{message}</p>}
    </main>
  );
}
