import { useEffect, useRef, useState } from 'react';
import { getApi, getWsUrl } from '../utils/api';

// Cache agora segregado por usuário + feed (evita mostrar posts de outra conta após logout/login).
// Estrutura: { [cacheKey]: Post[] } onde cacheKey = `${userId||anon}::${feedFor||all}`
let cacheByKey: Record<string, any[]> = {};

function getCurrentUserId(): string | null {
  if (typeof window === 'undefined') return null;
  try { const p = JSON.parse(localStorage.getItem('profile') || 'null'); if (p?.userId) return p.userId; } catch (_) {}
  try {
    const tok = localStorage.getItem('token');
    if (tok) { const payload = JSON.parse(atob(tok.split('.')[1] || '')); return payload.sub || payload.userId || payload.id || null; }
  } catch (_) {}
  return null;
}

// util simples para remover duplicatas por id mantendo primeira ocorrência
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
  const feedFor = initialFeedFor || '';
  const currentUserId = getCurrentUserId();
  const cacheKey = (currentUserId || 'anon') + '::' + (feedFor || 'all');
  const [posts, setPosts] = useState<any[]>(() => cacheByKey[cacheKey] || []);
  const [loading, setLoading] = useState(false);
  const wsRef = useRef<any>(null);
  const prevKeyRef = useRef<string>(cacheKey);

  const load = async () => {
    setLoading(true);
    try {
      const API = getApi();
      const url = feedFor ? `${API}/api/posts?feedFor=${encodeURIComponent(feedFor)}` : `${API}/api/posts`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        cacheByKey[cacheKey] = dedupe(Array.isArray(data) ? data : []);
        setPosts(cacheByKey[cacheKey]);
      } else {
        cacheByKey[cacheKey] = [];
        setPosts([]);
      }
    } catch (err) {
      cacheByKey[cacheKey] = cacheByKey[cacheKey] || [];
      setPosts(cacheByKey[cacheKey] || []);
    } finally { setLoading(false); }
  };

  // Recarrega quando feedFor ou usuário mudarem
  useEffect(() => {
    // Migração: se mudou a chave (ex: feedFor '' -> userId) e novo cache vazio, copiar posts relevantes
    if (prevKeyRef.current !== cacheKey) {
      if (!cacheByKey[cacheKey]) {
        const prev = cacheByKey[prevKeyRef.current] || [];
        if (feedFor) {
          const mine = prev.filter((p:any) => p.userId === feedFor);
          if (mine.length) cacheByKey[cacheKey] = mine;
        } else {
          cacheByKey[cacheKey] = prev;
        }
      }
      prevKeyRef.current = cacheKey;
    }
    setPosts(cacheByKey[cacheKey] || []); // atualiza imediatamente com cache isolado/migrado
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedFor, currentUserId]);

  // Limpa caches quando auth mudar (logout/login) para evitar vazamento entre contas
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleAuth = () => {
      cacheByKey = {}; // zera todos
      setPosts([]);
      setTimeout(() => load(), 0);
    };
    window.addEventListener('auth-changed', handleAuth as any);
    return () => window.removeEventListener('auth-changed', handleAuth as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedFor]);

  useEffect(() => {
    const wsUrl = typeof window !== 'undefined' ? getWsUrl() : null;
    if (!wsUrl) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const ws = new WebSocket(wsUrl);
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'post_created') {
            const incoming = msg.post || { id: msg.id, userId: msg.userId, content: msg.content || '', createdAt: msg.createdAt || new Date().toISOString(), likes: msg.likes ?? 0, authorName: msg.post?.authorName };
            const merge = (list: any[]) => {
              const byId = list.findIndex(p => p.id === incoming.id);
              if (byId >= 0) return list.map((p,i) => i===byId ? { ...p, ...incoming } : p);
              const tempIdx = list.findIndex(p => typeof p.id === 'string' && p.id.startsWith('temp-') && p.content === incoming.content);
              if (tempIdx >= 0) return list.map((p,i) => i===tempIdx ? { ...p, ...incoming } : p);
              return [incoming, ...list];
            };
            cacheByKey[cacheKey] = merge(cacheByKey[cacheKey] || []);
            setPosts(prev => merge(prev));
          } else if (msg.type === 'post_liked' && msg.postId) {
            const newCount = typeof msg.likes === 'number' ? msg.likes : undefined;
            cacheByKey[cacheKey] = dedupe((cacheByKey[cacheKey] || []).map((p:any) => p.id === msg.postId ? { ...p, likes: newCount ?? (p.likes||0) + 1, liked: true } : p));
            setPosts(prev => dedupe(prev.map(p => p.id === msg.postId ? { ...p, likes: newCount ?? (p.likes||0) + 1, liked: true } : p)));
          } else if (msg.type === 'post_unliked' && msg.postId) {
            const newCount = typeof msg.likes === 'number' ? msg.likes : undefined;
            cacheByKey[cacheKey] = dedupe((cacheByKey[cacheKey] || []).map((p:any) => p.id === msg.postId ? { ...p, likes: newCount ?? Math.max(0,(p.likes||0) - 1), liked: false } : p));
            setPosts(prev => dedupe(prev.map(p => p.id === msg.postId ? { ...p, likes: newCount ?? Math.max(0,(p.likes||0) - 1), liked: false } : p)));
          } else if (msg.type === 'post_deleted' && msg.postId) {
            cacheByKey[cacheKey] = (cacheByKey[cacheKey] || []).filter((p:any) => p.id !== msg.postId);
            setPosts(prev => prev.filter(p => p.id !== msg.postId));
          } else if (msg.type === 'post_updated' && msg.post) {
            cacheByKey[cacheKey] = dedupe((cacheByKey[cacheKey] || []).map((p:any)=> p.id === msg.post.id ? { ...p, ...msg.post } : p));
            setPosts(prev => dedupe(prev.map(p => p.id === msg.post.id ? { ...p, ...msg.post } : p)));
          } else if (msg.type === 'post_commented' && msg.postId) {
            const pid = msg.postId; const count = msg.commentCount;
            if (typeof count === 'number') {
              cacheByKey[cacheKey] = (cacheByKey[cacheKey] || []).map((p:any)=> p.id===pid ? { ...p, comments: count } : p);
              setPosts(prev => prev.map(p => p.id===pid ? { ...p, comments: count } : p));
              cacheByKey[cacheKey] = dedupe((cacheByKey[cacheKey] || []).map((p:any)=> p.id===pid ? { ...p, comments: count } : p));
              setPosts(prev => dedupe(prev.map(p => p.id===pid ? { ...p, comments: count } : p)));
            }
          }
        } catch (_) {}
      };
      wsRef.current = ws;
      return () => { try { ws.close(); } catch(_){} };
    } catch (_) {}
  }, [cacheKey]);

  const create = async (content: string, token?: string) => {
    if (!content || !token) return null;
    const API = getApi();
    const tempId = 'temp-' + Date.now();
    const uid = getCurrentUserId();
    const tmp = { id: tempId, userId: uid, content, createdAt: new Date().toISOString(), likes: 0 };
    cacheByKey[cacheKey] = [tmp, ...(cacheByKey[cacheKey] || [])];
    setPosts(prev => [tmp, ...prev]);
    try {
      const headers: Record<string,string> = { 'Content-Type':'application/json' };
      headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${API}/api/posts`, { method: 'POST', headers, body: JSON.stringify({ content }) });
      if (res.ok) {
        const body = await res.json().catch(()=>null);
        if (body && body.id) {
          cacheByKey[cacheKey] = (cacheByKey[cacheKey] || []).map((p:any)=> p.id===tempId ? { ...p, id: body.id } : p);
          setPosts(prev => prev.map((p:any)=> p.id===tempId ? { ...p, id: body.id } : p));
          try { window.dispatchEvent(new CustomEvent('post-created', { detail: { id: body.id, userId: uid }})); } catch(_){}
        }
      } else {
        cacheByKey[cacheKey] = (cacheByKey[cacheKey] || []).filter((p:any)=>p.id!==tempId);
        setPosts(cacheByKey[cacheKey]);
      }
    } catch (_) {
      cacheByKey[cacheKey] = (cacheByKey[cacheKey] || []).filter((p:any)=>p.id!==tempId);
      setPosts(cacheByKey[cacheKey]);
    }
    return null;
  };

  const pendingLikeRef = useRef<Set<string>>(new Set());
  const like = async (id: string, token?: string) => {
    if (!id || !token) return;
    if (pendingLikeRef.current.has(id)) return;
    cacheByKey[cacheKey] = (cacheByKey[cacheKey] || []).map((p:any) => p.id===id ? { ...p, liked: !p.liked } : p);
    setPosts(prev => prev.map(p => p.id===id ? { ...p, liked: !p.liked } : p));
    pendingLikeRef.current.add(id);
    const API = getApi();
    try {
      const headers: Record<string,string> = { 'Content-Type':'application/json', Authorization: `Bearer ${token}` };
      await fetch(`${API}/api/posts/${id}/like`, { method: 'POST', headers, body: JSON.stringify({}) });
    } catch (_) {}
    finally { pendingLikeRef.current.delete(id); }
  };

  const comment = async (postId: string, content: string, token?: string) => {
    if (!postId || !content || !token) return null;
    const API = getApi();
    try {
      const headers: Record<string,string> = { 'Content-Type':'application/json', Authorization: `Bearer ${token}` };
      const res = await fetch(`${API}/api/posts/${postId}/comments`, { method: 'POST', headers, body: JSON.stringify({ content }) });
      if (res.ok) await load();
    } catch (_) {}
  };

  const update = async (id: string, content: string, token?: string) => {
    if (!id || !content || !token) return;
    const API = getApi();
    cacheByKey[cacheKey] = (cacheByKey[cacheKey] || []).map((p:any)=> p.id===id ? { ...p, content } : p);
    setPosts(prev => prev.map(p => p.id===id ? { ...p, content } : p));
    try {
      const headers: Record<string,string> = { 'Content-Type':'application/json', Authorization: `Bearer ${token}` };
      await fetch(`${API}/api/posts/${id}`, { method: 'PUT', headers, body: JSON.stringify({ content }) });
    } catch (_) {}
  };

  const remove = async (id: string, token?: string) => {
    if (!id || !token) return;
    const API = getApi();
    const prev = cacheByKey[cacheKey] || [];
    cacheByKey[cacheKey] = (cacheByKey[cacheKey] || []).filter((p:any) => p.id !== id);
    setPosts((ps:any[]) => ps.filter(p => p.id !== id));
    try {
      const headers: Record<string,string> = { Authorization: `Bearer ${token}` };
      const res = await fetch(`${API}/api/posts/${id}`, { method: 'DELETE', headers });
      if (!res.ok) {
        cacheByKey[cacheKey] = prev; setPosts(prev); await load();
      }
    } catch (_) { cacheByKey[cacheKey] = prev; setPosts(prev); await load(); }
  };
  // Permite mesclar posts adicionais (ex: ao seguir alguém e trazer posts dele imediatamente)
  const mergePosts = (extra: any[]) => {
    if (!extra || !extra.length) return;
    const combined = dedupe([...(extra||[]), ...(cacheByKey[cacheKey] || [])]);
    cacheByKey[cacheKey] = combined;
    setPosts(combined);
  };

  // Remove todos os posts de um usuário (ex: ao deixar de seguir)
  const removePostsByUser = (uid: string) => {
    if (!uid) return;
    const filtered = (cacheByKey[cacheKey] || []).filter((p:any)=> p.userId !== uid);
    cacheByKey[cacheKey] = filtered;
    setPosts(filtered);
  };

  return { posts, load, create, like, comment, update, remove, mergePosts, removePostsByUser, loading };
}
