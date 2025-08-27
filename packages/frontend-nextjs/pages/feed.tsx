import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import usePosts from '../hooks/usePosts';
import { getApi } from '../utils/api';

type Post = { id: string; userId: string; content: string; createdAt: string; likes: number };

export default function Feed() {
  const profile = (typeof window !== 'undefined') ? ((() => { try { return JSON.parse(localStorage.getItem('profile')||'null'); } catch(e){ return null; } })()) : null;
  const feedFor = profile?.userId || '';
  const { posts, load, create, like, comment, loading } = usePosts(feedFor);
  const [content, setContent] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
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
  const API = getApi();
    if (!query || query.trim().length < 2) { setResults([]); return; }
    try {
      const res = await fetch(`${API}/api/users?query=${encodeURIComponent(query)}`);
      if (res.ok) setResults(await res.json());
    } catch (e) { setResults([]); }
  };

  const toggleFollow = (id: string) => {
    (async () => {
  const API = getApi();
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
  const API = getApi();
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
  const API = getApi();
        const res = await fetch(`${API}/api/notifications/${me.userId}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
        if (res.ok) {
            const list = await res.json();
            setNotifications(list);
            const unread = Array.isArray(list) ? list.filter((n:any) => !n.read).length : 0;
            setUnreadCount(unread);
            try { localStorage.setItem('notifications_unread', String(unread)); } catch (e) {}
          }
      } catch (e) {}
    }
  };

  const formatNotification = (n: any) => {
    try {
      const p = n.payload || {};
      const from = p.from || p.displayName || 'Alguém';
      if (n.type === 'like') return `${from} curtiu seu post`;
      if (n.type === 'comment') return `${from} comentou seu post`;
      if (n.type === 'follow') return `${from} começou a seguir você`;
      return typeof p === 'object' ? JSON.stringify(p) : String(p);
    } catch (e) { return '' }
  };

  const markAllAsRead = async () => {
    if (!me) return;
  const API = getApi();
    const tok = localStorage.getItem('token');
      try {
      const toMark = notifications.filter(n => !n.read).map(n => n.id);
      await Promise.all(toMark.map(id => fetch(`${API}/api/notifications/${id}/read`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` } })));
      // update locally
      const updated = notifications.map(n => ({ ...n, read: true }));
      setNotifications(updated);
      setUnreadCount(0);
      try { localStorage.setItem('notifications_unread', '0'); } catch (e) {}
    } catch (e) { /* ignore */ }
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
  const API = getApi();
    await fetch(`${API}/api/posts/${postId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    // refresh
    await load();
  };

  const canComment = async (ownerId: string) => {
    if (!token) return false;
  const API = getApi();
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
          <button onClick={toggleNotifications} style={{position:'relative'}} aria-label="Notifications">🔔
            {unreadCount > 0 && (
              <span style={{position:'absolute', top:-6, right:-6, background:'#ff4d4d', color:'#fff', borderRadius:12, padding:'2px 6px', fontSize:12}} aria-hidden>{unreadCount}</span>
            )}
          </button>
        </div>
      </div>
      {showNotifications && (
        <div style={{position:'absolute',right:20,top:60,background:'#222',padding:12,borderRadius:6,width:320}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <h4 style={{margin:0}}>Notificações</h4>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              {unreadCount > 0 && <div style={{fontSize:12,color:'#fff',opacity:.8}}>{unreadCount} não-lida(s)</div>}
              <button onClick={markAllAsRead} className="primary" style={{fontSize:12,padding:'6px 8px'}}>Marcar tudo como lido</button>
            </div>
          </div>
          <div style={{marginTop:8}}>
            {notifications.length === 0 && <div className="muted">Sem notificações</div>}
            {notifications.map(n => (
              <div key={n.id} style={{padding:'8px 0',borderBottom:'1px solid rgba(255,255,255,0.03)', opacity: n.read ? .6 : 1}}>
                <div style={{fontWeight:700}}>{String(n.type)}</div>
                <div style={{fontSize:12}}>{formatNotification(n)}</div>
                <div style={{marginTop:6,display:'flex',gap:8}}>
                  {!n.read && <button style={{fontSize:12}} onClick={async () => { const API_LOCAL = getApi(); await fetch(`${API_LOCAL}/api/notifications/${n.id}/read`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }); setNotifications(notifications.map(x=> x.id===n.id ? { ...x, read: true } : x)); setUnreadCount(c => Math.max(0, c-1)); try { localStorage.setItem('notifications_unread', String(Math.max(0, (parseInt(localStorage.getItem('notifications_unread')||'0',10)||0)-1))); } catch(e){} }}>Marcar como lido</button>}
                </div>
              </div>
            ))}
          </div>
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
  await fetch(`${getApi()}/api/posts/${postId}/comments`, { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ content: text }) });
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
