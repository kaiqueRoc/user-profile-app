
# 📘 User Profile App – Senior Challenge

Monorepo fullstack de um sistema de **perfil de usuário com feed/timeline e curtidas**, implementado em arquitetura de **microsserviços**.  
Inclui **frontend (Next.js)**, **API Gateway (Node.js + TS)**, **serviços em Go** para autenticação, perfis e posts, além de **PostgreSQL**, **Redis** e **WebSocket** para tempo real.  
Tudo orquestrado com **Docker Compose**.

---

## 🚀 Stack

- **API Gateway** → Node.js + Express (TypeScript)  
  - JWT Auth, proxy para microserviços, Swagger UI
- **Auth Service** (Go) → cadastro/login/validação de usuários (bcrypt + JWT)  
- **Profile Service** (Go) → CRUD de perfis de usuário  
- **Post Service** (Go) → posts + curtidas + WebSocket + cache Redis  
- **Frontend** → Next.js 14 (React 18)  
  - Registro/login, feed com tempo real, perfil editável, service worker offline  
- **Infra** → PostgreSQL + Redis  
- **DevOps** → Docker + Docker Compose, init SQL automático  
- **Testes** → Jest (Node) e `go test` (serviços Go)

---

## 📂 Estrutura

```
user-profile-app/
├── docker-compose.yml
├── .env.example
├── ops/db/init.sql                # schema inicial (users, profiles, posts, likes)
├── packages/
│   ├── api-node/                  # API Gateway (Node + TS)
│   ├── frontend-nextjs/           # Frontend (Next.js)
│   └── microservices-go/          # Serviços em Go
│       ├── auth-service/          # registro/login
│       ├── profile-service/       # perfis
│       └── post-service/          # posts + likes + WS
```

---

## ⚙️ Como rodar

### 1. Pré-requisitos
- Docker e Docker Compose v2 instalados
- Portas livres: `3000`, `3001`, `8081-8083`, `5432`, `6379`

### 2. Setup
```bash
# clone do repo
git clone <repo_url>
cd user-profile-app

# criar arquivo de variáveis
cp .env.example .env
```

### 3. Subir containers
```bash
docker compose up --build
```

### 4. Acessos
- **Frontend** → http://localhost:3000  
- **API Gateway (health)** → http://localhost:3001/health  
- **Swagger (API)** → http://localhost:3001/docs  
- **WebSocket** → ws://localhost:8083/ws  

---

## 🔑 Fluxo da aplicação

1. **Registrar** usuário em `/register`  
   → salva em `auth-service` + `users` no Postgres  
2. **Login** em `/login`  
   → gera JWT armazenado no `localStorage` do frontend  
3. **Feed** (`/feed`)  
   - Criar posts (persistidos no `post-service`)  
   - Curtir/descurtir posts (toggle com likes)  
   - Atualização **em tempo real** via WebSocket  
4. **Perfil** (`/profile`)  
   - Editar `bio` e `avatar` → persiste no `profile-service`  

---

## 🧪 Testes

### Node (API Gateway)
```bash
docker compose run --rm api-node npm test
```

### Go (exemplo auth-service)
```bash
docker compose run --rm auth-service go test ./...
```

---

## 🛠️ Comandos úteis

- Subir com rebuild forçado:
```bash
docker compose build --no-cache
docker compose up
```

- Derrubar containers + volumes (resetar banco/redis):
```bash
docker compose down -v
```

- Ver logs de um serviço específico:
```bash
docker compose logs -f api-node
docker compose logs -f post-service
```

---

## 🗄️ Banco de Dados

O Postgres é inicializado com `ops/db/init.sql`, criando:
- `users` → id, email, password_hash, display_name  
- `profiles` → id, user_id, bio, avatar_url  
- `posts` → id, user_id, content  
- `likes` → relação N:N usuário ↔ post  

---

## 📡 API Endpoints (via Gateway)

- **Auth**  
  - `POST /api/auth/register`  
  - `POST /api/auth/login`  

- **Profiles**  
  - `GET /api/profiles/me`  
  - `PUT /api/profiles/me`  

- **Posts**  
  - `GET /api/posts`  
  - `POST /api/posts`  
  - `POST /api/posts/:id/like`  

> Documentação detalhada em **Swagger**: [http://localhost:3001/docs](http://localhost:3001/docs)

---

## 🔮 Extras Implementados

- **Service Worker** → cache de feed/perfil offline  
- **Cache Redis** → para listagem de posts (invalida em criação/like)  
- **WebSocket** → notificações de post/like em tempo real  
- **Segurança** → bcrypt configurável (`BCRYPT_COST`), JWT HS256, Helmet, CORS restrito  

---

## 📌 Roadmap futuro (melhorias possíveis)

- Rate limiting + request-id no Gateway  
- Observabilidade → Prometheus/Grafana ou Loki para logs  
- Autenticação centralizada via introspection no `auth-service`  
- CI/CD com testes automáticos antes do deploy  
