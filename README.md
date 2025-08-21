# User Profile App - Nível Pleno

Este projeto evolui a versão Júnior para atender aos requisitos do nível Pleno do desafio.

## 📌 Decisões Técnicas

- **Frontend:** Migrado para **Next.js**, oferecendo SSR e melhor performance.
- **Banco de dados:** Alterado para **PostgreSQL** para produção realista.
- **Cache:** Implementado **Redis** para cache de postagens mais acessadas.
- **Testes:** Adicionados testes de integração, cobrindo fluxo de autenticação + CRUD.
- **Documentação:** API documentada com Swagger.

## 🚀 Funcionalidades Implementadas

- Todas do nível Júnior.
- Migração para Next.js com UI mais responsiva.
- Persistência em PostgreSQL.
- Cache em Redis para operações de leitura.
- Testes de integração.

## ⚙️ Como Rodar

### Banco de Dados
Crie o banco PostgreSQL:
```sql
CREATE DATABASE user_profile_app;
```

Execute as migrations:
```bash
npm run migrate
```

### Backend
```bash
cd packages/api-node
npm install
npm run dev
```

### Frontend
```bash
cd packages/frontend-nextjs
npm install
npm run dev
```

Acesse em: `http://localhost:3000`

## ✅ Testes
```bash
npm run test
```