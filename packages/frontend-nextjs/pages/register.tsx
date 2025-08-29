import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { getApi } from '../utils/api';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [errors, setErrors] = useState<{ displayName?: string; email?: string; password?: string; general?: string; success?: string }>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const validate = () => {
    const next: { displayName?: string; email?: string; password?: string } = {};
    if (!displayName.trim()) next.displayName = 'Informe um nome';
    else if (displayName.trim().length < 2) next.displayName = 'Mínimo 2 caracteres';
    if (!email.trim()) next.email = 'Informe o email';
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) next.email = 'Email inválido';
    if (!password) next.password = 'Informe a senha';
    else if (password.length < 6) next.password = 'Mínimo 6 caracteres';
    setErrors(n => ({ ...n, ...next, general: undefined, success: undefined }));
    return Object.keys(next).length === 0;
  };

  const submit = async (e: any) => {
    e.preventDefault();
    if (loading) return;
    if (!validate()) return;
    setLoading(true);
    setErrors({});
    const API = getApi();
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName })
    });
    if (!res.ok) {
      let text = 'Erro ao registrar';
      try {
        const body = await res.json();
        let raw: any = body?.error || body?.message || body;
        if (res.status === 409) {
          text = 'Email já registrado';
        } else if (typeof raw === 'string') {
          text = raw;
        } else {
          try { text = JSON.stringify(raw); } catch { /* ignore */ }
        }
      } catch (_) {}
      setErrors({ general: text });
      setLoading(false);
      return;
    }
    setSuccess(true);
    setErrors({ success: 'Registrado! Redirecionando...' });
    try { window.dispatchEvent(new Event('auth-changed')); } catch (e) { }
    setTimeout(() => router.push('/login'), 900);
  };

  // redirect logged-in users away from register
  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('token')) {
      window.location.href = '/feed';
    }
  }, []);

  return (
    <div className="auth-wrapper" style={{marginTop:0}}>
      <div className="auth-card">
        <h1 className="auth-title">Criar Conta</h1>
        <p className="auth-note">Junte-se à comunidade</p>
        <form onSubmit={submit} className="auth-form" noValidate>
          <div>
            <input className="glass-input" placeholder="Nome de exibição" value={displayName} onChange={e=>{ setDisplayName(e.target.value); if(errors.displayName) setErrors(er=>({...er,displayName:undefined})); }} />
            {errors.displayName && <div className="field-error">{errors.displayName}</div>}
          </div>
          <div>
            <input className="glass-input" placeholder="Email" value={email} onChange={e=>{ setEmail(e.target.value); if(errors.email) setErrors(er=>({...er,email:undefined})); }} />
            {errors.email && <div className="field-error">{errors.email}</div>}
          </div>
            <div>
              <input className="glass-input" placeholder="Senha" type="password" value={password} onChange={e=>{ setPassword(e.target.value); if(errors.password) setErrors(er=>({...er,password:undefined})); }} />
              {errors.password && <div className="field-error">{errors.password}</div>}
            </div>
          {errors.general && <div className="field-error" style={{marginTop:-4}}>{errors.general}</div>}
          {errors.success && <div className="field-success" style={{marginTop:-4}}>{errors.success}</div>}
          <div className="auth-actions"><button className="primary" style={{minWidth:170}} type="submit" disabled={loading}>{success ? 'Sucesso!' : (loading ? 'Criando...' : 'Criar conta')}</button></div>
        </form>
        <div style={{textAlign:'center',marginTop:12,fontSize:13,opacity:.7}}>Já tem conta? <a href="/login" style={{color:'var(--accent-2)',textDecoration:'none'}}>Entrar</a></div>
      </div>
    </div>
  );
}
