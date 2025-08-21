import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL as string;
const WS_URL = process.env.NEXT_PUBLIC_WS_URL as string;

type Post = { id: string; userId: string; content: string; createdAt: string; likes: number };

export default function Feed() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [content, setContent] = useState('');

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const load = async () => {
    const res = await fetch(`${API}/api/posts`);
    if (res.ok) setPosts(await res.json());
  };

  useEffect(() => {
    load();
    try {
      const ws = new WebSocket(WS_URL);
      ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'post_created' || msg.type === 'post_liked') load();
      };
      return () => ws.close();
    } catch {}
  }, []);

  const create = async () => {
    if (!token) { alert('Faça login'); return; }
    const res = await fetch(`${API}/api/posts`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content })
    });
    if (res.ok) {
      setContent('');
      load();
    }
  };

  const like = async (id: string) => {
    if (!token) { alert('Faça login'); return; }
    const res = await fetch(`${API}/api/posts/${id}/like`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ })
    });
    if (res.ok) load();
  };

  return (
    <main style={{padding: 24}}>
      <h1>Feed</h1>
      <div style={{marginBottom: 16}}>
        <textarea placeholder="No que você está pensando?" value={content} onChange={e=>setContent(e.target.value)} />
        <br/>
        <button onClick={create}>Postar</button>
      </div>

      {posts.map(p => (
        <div key={p.id} style={{border:'1px solid #ddd', padding: 12, marginBottom: 8}}>
          <div style={{fontSize:12, opacity:.8}}>{new Date(p.createdAt).toLocaleString()}</div>
          <div>{p.content}</div>
          <button onClick={() => like(p.id)}>Curtir ({p.likes})</button>
        </div>
      ))}
    </main>
  );
}
