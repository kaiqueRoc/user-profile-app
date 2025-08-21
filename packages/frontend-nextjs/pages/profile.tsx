import { useEffect, useState } from 'react';
const API = process.env.NEXT_PUBLIC_API_URL as string;

export default function Profile() {
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  useEffect(() => {
    (async () => {
      if (!token) return;
      const res = await fetch(`${API}/api/profiles/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setBio(data.bio || '');
        setAvatarUrl(data.avatarUrl || '');
      }
    })();
  }, [token]);

  const save = async () => {
    if (!token) return;
    const res = await fetch(`${API}/api/profiles/me`, {
      method: 'PUT',
      headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bio, avatarUrl })
    });
    setMessage(res.ok ? 'Salvo!' : 'Erro ao salvar');
  };

  return (
    <main style={{padding: 24}}>
      <h1>Meu Perfil</h1>
      <div>
        <input placeholder="avatar url" value={avatarUrl} onChange={e=>setAvatarUrl(e.target.value)} /><br/>
        <textarea placeholder="bio" value={bio} onChange={e=>setBio(e.target.value)} /><br/>
        <button onClick={save}>Salvar</button>
        {message && <p>{message}</p>}
      </div>
    </main>
  );
}
