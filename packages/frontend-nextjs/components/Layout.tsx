import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { getApi, getWsUrl } from '../utils/api';
import { useRouter } from 'next/router';

export default function Layout({ children, title = 'User Profile App' }: any) {
  const [token, setToken] = useState(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [badgeCount, setBadgeCount] = useState(0);
  const [showNotifs, setShowNotifs] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setToken(localStorage.getItem('token'));
  try { const p = JSON.parse(localStorage.getItem('profile') || 'null'); setDisplayName(p?.displayName || null); } catch(e) {}
      const c = parseInt(localStorage.getItem('notifications_unread') || '0', 10) || 0;
      setBadgeCount(c);
      // open websocket to update badge in realtime (if backend ws provided)
      try {
  const wsBase = getWsUrl();
        if (wsBase) {
          let ws: WebSocket | null = null;
          let reconnectTimeout = 1000;
          const connect = () => {
            try {
              const tokenParam = localStorage.getItem('token') ? `?token=${encodeURIComponent(localStorage.getItem('token') || '')}` : '';
              ws = new WebSocket(wsBase + tokenParam);
              ws.onopen = () => { reconnectTimeout = 1000; };
              ws.onmessage = (ev) => {
                try {
                  const msg = JSON.parse(ev.data);
                  if (msg.type === 'notification_created') {
                    // only increment if the notification is for the current user
                    const curUserId = (() => { try { const p = JSON.parse(localStorage.getItem('profile')||'null'); return p?.userId; } catch(e){return null;} })();
                    if (!msg.userId || (curUserId && msg.userId !== curUserId)) return;
                    const next = (parseInt(localStorage.getItem('notifications_unread') || '0', 10) || 0) + 1;
                    localStorage.setItem('notifications_unread', String(next));
                    setBadgeCount(next);
                  }
                } catch (e) {}
              };
              ws.onclose = () => { setTimeout(connect, reconnectTimeout); reconnectTimeout = Math.min(30000, reconnectTimeout * 1.5); };
              ws.onerror = () => { try { ws?.close(); } catch (e) {} };
            } catch (e) { setTimeout(connect, reconnectTimeout); }
          };
          connect();
        }
      } catch (e) {}
    }
  }, []);

  const logout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
  try { localStorage.removeItem('profile'); } catch(e) {}
      setToken(null);
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
      const from = p.from || p.displayName || 'Alguém';
      if (n.type === 'like') return `${from} curtiu seu post`;
      if (n.type === 'comment') return `${from} comentou: "${String(p.comment || '').slice(0,80)}"`;
      if (n.type === 'follow') return `${from} começou a seguir você`;
      return typeof p === 'object' ? JSON.stringify(p) : String(p);
    } catch (e) { return '' }
  };

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
        <nav className="nav">
          <Link href="/">Home</Link>
        {token ? (
            <>
              <Link href="/feed">Feed</Link>
              <Link href="/profile">Perfil</Link>
        <div style={{position:'relative', display:'inline-block'}}>
          <button onClick={(e) => { e.stopPropagation(); const p = (() => { try { return JSON.parse(localStorage.getItem('profile')||'null'); } catch(e){return null;} })(); if (!p) { router.push('/login'); return; } setShowNotifs(s => { const next = !s; if (next) fetchNotifications(p.userId); return next; }); }} className="notif-btn" aria-label="Notificações" title="Notificações">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <path d="M15 17H9a2 2 0 0 1-2-2V11a5 5 0 1 1 10 0v4a2 2 0 0 1-2 2z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {badgeCount > 0 && <span className="notif-badge" aria-hidden>{badgeCount}</span>}
          </button>
          {showNotifs && (
            <div className="notif-dropdown" role="dialog" aria-label="Notificações">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <strong>Notificações</strong>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  {badgeCount > 0 && <div style={{fontSize:12,color:'#fff',opacity:.8}}>{badgeCount} não-lida(s)</div>}
                  <button className="primary" style={{fontSize:12,padding:'6px 8px'}} onClick={async () => {
                    // mark all as read
                    const p = (() => { try { return JSON.parse(localStorage.getItem('profile')||'null'); } catch(e){return null;} })();
                    if (!p) return;
                    try {
                      const API_READ = getApi();
                      await Promise.all((notifications||[]).filter(n=>!n.read).map((n:any) => fetch(`${API_READ}/api/notifications/${n.id}/read`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })));
                      const updated = notifications.map(n => ({ ...n, read: true })); setNotifications(updated); setBadgeCount(0); try{ localStorage.setItem('notifications_unread','0'); }catch(e){}
                    } catch(e){}
                  }}>Marcar tudo como lido</button>
                </div>
              </div>
              <div style={{marginTop:8}}>
                {(!notifications || notifications.length === 0) && <div className="muted">Sem notificações</div>}
                {notifications.map(n => (
                  <div key={n.id} className={`notif-item ${!n.read ? 'unread' : ''}`}>
                    <div style={{fontWeight:700}}>{String(n.type)}</div>
                    <div className="meta">{typeof n.payload === 'object' ? JSON.stringify(n.payload) : String(n.payload)}</div>
                    <div style={{marginTop:6,display:'flex',gap:8}}>
                      {!n.read && <button style={{fontSize:12}} onClick={async () => { try { const API_ONE = getApi(); await fetch(`${API_ONE}/api/notifications/${n.id}/read`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }); setNotifications(notifications.map(x=> x.id===n.id ? { ...x, read: true } : x)); setBadgeCount(c => Math.max(0, c-1)); try { localStorage.setItem('notifications_unread', String(Math.max(0, (parseInt(localStorage.getItem('notifications_unread')||'0',10)||0)-1))); } catch(e){} } catch(e){} }}>Marcar como lido</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <span style={{marginLeft:12}}>{displayName || 'Você'}</span>
        <a onClick={logout} style={{cursor:'pointer', marginLeft:12}}>Logout</a>
            </>
          ) : (
            <>
              <Link href="/login">Login</Link>
              <Link href="/register">Criar conta</Link>
            </>
          )}
        </nav>
      </header>

      <main className="card">{children}</main>

      <footer style={{marginTop:18,textAlign:'center'}} className="muted">Built with care</footer>
    </div>
  );
}
