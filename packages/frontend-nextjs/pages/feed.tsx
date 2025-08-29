import { useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { useRouter } from 'next/router';
import usePosts from '../hooks/usePosts';
import { getApi, getWsUrl } from '../utils/api';

type Post = { id: string; userId: string; content: string; createdAt: string; likes: number; comments?: number; authorName?: string; authorAvatarUrl?: string; repostedByName?: string; likedBy?: string[] };
type Comment = { id:string; postId:string; userId:string; content:string; createdAt:string; authorName?: string };

export default function Feed() {
  const profile = (typeof window !== 'undefined') ? ((() => { try { return JSON.parse(localStorage.getItem('profile')||'null'); } catch(e){ return null; } })()) : null;
  const feedFor = profile?.userId || '';
  const { posts, load, create, like, comment, update, remove, mergePosts, removePostsByUser, loading } = usePosts(feedFor);
  const [content, setContent] = useState('');
  const [composerError, setComposerError] = useState<string | null>(null);
  const [composerSuccess, setComposerSuccess] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  async function repost(postId:string){ if(!token) return alert('Login necessário'); try{ const res = await fetch(`${getApi()}/api/posts/${postId}/repost`, { method:'POST', headers:{ Authorization:`Bearer ${token}` }}); if(res.ok){ await load(); } }catch(e){} }
  async function submitReply(){ if(!replyFor || !replyText.trim() || !token) return; await comment(replyFor, replyText.trim(), token); setReplyOpen(replyFor, false);}
  const [me, setMe] = useState<any>(null);

  async function handleLikeHover(e:any, p:Post){
    const users = await fetchLikedBy(p.id);
    const rect = e.currentTarget.getBoundingClientRect();
    setLikeTooltip({postId:p.id, x:rect.left + rect.width/2, y:rect.top - 10, users});
  }
  function hideLikeHover(){ setLikeTooltip({postId:null,x:0,y:0,users:[]}); }
  const [replyFor, setReplyFor] = useState<string|null>(null);
  const [replyText, setReplyText] = useState('');
  const setReplyOpen = (postId:string, open:boolean)=>{ setReplyFor(open?postId:null); if(!open) setReplyText(''); };
  const [likeTooltip, setLikeTooltip] = useState<{postId:string|null;x:number;y:number;users:string[]}>({postId:null,x:0,y:0,users:[]});

  async function fetchLikedBy(postId: string){
    try{
      const res = await fetch(`${getApi()}/api/posts/${postId}/likes`);
      if(res.ok){ const data = await res.json(); return (data?.users||[]).map((u:any)=>u.displayName||u.name||u.email||'Usuário'); }
    }catch(e){}
    return [];
  }
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<any>>([]);
  const [following, setFollowing] = useState<string[]>([]);
  // notifications handled globally in Layout now

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
      if (res.ok) {
        const list = await res.json();
        // remove o próprio usuário
        const myId = me?.userId;
        const filtered = Array.isArray(list) ? list.filter((u:any)=> u.id !== myId) : [];
        setResults(filtered);
      }
    } catch (e) { setResults([]); }
  };

  const toggleFollow = (id: string) => {
    (async () => {
  const API = getApi();
      const tok = localStorage.getItem('token');
      if (!tok) return alert('Faça login');
      if (me?.userId && me.userId === id) { return; } // não seguir a si mesmo
      if (following.includes(id)) {
        // Otimista: remove imediatamente
        const prevPosts = posts.filter(p=>p.userId===id);
        removePostsByUser(id);
        const next = following.filter(x=>x!==id); setFollowing(next); localStorage.setItem('following', JSON.stringify(next));
        try {
          const res = await fetch(`${API}/api/profiles/${id}/unfollow`, { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ followerId: me?.userId }) });
          if (!res.ok) {
            // Reverte se falhar
            mergePosts(prevPosts);
            const reverted = [...next, id];
            setFollowing(reverted); localStorage.setItem('following', JSON.stringify(reverted));
          }
        } catch(e) {
          mergePosts(prevPosts);
          const reverted = [...next, id];
          setFollowing(reverted); localStorage.setItem('following', JSON.stringify(reverted));
        }
      } else {
        await fetch(`${API}/api/profiles/${id}/follow`, { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ followerId: me?.userId }) });
        const next = [...following, id]; setFollowing(next); localStorage.setItem('following', JSON.stringify(next));
        // Busca posts recentes do usuário seguido e injeta imediatamente no feed
        try {
          const res = await fetch(`${API}/api/posts?feedFor=${encodeURIComponent(id)}`);
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
              // filtra apenas posts desse usuário seguido
              const their = data.filter((p:any)=> p.userId === id);
              mergePosts(their);
            }
          }
        } catch(e){}
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
        if (res.status === 401) {
          // Token inválido ou expirado
          localStorage.removeItem('token');
          localStorage.removeItem('profile');
          router.push('/login');
          return;
        }
        if (res.ok) { 
          const data = await res.json(); 
          setMe(data); 
          // load initial following from server
          try {
            const f = await fetch(`${API}/api/profiles/${data.userId}/following`);
            if (f.ok) {
              const list = await f.json();
              const ids = Array.isArray(list) ? list.map((x:any) => x.id) : [];
              setFollowing(ids); localStorage.setItem('following', JSON.stringify(ids));
            }
          } catch (_) {}
        }
      } catch (e) {
        console.error('Erro ao buscar perfil:', e);
      }
    })();
  }, []);

  // Reagir a mudança de auth (logout/login) para garantir feed atualizado e evitar dados desatualizados
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onAuth = () => {
      const t = localStorage.getItem('token');
      if (!t) { router.push('/login'); return; }
      // reload posts para novo usuário
      load();
    };
    window.addEventListener('auth-changed', onAuth as any);
    return () => window.removeEventListener('auth-changed', onAuth as any);
  }, [load]);

  // removed toggleNotifications (centralized in Layout)

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

  // removed markAllAsRead (centralized)

  const createPost = async () => {
    if (!token) { alert('Faça login'); return; }
    if (!content.trim()) { setComposerError('Digite algo para postar'); return; }
    setComposerError(null);
    await create(content.trim(), token || undefined);
    setContent('');
    setComposerSuccess(true);
    setTimeout(()=> setComposerSuccess(false), 1200);
  };

  const share = async (p: Post) => {
    const text = `${p.content}\n\nCompartilhado via User Profile App`;
    if (navigator && (navigator as any).share) {
      try { await (navigator as any).share({ text }); return; } catch (e) { /* ignore */ }
    }
    // fallback: copy to clipboard
    try { await navigator.clipboard.writeText(text); alert('Conteúdo copiado para a área de transferência'); } catch (e) { alert('Não foi possível compartilhar'); }
  };

  const [editingPostId, setEditingPostId] = useState<string|null>(null);
  const [editingText, setEditingText] = useState('');
  const startEdit = (p:Post) => { setEditingPostId(p.id); setEditingText(p.content); };
  const cancelEdit = () => { setEditingPostId(null); setEditingText(''); };
  const saveEdit = async () => {
    if (!editingPostId || !token) return;
    const trimmed = editingText.trim();
    if (!trimmed) {
      await Swal.fire({ icon:'warning', title:'Conteúdo vazio', text:'Digite algo antes de salvar.' });
      return;
    }
    await update(editingPostId, trimmed, token);
    setEditingPostId(null); setEditingText('');
  };
  const doLike = async (id: string) => { if (!token) { await Swal.fire({icon:'info',title:'Login necessário'}); return; } await like(id, token || undefined); };

  const doDelete = async (postId: string) => {
    if (!token) { await Swal.fire({icon:'info',title:'Faça login'}); return; }
    const res = await Swal.fire({icon:'question', title:'Remover post?', text:'Essa ação não pode ser desfeita.', showCancelButton:true, confirmButtonText:'Remover', cancelButtonText:'Cancelar', confirmButtonColor:'#ef4444'});
    if (!res.isConfirmed) return;
    await remove(postId, token || undefined);
  };

  const canComment = async (ownerId: string) => {
    if (!token) return false;
    if (!ownerId || ownerId.trim() === '') return false; // Validação para ID vazio
    const API = getApi();
    try {
      const res = await fetch(`${API}/api/profiles/${ownerId}/is-following`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return false;
      const d = await res.json(); return !!d.isFollowing;
    } catch (e) { return false; }
  };

  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [pendingComment, setPendingComment] = useState<Record<string,string>>({});
  const toggleComments = async (postId:string) => {
    setOpenComments(o=>({...o,[postId]:!o[postId]}));
    if (!comments[postId]) {
      try {
        const API = getApi();
        const res = await fetch(`${API}/api/posts/${postId}/comments`);
        if (res.ok) { const data = await res.json(); setComments(c=>({...c,[postId]:data||[]})); }
      } catch (e) {}
    }
  };
  const [commentErrors, setCommentErrors] = useState<Record<string,string|undefined>>({});
  const [commentSuccess, setCommentSuccess] = useState<Record<string,boolean>>({});
  const sendComment = async (postId:string) => {
    if (!token) return alert('Faça login');
    const text = (pendingComment[postId]||'').trim();
    if (!text) { setCommentErrors(e=>({...e,[postId]:'Comentário vazio'})); return; }
    setCommentErrors(e=>({...e,[postId]:undefined}));
    // optimistic local append
  const tmp: Comment = { id:'tmp-'+Date.now(), postId, userId: me?.userId||'', content: text, createdAt: new Date().toISOString(), authorName: me?.displayName || me?.email || me?.userId };
    setComments(c=>({ ...c, [postId]: [...(c[postId]||[]), tmp] }));
    setPendingComment(p=>({...p,[postId]:''}));
    try {
      const API = getApi();
      const res = await fetch(`${API}/api/posts/${postId}/comments`, { method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body: JSON.stringify({ content: text }) });
      if (res.ok) {
        const real = await res.json();
        setComments(c=>({ ...c, [postId]: (c[postId]||[]).map(cm=> cm.id===tmp.id ? real : cm) }));
        setCommentSuccess(s=>({...s,[postId]:true}));
        setTimeout(()=> setCommentSuccess(s=>({...s,[postId]:false})), 1000);
      }
    } catch (e) {}
  };

  // notifications websocket moved to Layout

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',position:'relative'}}>
        <h1>Feed</h1>
      </div>
      <div style={{marginBottom: 16}}>
        <div className="composer-wrapper">
          <textarea className="composer-box" placeholder=" " value={content} onChange={e=>setContent(e.target.value)} />
          <span className="composer-placeholder">No que você está pensando?</span>
        </div>
        <div className="composer-actions" style={{marginTop:8,flexDirection:'column'}}>
          <button className="primary" onClick={createPost} disabled={loading || !token || !content.trim()} style={composerSuccess ? {background:'#16a34a'}:undefined}>{composerSuccess ? 'Postado!' : (loading ? 'Postando...' : 'Postar')}</button>
          {composerError && <div className="field-error" style={{marginTop:6}}>{composerError}</div>}
        </div>
      </div>

      <div style={{marginBottom: 16}} className="card">
        <h3>Buscar pessoas</h3>
        <form onSubmit={search} style={{display:'flex',gap:8}}>
          <input placeholder="nome ou email (min 2 chars)" value={query} onChange={e=>{ const v=e.target.value; setQuery(v); if(!v.trim()) setResults([]); }} />
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

      <div className="posts-scroll">
      {(posts || [])
        .filter(p => p && p.id && p.userId)
        .map(p => (
        <div key={p.id} className="card" style={{marginBottom:12}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{fontWeight:600}}>{p.authorName || p.userId}</div>
            <div style={{fontSize:12, opacity:.6}}>{new Date(p.createdAt).toLocaleString()}</div>
          </div>
          <div style={{marginTop:8}}>
            {editingPostId === p.id ? (
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                <textarea value={editingText} onChange={e=>setEditingText(e.target.value)} style={{width:'100%',minHeight:90,borderRadius:12,padding:10,background:'rgba(255,255,255,0.05)',color:'inherit',border:'1px solid rgba(255,255,255,0.1)'}} />
                <div style={{display:'flex',gap:8}}>
                  <button className="primary" onClick={saveEdit}>Salvar</button>
                  <button className="icon-btn" onClick={cancelEdit}>Cancelar</button>
                </div>
              </div>
            ) : (
              p.content
            )}
          </div>
          <div style={{marginTop:10, display:'flex', gap:4, flexWrap:'wrap'}}>
            <button onClick={() => doLike(p.id)} className="primary" style={{display:'flex',alignItems:'center',gap:4, background: p.liked ? '#4ade80' : undefined}}>
              <span>{p.liked ? 'Descurtir' : 'Curtir'} ({p.likes})</span>
            </button>
            <button onClick={() => share(p)} className="icon-btn" aria-label="Compartilhar" title="Compartilhar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98"/><path d="M15.41 6.51 8.59 10.49"/></svg>
            </button>
            <button onClick={() => toggleComments(p.id)} className="icon-btn" aria-label="Comentários" title="Comentários" style={{position:'relative'}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-4.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
              {typeof (p as any).comments === 'number' && (
                <span style={{position:'absolute',top:-6,right:-6,background:'#6366f1',color:'#fff',borderRadius:'12px',padding:'0 6px',fontSize:10,fontWeight:600}}>{(p as any).comments}</span>
              )}
            </button>
            {me && me.userId === p.userId && (
              <>
                <button onClick={() => startEdit(p)} className="icon-btn" aria-label="Editar" title="Editar">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4h9"/><path d="M4 20h9"/><path d="M12 20l8-8-8-8-8 8 8 8Z" transform="translate(-4 -4)"/></svg>
                </button>
                <button onClick={() => doDelete(p.id)} className="icon-btn danger" aria-label="Excluir" title="Excluir">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14"/></svg>
                </button>
              </>
            )}
          </div>
          {openComments[p.id] && (
            <div style={{marginTop:12}}>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {(comments[p.id]||[]).map(c => (
                  <div key={c.id} style={{padding:'6px 10px',background:'rgba(255,255,255,0.04)',borderRadius:8,fontSize:13}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <span style={{fontWeight:500}}>{c.authorName || c.userId}</span>
                      <span style={{opacity:.6,fontSize:11}}>{new Date(c.createdAt).toLocaleString()}</span>
                    </div>
                    <div style={{marginTop:4}}>{c.content}</div>
                  </div>
                ))}
              </div>
              <div className="comment-input-row" style={{flexDirection:'column',alignItems:'stretch'}}>
                <div style={{display:'flex',gap:10}}>
                  <input
                    className="comment-input"
                    value={pendingComment[p.id]||''}
                    onChange={e=> { setPendingComment(pc=>({...pc,[p.id]:e.target.value})); if(commentErrors[p.id]) setCommentErrors(er=>({...er,[p.id]:undefined})); }}
                    placeholder="Escreva um comentário..."
                  />
                  <button
                    className="primary comment-send-btn"
                    disabled={!pendingComment[p.id]?.trim()}
                    style={commentSuccess[p.id]?{background:'#16a34a'}:undefined}
                    onClick={()=>sendComment(p.id)}
                  >{commentSuccess[p.id] ? 'Enviado!' : 'Enviar'}</button>
                </div>
                {commentErrors[p.id] && <div className="field-error" style={{marginTop:4}}>{commentErrors[p.id]}</div>}
              </div>
            </div>
          )}
        </div>
      ))}
      </div>
    </div>
  );
}

// (CommentBox removido; lógica incorporada inline com toggle e listagem.)
