import Link from 'next/link';

export default function Home() {
  return (
    <div>
      <h1>Bem-vindo</h1>
      <p className="muted">Crie uma conta, publique posts e personalize seu perfil.</p>
      <p style={{marginTop:12}}>
        <Link href="/register">Criar Conta</Link>
      </p>
    </div>
  );
}
