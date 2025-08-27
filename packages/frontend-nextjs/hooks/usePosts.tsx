import { useEffect, useRef, useState } from 'react';

const getApi = () => (typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL as string) : '');

let cache: any = { posts: null };

export default function usePosts(initialFeedFor?: string) {
  const [posts, setPosts] = useState(cache.posts || []);
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
        cache.posts = Array.isArray(data) ? data : [];
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

  useEffect(() => {
    // initialize
    if (!cache.posts) load();
    // websocket
    const wsUrl = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_WS_URL as any) : null;
    if (!wsUrl || typeof wsUrl !== 'string') return;
    try {
      const ws = new WebSocket(wsUrl);
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'post_created' || msg.type === 'post_liked' || msg.type === 'post_commented') {
            // refresh from server
            load();
          }
        } catch (e) { /* ignore */ }
      };
      wsRef.current = ws;
      return () => { try { ws.close(); } catch(_){} };
    } catch (err) {}
  }, [feedFor]);

  const create = async (content: string, token?: string) => {
    if (!content || !token) return null;
    const API = getApi();
    // optimistic
    const tempId = 'temp-' + Date.now();
    const tmp = { id: tempId, userId: '', content, createdAt: new Date().toISOString(), likes: 0 };
    cache.posts = [tmp, ...(cache.posts || [])];
    setPosts(cache.posts);
    try {
      const res = await fetch(`${API}/api/posts`, { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ content }) });
      if (res.ok) {
        const body = await res.json().catch(()=>null);
        if (body && body.id) {
          // replace temp
          cache.posts = (cache.posts || []).map((p:any)=> p.id===tempId ? { ...p, id: body.id } : p);
          setPosts(cache.posts);
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

  const like = async (id: string, token?: string) => {
    if (!id || !token) return;
    const API = getApi();
    // optimistic update: increment locally
    cache.posts = (cache.posts || []).map((p:any) => p.id===id ? { ...p, likes: (p.likes||0)+1 } : p);
    setPosts(cache.posts);
    try {
      await fetch(`${API}/api/posts/${id}/like`, { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({}) });
    } catch (e) { /* ignore */ }
  };

  const comment = async (postId: string, content: string, token?: string) => {
    if (!postId || !content || !token) return null;
    const API = getApi();
    try {
      const res = await fetch(`${API}/api/posts/${postId}/comments`, { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ content }) });
      if (res.ok) {
        // refresh
        await load();
      }
    } catch (e) {}
  };

  return { posts, load, create, like, comment, loading };
}
