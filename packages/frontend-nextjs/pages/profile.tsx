import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
const getApi = () => (typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL as string) : '');

export default function Profile() {
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [message, setMessage] = useState(null);

  const [token, setToken] = useState(null);
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const t = localStorage.getItem('token');
      setToken(t);
      if (!t) router.push('/login');
    }
  }, []);

  useEffect(() => {
    (async () => {
      if (!token) return;
      const API = getApi();
      try {
        const res = await fetch(`${API}/api/profiles/me`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data = await res.json();
          setBio(data.bio || '');
          setAvatarUrl(data.avatarUrl || '');
        }
      } catch (err) {
        // ignore
      }
    })();
  }, [token]);

  const save = async () => {
  if (!token) return;
  const API = getApi();
  const res = await fetch(`${API}/api/profiles/me`, {
      method: 'PUT',
      headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bio, avatarUrl })
    });
    setMessage(res.ok ? 'Salvo!' : 'Erro ao salvar');
  };

  const onFile = (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { setAvatarUrl(String(reader.result || '')); };
    reader.readAsDataURL(f);
  };

  return (
    <div>
      <h1>Meu Perfil</h1>
      <div>
        <input placeholder="avatar url" value={avatarUrl} onChange={e=>setAvatarUrl(e.target.value)} />
        <textarea placeholder="bio" value={bio} onChange={e=>setBio(e.target.value)} />
        <div className="center"><button className="primary" onClick={save}>Salvar</button></div>
        {message && <p style={{marginTop:12}}>{message}</p>}
      </div>
    </div>
  );
}
