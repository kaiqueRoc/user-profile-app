import { useEffect, useRef, useState } from 'react';
import { getApi, getWsUrl } from '../utils/api';

// Cache global simples (antes causava persistência entre contas). Mantemos, mas limpamos ao trocar auth.
let cache: any = { posts: null };

// util simples para remover duplicatas por id mantendo primeira ocorrência (mais recente no topo)
function dedupe(list: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const p of list) {
    if (!p || !p.id) continue;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}
export default function usePosts(initialFeedFor?: string) {
  const [posts, setPosts] = useState<any[]>(() => cache.posts || []);
  const [loading, setLoading] = useState(false);
  const wsRef = useRef<any>(null);
  const feedFor = initialFeedFor || '';

  const load = async () => {
    setLoading(true);
    try {
      const API = getApi();
      const url = feedFor ? `${API}/api/posts?feedFor=${encodeURIComponent(feedFor)}` : `${API}/api/posts`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
  cache.posts = dedupe(Array.isArray(data) ? data : []);
  setPosts(cache.posts);
      } else {
        cache.posts = [];
        setPosts([]);
      }
    } catch (err) {
      cache.posts = cache.posts || [];
      setPosts(cache.posts || []);
    } finally { setLoading(false); }
  };

  // Recarrega sempre que feedFor mudar (troca de usuário / contexto)
  useEffect(() => {
    load();
  }, [feedFor]);

  // Limpa cache quando ocorrer evento global de auth change (login/logout ou troca de conta)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleAuth = () => {
      cache.posts = null; // zera cache global
      setPosts([]);       // limpa imediatamente UI
      load();             // busca dados para novo usuário
    };
    window.addEventListener('auth-changed', handleAuth as any);
    return () => window.removeEventListener('auth-changed', handleAuth as any);
  }, [feedFor]);

  useEffect(() => {
    // websocket (centralized helper)
    const wsUrl = typeof window !== 'undefined' ? getWsUrl() : null;
    if (!wsUrl) return;
    
    // Só conectar se houver token
    const token = localStorage.getItem('token');
    if (!token) {
      console.log('No token for WebSocket in usePosts');
      return;
    }
    
    try {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        console.log('Posts WebSocket connected');
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          // incremental updates to avoid full reload
          if (msg.type === 'post_created') {
            const incoming = msg.post || { id: msg.id, userId: msg.userId, content: msg.content || '', createdAt: msg.createdAt || new Date().toISOString(), likes: msg.likes ?? 0, authorName: msg.post?.authorName };
            // merge logic: if id already exists update; else if matching temp (temp-* + same user/content) replace; else prepend
            const merge = (list: any[]) => {
              const byId = list.findIndex(p => p.id === incoming.id);
              if (byId >= 0) {
                return list.map((p,i) => i===byId ? { ...p, ...incoming } : p);
              }
              const tempIdx = list.findIndex(p => typeof p.id === 'string' && p.id.startsWith('temp-') && p.content === incoming.content);
              if (tempIdx >= 0) {
                return list.map((p,i) => i===tempIdx ? { ...p, ...incoming } : p);
              }
              return [incoming, ...list];
            };
            cache.posts = merge(cache.posts || []);
            setPosts(prev => merge(prev));
          } else if (msg.type === 'post_liked' && msg.postId) {
            const newCount = typeof msg.likes === 'number' ? msg.likes : undefined;
            cache.posts = dedupe((cache.posts || []).map((p:any) => p.id === msg.postId ? { ...p, likes: newCount ?? (p.likes||0) + 1, liked: true } : p));
            setPosts(prev => dedupe(prev.map(p => p.id === msg.postId ? { ...p, likes: newCount ?? (p.likes||0) + 1, liked: true } : p)));
          } else if (msg.type === 'post_unliked' && msg.postId) {
            const newCount = typeof msg.likes === 'number' ? msg.likes : undefined;
            cache.posts = dedupe((cache.posts || []).map((p:any) => p.id === msg.postId ? { ...p, likes: newCount ?? Math.max(0,(p.likes||0) - 1), liked: false } : p));
            setPosts(prev => dedupe(prev.map(p => p.id === msg.postId ? { ...p, likes: newCount ?? Math.max(0,(p.likes||0) - 1), liked: false } : p)));
          } else if (msg.type === 'post_deleted' && msg.postId) {
            cache.posts = (cache.posts || []).filter((p:any) => p.id !== msg.postId);
            setPosts(prev => prev.filter(p => p.id !== msg.postId));
          } else if (msg.type === 'post_updated' && msg.post) {
            cache.posts = dedupe((cache.posts || []).map((p:any)=> p.id === msg.post.id ? { ...p, ...msg.post } : p));
            setPosts(prev => dedupe(prev.map(p => p.id === msg.post.id ? { ...p, ...msg.post } : p)));
          } else if (msg.type === 'post_commented' && msg.postId) {
            // update comment count on the post if present
            const pid = msg.postId;
            const count = msg.commentCount;
            if (typeof count === 'number') {
              cache.posts = (cache.posts || []).map((p:any)=> p.id===pid ? { ...p, comments: count } : p);
              setPosts(prev => prev.map(p => p.id===pid ? { ...p, comments: count } : p));
              cache.posts = dedupe((cache.posts || []).map((p:any)=> p.id===pid ? { ...p, comments: count } : p));
              setPosts(prev => dedupe(prev.map(p => p.id===pid ? { ...p, comments: count } : p)));
            }
          }
        } catch (e) { 
          console.error('WebSocket message error:', e);
        }
      };
      ws.onclose = (event) => {
        console.log('Posts WebSocket closed:', event.code, event.reason);
      };
      ws.onerror = (error) => {
        console.error('Posts WebSocket error:', error);
      };
      wsRef.current = ws;
      return () => { 
        try { ws.close(); } catch(_){} 
      };
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
    }
  }, [feedFor]);

  const create = async (content: string, token?: string) => {
    if (!content || !token) return null;
    const API = getApi();
  // optimistic
  const tempId = 'temp-' + Date.now();
  // tenta capturar userId atual do localStorage para evitar posts com userId vazio ao trocar de conta
  let currentUserId = '';
  try { const p = JSON.parse(localStorage.getItem('profile')||'null'); currentUserId = p?.userId || ''; } catch(e) {}
  const tmp = { id: tempId, userId: currentUserId, content, createdAt: new Date().toISOString(), likes: 0 };
  cache.posts = [tmp, ...(cache.posts || [])];
  setPosts(prev => [tmp, ...prev]);
    try {
  const headers: Record<string,string> = { 'Content-Type':'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api/posts`, { method: 'POST', headers, body: JSON.stringify({ content }) });
      if (res.ok) {
        const body = await res.json().catch(()=>null);
        if (body && body.id) {
          // replace temp
          cache.posts = (cache.posts || []).map((p:any)=> p.id===tempId ? { ...p, id: body.id } : p);
          setPosts(prev => prev.map((p:any)=> p.id===tempId ? { ...p, id: body.id } : p));
        }
      } else {
        // remove temp
        cache.posts = (cache.posts || []).filter((p:any)=>p.id!==tempId);
        setPosts(cache.posts);
      }
    } catch (e) {
      cache.posts = (cache.posts || []).filter((p:any)=>p.id!==tempId);
      setPosts(cache.posts);
    }
    return null;
  };

  // controla requisições simultâneas para o mesmo post
  const pendingLikeRef = useRef<Set<string>>(new Set());
  const like = async (id: string, token?: string) => {
    if (!id || !token) return;
    if (pendingLikeRef.current.has(id)) return; // evita spam rápido
    // toggle otimista APENAS do flag liked; contagem ficará correta quando evento websocket chegar
    cache.posts = (cache.posts || []).map((p:any) => p.id===id ? { ...p, liked: !p.liked } : p);
    setPosts(prev => prev.map(p => p.id===id ? { ...p, liked: !p.liked } : p));
    pendingLikeRef.current.add(id);
    const API = getApi();
    try {
      const headers: Record<string,string> = { 'Content-Type':'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      await fetch(`${API}/api/posts/${id}/like`, { method: 'POST', headers, body: JSON.stringify({}) });
    } catch (e) { /* ignore */ }
    finally { pendingLikeRef.current.delete(id); }
  };

  const comment = async (postId: string, content: string, token?: string) => {
    if (!postId || !content || !token) return null;
    const API = getApi();
    try {
  const headers: Record<string,string> = { 'Content-Type':'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api/posts/${postId}/comments`, { method: 'POST', headers, body: JSON.stringify({ content }) });
      if (res.ok) {
        // refresh
        await load();
      }
    } catch (e) {}
  };

  const update = async (id: string, content: string, token?: string) => {
    if (!id || !content || !token) return;
    const API = getApi();
    cache.posts = (cache.posts || []).map((p:any)=> p.id===id ? { ...p, content } : p);
    setPosts(prev => prev.map(p => p.id===id ? { ...p, content } : p));
    try {
      const headers: Record<string,string> = { 'Content-Type':'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      await fetch(`${API}/api/posts/${id}`, { method: 'PUT', headers, body: JSON.stringify({ content }) });
    } catch (e) {}
  };

  const remove = async (id: string, token?: string) => {
    if (!id || !token) return;
    const API = getApi();
    const prev = cache.posts || [];
    cache.posts = (cache.posts || []).filter((p:any) => p.id !== id);
    setPosts((ps:any[]) => ps.filter(p => p.id !== id));
    try {
      const headers: Record<string,string> = { };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${API}/api/posts/${id}`, { method: 'DELETE', headers });
      if (!res.ok) {
        // rollback
        cache.posts = prev;
        setPosts(prev);
        await load();
      }
    } catch (e) {
      cache.posts = prev;
      setPosts(prev);
      await load();
    }
  };

  return { posts, load, create, like, comment, update, remove, loading };
}
