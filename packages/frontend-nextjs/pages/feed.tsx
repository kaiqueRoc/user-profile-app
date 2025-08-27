import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import usePosts from '../hooks/usePosts';

type Post = { id: string; userId: string; content: string; createdAt: string; likes: number };

export default function Feed() {
  const { posts, load, create, like, comment, loading } = usePosts();
  const [content, setContent] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<any>>([]);
  const [following, setFollowing] = useState<string[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const f = localStorage.getItem('following');
  setFollowing(f ? JSON.parse(f) : []);
    }
  }, []);

  const search = async (e?: unknown) => {
    // prevent form submit default if called from form
    try { (e as any)?.preventDefault?.(); } catch (err) {}
    const API = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL as string) : '';
    if (!query || query.trim().length < 2) { setResults([]); return; }
    try {
      const res = await fetch(`${API}/api/users?query=${encodeURIComponent(query)}`);
      if (res.ok) setResults(await res.json());
    } catch (e) { setResults([]); }
  };

  const toggleFollow = (id: string) => {
    (async () => {
      const API = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL as string) : '';
      const tok = localStorage.getItem('token');
      if (!tok) return alert('Faça login');
      if (following.includes(id)) {
        await fetch(`${API}/api/profiles/${id}/unfollow`, { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ followerId: me?.userId }) });
        const next = following.filter(x=>x!==id); setFollowing(next); localStorage.setItem('following', JSON.stringify(next));
      } else {
        await fetch(`${API}/api/profiles/${id}/follow`, { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ followerId: me?.userId }) });
        const next = [...following, id]; setFollowing(next); localStorage.setItem('following', JSON.stringify(next));
      }
    })();
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const t = localStorage.getItem('token');
      setToken(t);
      if (!t) { router.push('/login'); return; }
    }
    load();
    (async () => {
      // fetch current profile
      try {
        const API = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL as string) : '';
        const res = await fetch(`${API}/api/profiles/me`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
        if (res.ok) { const data = await res.json(); setMe(data); }
        // load initial following from server
        if (res.ok) {
          try {
            const f = await fetch(`${API}/api/profiles/${(await res.json()).userId}/following`);
            if (f.ok) {
              const list = await f.json();
              const ids = Array.isArray(list) ? list.map((x:any) => x.id) : [];
              setFollowing(ids); localStorage.setItem('following', JSON.stringify(ids));
            }
          } catch (_) {}
        }
      } catch (e) {}
    })();
  }, []);

  const toggleNotifications = async () => {
    if (!me) return;
    setShowNotifications(s => !s);
    if (!showNotifications) {
      try {
        const API = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL as string) : '';
        const res = await fetch(`${API}/api/notifications/${me.userId}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
        if (res.ok) setNotifications(await res.json());
      } catch (e) {}
    }
  };

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

  const doDelete = async (postId: string) => {
    if (!token) return alert('Faça login');
    if (!confirm('Remover este post?')) return;
    const API = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL as string) : '';
    await fetch(`${API}/api/posts/${postId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    // refresh
    await load();
  };

  const canComment = async (ownerId: string) => {
    if (!token) return false;
    const API = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL as string) : '';
    try {
      const res = await fetch(`${API}/api/profiles/${ownerId}/is-following`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return false;
      const d = await res.json(); return !!d.isFollowing;
    } catch (e) { return false; }
  };

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h1>Feed</h1>
        <div>
          <button onClick={toggleNotifications} style={{position:'relative'}} aria-label="Notifications">🔔</button>
        </div>
      </div>
      {showNotifications && (
        <div style={{position:'absolute',right:20,top:60,background:'#222',padding:12,borderRadius:6,width:300}}>
          <h4>Notificações</h4>
          {notifications.length === 0 && <div className="muted">Sem notificações</div>}
          {notifications.map(n => (
            <div key={n.id} style={{padding:'8px 0',borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
              <div style={{fontWeight:700}}>{String(n.type)}</div>
              <div style={{fontSize:12}}>{JSON.stringify(n.payload)}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{marginBottom: 16}}>
        <textarea placeholder="No que você está pensando?" value={content} onChange={e=>setContent(e.target.value)} />
  <div className="center" style={{marginTop:8}}><button className="primary" onClick={createPost} disabled={loading}>{loading ? 'Postando...' : 'Postar'}</button></div>
      </div>

      <div style={{marginBottom: 16}} className="card">
        <h3>Buscar pessoas</h3>
        <form onSubmit={search} style={{display:'flex',gap:8}}>
          <input placeholder="nome ou email (min 2 chars)" value={query} onChange={e=>setQuery(e.target.value)} />
          <button type="submit" className="primary">Buscar</button>
        </form>
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
            {me && me.userId === p.userId && (
              <button onClick={() => doDelete(p.id)} style={{background:'#ff6b6b'}}>Deletar</button>
            )}
          </div>
          {/* comment box only if following */}
          <div style={{marginTop:8}}>
            <CommentBox ownerId={p.userId} postId={p.id} canCommentFn={canComment} token={token} onCommented={() => load()} />
          </div>
        </div>
      ))}
    </div>
  );
}

function CommentBox({ ownerId, postId, canCommentFn, token, onCommented }: any) {
  const [text, setText] = useState('');
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => { (async () => setAllowed(await canCommentFn(ownerId)))(); }, [ownerId]);
  const submit = async () => {
    if (!token) return alert('Login necessário');
    if (!allowed) return alert('Somente amigos podem comentar');
    await fetch(`${(process.env.NEXT_PUBLIC_API_URL as string)}/api/posts/${postId}/comments`, { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ content: text }) });
    setText(''); onCommented?.();
  };
  if (allowed === null) return null;
  if (!allowed) return <div className="muted">Só amigos podem comentar</div>;
  return (
    <div style={{display:'flex',gap:8}}>
      <input value={text} onChange={e=>setText(e.target.value)} placeholder="Comentar..." />
      <button onClick={submit} className="primary">Comentar</button>
    </div>
  );
}
