# User Profile App - Nível Júnior

Este projeto implementa um **monólito em Node.js** com frontend básico em React, atendendo aos requisitos do nível Júnior do desafio.

## 📌 Decisões Técnicas

- **Arquitetura:** Monólito em Node.js (Express).
- **Banco de dados:** SQLite (simples para persistência local).
- **Frontend:** React com tela de perfil e timeline básica.
- **Autenticação:** JWT para login e proteção das rotas.
- **Testes:** Testes unitários básicos nos endpoints principais.
- **Documentação:** Swagger para visualizar e testar a API.

## 🚀 Funcionalidades Implementadas

- CRUD de usuários (perfil).
- Criação de postagens na timeline.
- Reação a postagens (curtidas).
- Exibição da timeline no frontend React.

## ⚙️ Como Rodar

### Backend
```bash
cd packages/monolith-node
npm install
npm run dev
```

### Frontend
```bash
cd packages/frontend-react
npm install
npm run dev
```

Acesse o frontend em: `http://localhost:3000`  
API disponível em: `http://localhost:4000`

## ✅ Testes
```bash
npm run test
```