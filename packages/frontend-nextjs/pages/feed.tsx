import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import usePosts from '../hooks/usePosts';

type Post = { id: string; userId: string; content: string; createdAt: string; likes: number };

export default function Feed() {
  const { posts, load, create, like, comment, loading } = usePosts();
  const [content, setContent] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<any>>([]);
  const [following, setFollowing] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const f = localStorage.getItem('following');
      setFollowing(f ? JSON.parse(f) : []);
    }
  }, []);

  const search = async () => {
    const API = typeof window !== 'undefined' ? process.env.NEXT_PUBLIC_API_URL : '';
    if (!query || query.trim().length < 2) { setResults([]); return; }
    try {
      const res = await fetch(`${API}/api/users?query=${encodeURIComponent(query)}`);
      if (res.ok) setResults(await res.json());
    } catch (e) { setResults([]); }
  };

  const toggleFollow = (id: string) => {
    let next = following.includes(id) ? following.filter(x=>x!==id) : [...following, id];
    setFollowing(next);
    localStorage.setItem('following', JSON.stringify(next));
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const t = localStorage.getItem('token');
      setToken(t);
      if (!t) { router.push('/login'); return; }
    }
    load();
  }, []);

  const createPost = async () => { if (!token) { alert('Faça login'); return; } await create(content, token || undefined); setContent(''); };

  const share = async (p: Post) => {
    const text = `${p.content}\n\nCompartilhado via User Profile App`;
    if (navigator && (navigator as any).share) {
      try { await (navigator as any).share({ text }); return; } catch (e) { /* ignore */ }
    }
    // fallback: copy to clipboard
    try { await navigator.clipboard.writeText(text); alert('Conteúdo copiado para a área de transferência'); } catch (e) { alert('Não foi possível compartilhar'); }
  };

  const doLike = async (id: string) => { if (!token) { alert('Faça login'); return; } await like(id, token || undefined); };

  return (
    <div>
      <h1>Feed</h1>
      <div style={{marginBottom: 16}}>
        <textarea placeholder="No que você está pensando?" value={content} onChange={e=>setContent(e.target.value)} />
  <div className="center" style={{marginTop:8}}><button className="primary" onClick={createPost} disabled={loading}>{loading ? 'Postando...' : 'Postar'}</button></div>
      </div>

      <div style={{marginBottom: 16}} className="card">
        <h3>Buscar pessoas</h3>
        <div style={{display:'flex',gap:8}}>
          <input placeholder="nome ou email (min 2 chars)" value={query} onChange={e=>setQuery(e.target.value)} />
          <button className="primary" onClick={search}>Buscar</button>
        </div>
        {results.length > 0 && (
          <div style={{marginTop:12}}>
            {results.map((r:any) => (
              <div key={r.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0'}}>
                <div>
                  <div style={{fontWeight:700}}>{r.displayName}</div>
                  <div className="muted" style={{fontSize:12}}>{r.email}</div>
                </div>
                <div>
                  <button className="primary" onClick={() => toggleFollow(r.id)}>{following.includes(r.id) ? 'Seguindo' : 'Seguir'}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

  {(posts || []).map(p => (
        <div key={p.id} className="card" style={{marginBottom:12}}>
          <div style={{fontSize:12, opacity:.8}}>{new Date(p.createdAt).toLocaleString()}</div>
          <div style={{marginTop:8}}>{p.content}</div>
          <div style={{marginTop:10, display:'flex', gap:8}}>
            <button onClick={() => doLike(p.id)} className="primary">Curtir ({p.likes})</button>
            <button onClick={() => share(p)} className="primary" style={{background:'transparent',border:'1px solid rgba(255,255,255,0.06)'}}>Compartilhar</button>
          </div>
        </div>
      ))}
    </div>
  );
}
