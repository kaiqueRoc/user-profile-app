import { useState, useEffect } from 'react';
import { getApi } from '../utils/api';
import { useRouter } from 'next/router';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // field level errors
  const [errors, setErrors] = useState<{ email?: string; password?: string; general?: string }>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const router = useRouter();
  // redirect logged-in users away from login
  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('token')) router.push('/feed');
  }, []);
  const validate = () => {
    const next: { email?: string; password?: string } = {};
    if (!email.trim()) next.email = 'Informe o email';
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) next.email = 'Email inválido';
    if (!password) next.password = 'Informe a senha';
    else if (password.length < 6) next.password = 'Mínimo 6 caracteres';
    setErrors(e => ({ ...e, ...next, general: undefined }));
    return Object.keys(next).length === 0;
  };
  const submit = async (e: any) => {
    e.preventDefault();
    if (loading) return;
    if (!validate()) return;
    setLoading(true);
    setErrors({});
    try {
      const API = getApi();
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        setErrors({ general: 'Credenciais inválidas' });
        setLoading(false);
        return;
      }
      const data = await res.json();
      localStorage.setItem('token', data.token);
      try { if (data?.user?.displayName) localStorage.setItem('displayName', data.user.displayName); } catch (e) { }
      try {
        const p = await fetch(`${API}/api/profiles/me`, { headers: { Authorization: `Bearer ${data.token}` } }).then(r => r.json()).catch(() => null);
        if (p) {
          try {
            const dn = data?.user?.displayName || localStorage.getItem('displayName');
            const merged = dn && !p.displayName ? { ...p, displayName: dn } : p;
            localStorage.setItem('profile', JSON.stringify(merged));
          } catch (e) { }
        }
      } catch (e) { }
      setSuccess(true);
      setTimeout(() => {
        try { window.dispatchEvent(new Event('auth-changed')); } catch (e) { }
        router.push('/');
      }, 400);
    } catch (err) {
      setErrors({ general: 'Erro ao conectar' });
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <h1 className="auth-title">Entrar</h1>
        <p className="auth-note">Acesse sua conta para continuar</p>
        <form onSubmit={submit} className="auth-form" noValidate>
          <div>
            <input className="glass-input" placeholder="Email" value={email} onChange={e=>{ setEmail(e.target.value); if(errors.email) setErrors(er=>({...er,email:undefined})); }} />
            {errors.email && <div className="field-error">{errors.email}</div>}
          </div>
          <div>
            <input className="glass-input" placeholder="Senha" type="password" value={password} onChange={e=>{ setPassword(e.target.value); if(errors.password) setErrors(er=>({...er,password:undefined})); }} />
            {errors.password && <div className="field-error">{errors.password}</div>}
          </div>
          {errors.general && <div className="field-error" style={{marginTop:-4}}>{errors.general}</div>}
          <div className="auth-actions"><button className="primary" style={{minWidth:160}} type="submit" disabled={loading}>{success ? 'Sucesso!' : (loading ? 'Entrando...' : 'Entrar')}</button></div>
        </form>
        <div style={{textAlign:'center',marginTop:12,fontSize:13,opacity:.7}}>Não tem conta? <a href="/register" style={{color:'var(--accent-2)',textDecoration:'none'}}>Criar agora</a></div>
      </div>
    </div>
  );
}
