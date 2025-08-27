import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

export default function Layout({ children, title = 'User Profile App' }: any) {
  const [token, setToken] = useState(null);
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setToken(localStorage.getItem('token'));
    }
  }, []);

  const logout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      setToken(null);
      router.push('/login');
    }
  };

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
