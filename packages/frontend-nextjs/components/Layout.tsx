import Link from 'next/link';
import React, { useEffect, useState, useMemo } from 'react';
import Head from 'next/head';
import { getApi, getWsUrl } from '../utils/api';
import { useRouter } from 'next/router';

export default function Layout({ children, title = 'User Profile App' }: any) {
  const [token, setToken] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [badgeCount, setBadgeCount] = useState(0);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [showNotifs, setShowNotifs] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const router = useRouter();
  const initials = useMemo(() => {
    const src = (displayName || '').trim();
    if (!src) return '';
    const parts = src.split(/\s+/).slice(0,2);
    const letters = parts.map(p=>p[0]).join('').toUpperCase();
    return letters || src.slice(0,2).toUpperCase();
  }, [displayName]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setToken(localStorage.getItem('token'));
      try {
        const p = JSON.parse(localStorage.getItem('profile') || 'null');
        const token = localStorage.getItem('token');
        // se profile não pertence ao token atual, não usar avatar para evitar mostrar de outro usuário
        let tokenUser: string | null = null;
        if (token) {
          try { const payload = JSON.parse(atob(token.split('.')[1]||'')); tokenUser = payload.sub || payload.userId || payload.id || null; } catch(_){}
        }
        if (tokenUser && p?.userId && p.userId !== tokenUser) {
          // perfil desatualizado / outro usuário: limpar
          setDisplayName(null);
          setAvatarUrl(null);
        } else {
          const dn = p?.displayName || localStorage.getItem('displayName');
          setDisplayName(dn || null);
          const av = p?.avatarUrl || '';
          setAvatarUrl(av || null);
          if (av) { try { localStorage.setItem('avatarUrl', av); } catch(_){} } else { try { localStorage.removeItem('avatarUrl'); } catch(_){} }
        }
  // (persistência do avatar já tratada acima na lógica nova; removido bloco antigo)
      } catch(e) {}
  const c = parseInt(localStorage.getItem('notifications_unread') || '0', 10) || 0;
  setBadgeCount(c);
  // fetch initial notifications to sync (optional, quietly)
  fetchNotifications().catch(()=>{});
      // open websocket to update badge in realtime (if backend ws provided)
      try {
  const wsBase = getWsUrl();
        if (wsBase) {
          let ws: WebSocket | null = null;
          let reconnectTimeout = 1000;
          const pendingQueue: any[] = [];
          const processQueue = () => {
            if (!pendingQueue.length) return;
            const copy = pendingQueue.splice(0, pendingQueue.length);
            copy.forEach(handleIncoming);
          };
          const handleIncoming = (msg: any) => {
            if (msg.type === 'notification_created') {
              const n = msg.notification || { id: msg.notificationId, userId: msg.userId, type: msg.notificationType || msg.payload?.type || msg.typeDetail || 'generic', payload: msg.payload, read: false, createdAt: new Date().toISOString() };
              const curUserId = (() => { try { const p = JSON.parse(localStorage.getItem('profile')||'null'); return p?.userId; } catch(e){return null;} })();
              if (n.userId && curUserId && n.userId !== curUserId) return;
              try { const actor = n.payload?.from; if (actor && curUserId && actor === curUserId) return; } catch(e) {}
              setNotifications(prev => prev.some(x=>x.id===n.id)? prev : [n, ...prev]);
              const next = (parseInt(localStorage.getItem('notifications_unread') || '0', 10) || 0) + 1;
              localStorage.setItem('notifications_unread', String(next));
              setBadgeCount(next);
            }
          };
          const connect = () => {
            try {
              const token = localStorage.getItem('token');
              if (!token) {
                console.log('No token available for WebSocket connection');
                return; // Não tentar conectar sem token
              }
              const tokenParam = `?token=${encodeURIComponent(token)}`;
              ws = new WebSocket(wsBase + tokenParam);
              ws.onopen = () => { 
                reconnectTimeout = 1000; 
                console.log('WebSocket connected successfully');
              };
              ws.onmessage = (ev) => { try { const msg = JSON.parse(ev.data); handleIncoming(msg); } catch(e){} };
              ws.onclose = (event) => { 
                console.log('WebSocket closed:', event.code, event.reason);
                if (localStorage.getItem('token')) { // Só reconectar se ainda houver token
                  setTimeout(connect, reconnectTimeout); 
                  reconnectTimeout = Math.min(30000, reconnectTimeout * 1.5); 
                }
              };
              ws.onerror = (error) => { 
                console.error('WebSocket error:', error);
                try { ws?.close(); } catch (e) {} 
              };
            } catch (e) { 
              console.error('WebSocket connection error:', e);
              if (localStorage.getItem('token')) {
                setTimeout(connect, reconnectTimeout); 
              }
            }
          };
          connect();
        }
      } catch (e) {}
    }
  }, []);

  // Escutar mudanças de autenticação (login/logout) sem precisar de refresh
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleAuthChange = () => {
      const tok = localStorage.getItem('token');
      setToken(tok);
      try {
        const p = JSON.parse(localStorage.getItem('profile') || 'null');
        const token = localStorage.getItem('token');
        let tokenUser: string | null = null;
        if (token) {
          try { const payload = JSON.parse(atob(token.split('.')[1]||'')); tokenUser = payload.sub || payload.userId || payload.id || null; } catch(_){}
        }
        if (tokenUser && p?.userId && p.userId !== tokenUser) {
          setDisplayName(null);
          setAvatarUrl(null);
        } else {
          const dn = p?.displayName || localStorage.getItem('displayName');
          setDisplayName(dn || null);
          const av = p?.avatarUrl || '';
          setAvatarUrl(av || null);
          if (av) { try { localStorage.setItem('avatarUrl', av); } catch(_){} } else { try { localStorage.removeItem('avatarUrl'); } catch(_){} }
        }
      } catch (e) {}
      // Atualiza notificações e badge ao mudar auth
      if (tok) {
        fetchNotifications().catch(()=>{});
      } else {
        setNotifications([]);
        setBadgeCount(0);
        try { localStorage.removeItem('notifications_unread'); } catch(e){}
      }
    };
    window.addEventListener('auth-changed', handleAuthChange as any);
    window.addEventListener('profile-updated', handleAuthChange as any);
    window.addEventListener('storage', handleAuthChange); // multi-abas
    return () => {
      window.removeEventListener('auth-changed', handleAuthChange as any);
      window.removeEventListener('profile-updated', handleAuthChange as any);
      window.removeEventListener('storage', handleAuthChange);
    };
  }, []);

  // Recarrega notificações quando token muda (ex: login inicial) se ainda não carregado
  useEffect(() => {
    if (!token) return;
    // Evita dupla chamada se já tem lista
    if (notifications.length === 0) {
      fetchNotifications().catch(()=>{});
    }
  }, [token]);

  const logout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
  try { localStorage.removeItem('profile'); } catch(e) {}
  try { localStorage.removeItem('avatarUrl'); } catch(e) {}
  setAvatarUrl(null);
      setToken(null);
  try { window.dispatchEvent(new Event('auth-changed')); } catch(e) {}
      router.push('/login');
    }
  };

  const fetchNotifications = async (userId?: string | null) => {
    // determine userId: explicit param, profile in storage, or decode token
    let uid = userId;
    try {
      if (!uid) {
        const p = JSON.parse(localStorage.getItem('profile') || 'null'); uid = p?.userId;
      }
    } catch (e) { /* ignore */ }
    if (!uid) {
      // try to parse JWT from localStorage to extract sub
      const tok = localStorage.getItem('token');
      if (tok) {
        try {
          const payload = JSON.parse(atob(tok.split('.')[1]));
          uid = payload.sub || payload.userId || payload.id || null;
        } catch (e) { /* ignore */ }
      }
    }
    if (!uid) return;
  const API = getApi();
    try {
      const res = await fetch(`${API}/api/notifications/${uid}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      if (res.ok) {
        const list = await res.json();
        setNotifications(list || []);
        const unread = Array.isArray(list) ? list.filter((n:any) => !n.read).length : 0;
        setBadgeCount(unread);
        try { localStorage.setItem('notifications_unread', String(unread)); } catch(e) {}
      } else {
        console.warn('fetchNotifications failed', res.status, await res.text().catch(()=>'<no-body>'));
        setNotifications([]);
      }
    } catch (e) { console.warn('fetchNotifications error', String(e)); setNotifications([]); }
  };

  const formatNotification = (n: any) => {
    try {
      const p = n.payload || {};
      const from = p.fromName || p.displayName || p.from || 'Alguém';
      if (n.type === 'like') return `${from} curtiu seu post`;
      if (n.type === 'comment') return `${from} comentou: "${String(p.comment || '').slice(0,80)}"`;
      if (n.type === 'follow') return `${from} começou a seguir você`;
      return typeof p === 'object' ? JSON.stringify(p) : String(p);
    } catch (e) { return '' }
  };

  const toggleNotifs = async () => {
    setShowNotifs(s => !s);
    if (!showNotifs) {
      setLoadingNotifs(true);
      await fetchNotifications().catch(()=>{});
      setLoadingNotifs(false);
      // marcar como lidas localmente (simples)
      try {
        // persistir no backend (marcar todas como lidas) para não voltar após refresh
        const uid = (() => { try { const p = JSON.parse(localStorage.getItem('profile')||'null'); return p?.userId; } catch(e){return null;} })();
        const token = localStorage.getItem('token');
        if (uid && token) {
          const API = getApi();
          await fetch(`${API}/api/notifications/${uid}/read-all`, { method:'POST', headers: { Authorization: `Bearer ${token}` } });
        }
      } catch(e) {}
      try { localStorage.setItem('notifications_unread', '0'); } catch(e) {}
      setBadgeCount(0);
    }
  }

  // close dropdown when clicking outside
  useEffect(() => {
    const onDoc = (ev: MouseEvent) => {
      const el = (ev.target as HTMLElement);
      if (!el) return;
      if (!el.closest) return;
      // if click is outside notif dropdown and notif button, close
      if (!el.closest('.notif-dropdown') && !el.closest('.notif-btn')) {
        setShowNotifs(false);
      }
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  const isAuthed = !!token;
  return (
    <div className="container">
      <Head>
        <title>{title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <header className="header">
        <div className="brand">
          <div className="logo">UP</div>
          <div>
            <div style={{fontWeight:700}}>{title}</div>
            <div className="muted" style={{fontSize:12}}>simple social profiles</div>
          </div>
        </div>
      
          {/* User chip + single notifications bell */}
          <nav style={{display:'flex',alignItems:'center',gap:16,marginLeft:24}}>
            {isAuthed ? (
              <>
                <Link href="/feed" aria-label="Feed" className="icon-btn" style={router.pathname.startsWith('/feed') ? {background:'rgba(255,255,255,0.08)'} : {}}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></svg>
                </Link>
                <Link href="/profile" aria-label="Perfil" className="icon-btn" style={router.pathname.startsWith('/profile') ? {background:'rgba(255,255,255,0.08)'} : {}}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8.5" r="4"/><path d="M4.5 20c1.8-3.5 5-5.5 7.5-5.5s5.7 2 7.5 5.5"/></svg>
                </Link>
              </>
            ) : (
              <>
                <Link href="/login" aria-label="Login" className="icon-btn" style={router.pathname.startsWith('/login') ? {background:'rgba(255,255,255,0.08)'} : {}}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h3a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-3"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>
                </Link>
                <Link href="/register" aria-label="Registrar" className="icon-btn" style={router.pathname.startsWith('/register') ? {background:'rgba(255,255,255,0.08)'} : {}}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Z"/><path d="M2 21a9.94 9.94 0 0 1 10-7 9.94 9.94 0 0 1 10 7"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>
                </Link>
              </>
            )}
          </nav>
          {isAuthed && <div style={{display:'flex',alignItems:'center',gap:12,marginLeft:12}}>
            <Link href="/profile" className="user-chip" style={{display:'flex',alignItems:'center',gap:8,textDecoration:'none',cursor:'pointer'}}>
              {avatarUrl ? (
                <img className="chip-avatar" src={avatarUrl} alt="avatar" />
              ) : (
                <div style={{width:28,height:28,borderRadius:'50%',background:'rgba(255,255,255,0.12)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:600,letterSpacing:.5,color:'#fff'}}>{initials || '?'}</div>
              )}
              <span className="chip-name">{displayName || 'Perfil'}</span>
            </Link>
            <button className="icon-btn notif-btn" onClick={toggleNotifs} aria-label="Notificações">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6v-5a7 7 0 1 0-14 0v5l-2 2v1h18v-1l-2-2Z" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
              {badgeCount>0 && <span className="notif-badge">{badgeCount}</span>}
            </button>
            <button onClick={logout} className="primary">Sair</button>
          </div>}

          {showNotifs && (
            <div className="notif-dropdown">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <strong>Notificações</strong>
                <div style={{display:'flex',gap:8}}>
                  <button className="link" onClick={async ()=>{
                    // limpar servidor
                    try {
                      const uid = (() => { try { const p = JSON.parse(localStorage.getItem('profile')||'null'); return p?.userId; } catch(e){return null;} })();
                      const token = localStorage.getItem('token');
                      if (uid && token) {
                        const API = getApi();
                        await fetch(`${API}/api/notifications/${uid}/clear`, { method:'POST', headers:{ Authorization:`Bearer ${token}` }});
                      }
                    } catch(e) {}
                    setNotifications([]); setBadgeCount(0);
                  }}>Limpar</button>
                  <button className="link" onClick={()=>{setNotifications([]);setBadgeCount(0);setShowNotifs(false);}}>Fechar</button>
                </div>
              </div>
              {loadingNotifs && <div className="muted" style={{fontSize:12}}>Carregando...</div>}
              {!loadingNotifs && notifications.length === 0 && (
                <div className="muted" style={{fontSize:12}}>Sem notificações</div>
              )}
              {!loadingNotifs && notifications.map(n => (
                <div key={n.id || n.createdAt} className={"notif-item " + (n.read ? "" : "unread")}> 
                  <div>{formatNotification(n)}</div>
                  <div className="meta">{new Date(n.createdAt || n.created_at || Date.now()).toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
    
      </header>

      <main className="card">{children}</main>

      <footer style={{marginTop:18,textAlign:'center'}} className="muted">Built with care</footer>
    </div>
  );
}
