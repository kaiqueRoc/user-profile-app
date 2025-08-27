import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { getApi } from '../utils/api';

export default function Profile() {
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const t = localStorage.getItem('token');
      setToken(t);
      if (!t) router.push('/login');
    }
  }, []);

  const fetchProfile = async (tkn?: string | null) => {
    if (!tkn) return;
    const API = getApi();
    try {
      const res = await fetch(`${API}/api/profiles/me`, { headers: { Authorization: `Bearer ${tkn}` } });
      if (res.ok) {
        const data = await res.json();
  setBio(data.bio || '');
  setAvatarUrl(data.avatarUrl || '');
  try { localStorage.setItem('profile', JSON.stringify(data)); } catch(e) {}
      }
    } catch (err) {
      // ignore
    }
  };

  useEffect(() => { fetchProfile(token); }, [token]);

  const save = async () => {
    if (!token) return;
    const API = getApi();
    try {
      const res = await fetch(`${API}/api/profiles/me`, {
        method: 'PUT',
        headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bio, avatarUrl })
      });
      setMessage(res.ok ? 'Salvo!' : 'Erro ao salvar');
      if (res.ok) {
        // refresh from server to ensure stored value is shown
  await fetchProfile(token);
  try { const updated = await fetch(`${API}/api/profiles/me`, { headers: { Authorization: `Bearer ${token}` } }).then(r=>r.json()).catch(()=>null); if (updated) localStorage.setItem('profile', JSON.stringify(updated)); } catch(e) {}
      }
    } catch (e) {
      setMessage('Erro ao salvar');
    }
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
        {/* preview */}
        {avatarUrl ? (
          <div style={{marginBottom:12}}>
            <img src={avatarUrl} alt="Avatar" style={{width:120,height:120,objectFit:'cover',borderRadius:60}} />
          </div>
        ) : null}

        <div style={{marginBottom:8}}>
          <input type="file" accept="image/*" onChange={e => onFile(e.target.files?.[0] ?? null)} />
        </div>

        <input placeholder="avatar url" value={avatarUrl} onChange={e=>setAvatarUrl(e.target.value)} />
        <textarea placeholder="bio" value={bio} onChange={e=>setBio(e.target.value)} />
        <div className="center"><button className="primary" onClick={save}>Salvar</button></div>
        {message && <p style={{marginTop:12}}>{message}</p>}
      </div>
    </div>
  );
}
