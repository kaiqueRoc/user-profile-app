import { useEffect, useState } from 'react';
import usePosts from '../hooks/usePosts';
import { useRouter } from 'next/router';
import { getApi } from '../utils/api';

export default function Profile() {
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [editing, setEditing] = useState(false);
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [followCounts, setFollowCounts] = useState<{followers:number;following:number}>({followers:0,following:0});
  const [followers, setFollowers] = useState<any[]>([]);
  const [followingList, setFollowingList] = useState<any[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ bio?: string; avatarUrl?: string; general?: string; success?: string }>({});
  const [userId, setUserId] = useState<string | null>(null);
  const { posts, load } = usePosts('');
  const [myPostsOverride, setMyPostsOverride] = useState<any[]>([]);
  const [commentsMap, setCommentsMap] = useState<Record<string, any[]>>({});
  const [loadingComments, setLoadingComments] = useState<Record<string, boolean>>({});

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
      if (res.status === 401) {
        // Token inválido ou expirado
        localStorage.removeItem('token');
        localStorage.removeItem('profile');
        router.push('/login');
        return;
      }
      if (res.ok) {
        const data = await res.json();
  setBio(data.bio || '');
        setAvatarUrl(data.avatarUrl || '');
  setUserId(data.userId || data.id || null);
        try { localStorage.setItem('profile', JSON.stringify(data)); } catch(e) {}
      }
    } catch (err) {
      console.error('Erro ao buscar perfil:', err);
    }
  };

  useEffect(() => { fetchProfile(token); }, [token]);

  // detect if viewing another user via query ?u=<id>
  useEffect(()=>{
    if (!router.isReady) return;
    const qid = (router.query.u as string) || null;
    setViewingUserId(qid);
  }, [router.isReady, router.query.u]);
  // garantir que posts são carregados sempre ao abrir perfil (independente do cache)
  useEffect(() => { load(); }, []);

  // Carrega posts do usuário diretamente para evitar falha de filtro quando cache global está vazio/inválido
  useEffect(() => {
    const fetchMine = async () => {
      if (!userId) return;
      try {
        const API = getApi();
        const res = await fetch(`${API}/api/posts?feedFor=${encodeURIComponent(userId)}`);
        if (res.ok) {
          const data = await res.json();
          const mine = Array.isArray(data) ? data.filter((p:any)=> p.userId === userId) : [];
          setMyPostsOverride(mine);
        }
      } catch (e) {}
    };
    fetchMine();
  }, [userId]);

  // Sincroniza override removendo posts que foram deletados do estado global (via websocket)
  useEffect(() => {
    if (!myPostsOverride.length) return;
    setMyPostsOverride(prev => prev.filter(p => (posts||[]).some(g => g.id === p.id)));
  }, [posts]);

  const validate = () => {
    const next: { bio?: string; avatarUrl?: string } = {};
    if (!bio.trim() && !avatarUrl.trim()) next.bio = 'Informe bio ou avatar';
    if (avatarUrl.trim() && !/^https?:|^data:image\//.test(avatarUrl.trim())) next.avatarUrl = 'URL inválida';
    setErrors(e => ({ ...e, ...next, general: undefined, success: undefined }));
    return Object.keys(next).length === 0;
  };

  const save = async () => {
    if (!token) return;
    if (!validate()) return;
    const API = getApi();
    try {
      const res = await fetch(`${API}/api/profiles/me`, {
        method: 'PUT',
        headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bio, avatarUrl })
      });
      if (!res.ok) { setErrors({ general: 'Erro ao salvar' }); return; }
      const updated = await res.json().catch(()=>null);
      if (updated) {
        setBio(updated.bio || bio);
        setAvatarUrl(updated.avatarUrl || avatarUrl);
        try {
          localStorage.setItem('profile', JSON.stringify(updated));
          if (updated.avatarUrl) localStorage.setItem('avatarUrl', updated.avatarUrl);
        } catch(e) {}
        setErrors({ success: 'Salvo!' });
        try { window.dispatchEvent(new Event('profile-updated')); } catch(e) {}
      }
    } catch (e) {
      setErrors({ general: 'Erro ao salvar' });
    }
  };

  const onFile = (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { setAvatarUrl(String(reader.result || '')); };
    reader.readAsDataURL(f);
  };

  const effectiveUserId = viewingUserId || userId;
  const myPosts = (myPostsOverride.length && !viewingUserId ? myPostsOverride : (posts||[]).filter(p => p.userId === effectiveUserId));

  // Carrega comentários de cada post do usuário (lazy simples: após posts definidos e ainda não buscados)
  useEffect(() => {
    const API = getApi();
    const toFetch = myPosts.filter(p => p && p.id && !commentsMap[p.id]);
    if (toFetch.length === 0) return;
    toFetch.forEach(p => {
      setLoadingComments(lc => ({ ...lc, [p.id]: true }));
      fetch(`${API}/api/posts/${p.id}/comments`)
        .then(r => r.ok ? r.json() : [])
        .then(data => {
          setCommentsMap(cm => ({ ...cm, [p.id]: Array.isArray(data)? data : [] }));
        })
        .catch(()=>{
          setCommentsMap(cm => ({ ...cm, [p.id]: [] }));
        })
        .finally(()=> setLoadingComments(lc => ({ ...lc, [p.id]: false })));
    });
  }, [myPosts.map(p=>p.id).join('.')]);

  // Rebusca comentários se o contador (p.comments) aumentar em relação ao que temos carregado
  useEffect(() => {
    const API = getApi();
    myPosts.forEach(p => {
      const loaded = commentsMap[p.id]?.length || 0;
      const announced = (p as any).comments || 0;
      if (announced > loaded) {
        setLoadingComments(lc => ({ ...lc, [p.id]: true }));
        fetch(`${API}/api/posts/${p.id}/comments`)
          .then(r => r.ok ? r.json() : [])
          .then(data => {
            setCommentsMap(cm => ({ ...cm, [p.id]: Array.isArray(data)? data : [] }));
          })
          .catch(()=>{})
          .finally(()=> setLoadingComments(lc => ({ ...lc, [p.id]: false })));
      }
    });
  }, [myPosts.map(p=> `${p.id}:${(p as any).comments||0}`).join('|')]);
  const storedProfile = (typeof window !== 'undefined') ? (() => { try { return JSON.parse(localStorage.getItem('profile')||'null'); } catch(e){ return null;} })() : null;
  const displayName = viewingUserId && viewingUserId !== storedProfile?.userId ? (`Perfil`) : (storedProfile?.displayName || storedProfile?.name || 'Meu Perfil');

  // fetch followers/following counts if viewing user (self or other)
  useEffect(()=>{
    const loadFollowData = async () => {
      const uid = effectiveUserId;
      if(!uid) return;
      const API = getApi();
      try {
        // try fetch profile for quick counts (if counts available)
        try {
          const prof = await fetch(`${API}/api/profiles/${uid}`).then(r=>r.ok?r.json():null).catch(()=>null);
          if (prof && (typeof prof.followersCount === 'number' || typeof prof.followingCount === 'number')) {
            setFollowCounts({ followers: prof.followersCount||0, following: prof.followingCount||0 });
          }
        } catch(e){}
        const [fwers, fwing] = await Promise.all([
          fetch(`${API}/api/profiles/${uid}/followers`).then(r=>r.ok?r.json():[]).catch(()=>[]),
          fetch(`${API}/api/profiles/${uid}/following`).then(r=>r.ok?r.json():[]).catch(()=>[])
        ]);
        setFollowers(fwers);
        setFollowingList(fwing);
        // fallback to length only if counts not yet set or mismatch (ensures live precision)
        setFollowCounts(c=>({
          followers: fwers.length || c.followers,
          following: fwing.length || c.following
        }));
        const meId = storedProfile?.userId;
        if (meId && uid !== meId) {
          setIsFollowing(fwers.some((p:any)=> p.id === meId));
        }
      } catch(e){}
    };
    loadFollowData();
  }, [effectiveUserId]);

  const toggleFollowViewing = async () => {
    if (!viewingUserId || !token || viewingUserId === storedProfile?.userId) return;
    const API = getApi();
    const meId = storedProfile?.userId;
    if(!meId) return;
    try {
      if (isFollowing) {
        await fetch(`${API}/api/profiles/${viewingUserId}/unfollow`, { method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body: JSON.stringify({ followerId: meId }) });
        setIsFollowing(false);
        setFollowCounts(c=>({...c, followers: Math.max(0, c.followers-1)}));
      } else {
        await fetch(`${API}/api/profiles/${viewingUserId}/follow`, { method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body: JSON.stringify({ followerId: meId }) });
        setIsFollowing(true);
        setFollowCounts(c=>({...c, followers: c.followers+1}));
      }
    } catch(e){}
  };

  return (
    <div>
  <div className="card" style={{position:'relative',marginBottom:24}}>
        <button className="edit-btn" onClick={()=> setEditing(e=>!e)} aria-label={editing? 'Cancelar edição' : 'Editar perfil'}>
          {editing ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m11 4 7 7-7 7"/><path d="M4 11h14v2H4z"/></svg>
          )}
        </button>
        <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>
          <div>
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" style={{width:120,height:120,objectFit:'cover',borderRadius:60,border:'2px solid rgba(255,255,255,0.15)'}} />
            ) : (
              <div style={{width:120,height:120,borderRadius:60,background:'rgba(255,255,255,0.06)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:42,opacity:.4}}>{displayName.slice(0,1)}</div>
            )}
          </div>
          <div style={{flex:1,minWidth:240}}>
            <h1 style={{marginTop:0,display:'flex',alignItems:'center',gap:12}}>
              {displayName}
              {viewingUserId && viewingUserId !== storedProfile?.userId && (
                <button onClick={toggleFollowViewing} className="primary" style={{padding:'6px 12px',fontSize:12}}>{isFollowing ? 'Deixar de seguir' : 'Seguir'}</button>
              )}
            </h1>
            <div style={{display:'flex',gap:18,fontSize:12,marginTop:-4,marginBottom:6}}>
              <span><strong>{followCounts.followers}</strong> seguidores</span>
              <span><strong>{followCounts.following}</strong> seguindo</span>
            </div>
            {!editing && (
              <div style={{whiteSpace:'pre-wrap',fontSize:14,opacity: bio ? 0.95 : 0.5}}>
                {bio || 'Nenhuma bio ainda. Clique em editar para adicionar.'}
              </div>
            )}
            {editing && !viewingUserId && (
              <div style={{display:'flex',flexDirection:'column',gap:12,marginTop:8}}>
                <input type="file" accept="image/*" onChange={e => onFile(e.target.files?.[0] ?? null)} />
                <input className="glass-input" placeholder="URL do avatar" value={avatarUrl} onChange={e=>{ setAvatarUrl(e.target.value); if(errors.avatarUrl) setErrors(er=>({...er,avatarUrl:undefined})); }} />
                {errors.avatarUrl && <div className="field-error" style={{marginTop:-6}}>{errors.avatarUrl}</div>}
                <textarea className="glass-textarea" placeholder="Sua bio" value={bio} onChange={e=>{ setBio(e.target.value); if(errors.bio) setErrors(er=>({...er,bio:undefined})); }} />
                {errors.bio && <div className="field-error" style={{marginTop:-6}}>{errors.bio}</div>}
                <div style={{display:'flex',gap:8}}>
                  <button className="primary" onClick={async ()=>{ await save(); setEditing(false); try { window.dispatchEvent(new Event('profile-updated')); } catch(e){} }}>Salvar</button>
                  <button onClick={()=>{ setEditing(false); }} style={{background:'rgba(255,255,255,0.08)',color:'var(--text)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:10,padding:'10px 14px',cursor:'pointer'}}>Cancelar</button>
                </div>
                {errors.general && <p className="field-error" style={{margin:0}}>{errors.general}</p>}
                {errors.success && <p className="field-success" style={{margin:0}}>{errors.success}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
  <h2>{viewingUserId && viewingUserId !== storedProfile?.userId ? 'Posts' : 'Meus Posts'}</h2>
      {myPosts.length === 0 && <div className="muted" style={{fontSize:12}}>Nenhum post ainda</div>}
      {myPosts.map(p => (
        <div key={p.id} className="card" style={{marginBottom:8}}>
          <div style={{fontSize:11,opacity:.6}}>{new Date(p.createdAt).toLocaleString()}</div>
          <div style={{marginTop:6}}>{p.content}</div>
          <div style={{fontSize:11,opacity:.5,marginTop:4}}>Likes: {p.likes}</div>
          <div style={{marginTop:6}}>
            <div style={{fontWeight:600,fontSize:12,marginBottom:4}}>Comentários</div>
            {loadingComments[p.id] && !commentsMap[p.id] && (
              <div style={{fontSize:11,opacity:.6}}>Carregando...</div>
            )}
            {(commentsMap[p.id]||[]).length === 0 && !loadingComments[p.id] && (
              <div style={{fontSize:11,opacity:.5}}>Sem comentários</div>
            )}
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {(commentsMap[p.id]||[]).map(c => (
                <div key={c.id} style={{background:'rgba(255,255,255,0.04)',padding:'6px 10px',borderRadius:8,fontSize:12}}>
                  <div style={{display:'flex',justifyContent:'space-between'}}>
                    <span style={{fontWeight:500}}>{c.authorName || c.userId}</span>
                    <span style={{opacity:.6,fontSize:10}}>{new Date(c.createdAt).toLocaleString()}</span>
                  </div>
                  <div style={{marginTop:4}}>{c.content}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
