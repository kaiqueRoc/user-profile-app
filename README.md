# User Profile App - Nível Sênior

Este projeto evolui a aplicação para uma **arquitetura de microsserviços**, com foco em escalabilidade e performance.

## 📌 Decisões Técnicas

- **Arquitetura:** Microsserviços em Go (auth, profiles, posts).
- **Comunicação:** REST + WebSocket para atualizações em tempo real.
- **Banco de dados:** PostgreSQL centralizado para persistência.
- **Mensageria:** RabbitMQ para filas assíncronas (postagens e reações).
- **Cache:** Redis para acelerar consultas.
- **Frontend:** Next.js, otimizado com atualização em tempo real.
- **Funcionalidade offline:** Implementada com Service Workers.
- **Monitoramento:** Logs estruturados + suporte a ELK Stack (Kibana).
- **Testes:** Unitários e de integração para múltiplos serviços.

## 🚀 Funcionalidades Implementadas

- Todas as funcionalidades do nível Pleno.
- Microsserviços independentes (`auth-service`, `post-service`, `profile-service`).
- Atualizações em tempo real via WebSocket.
- Funcionamento offline (Service Workers).
- Monitoramento e logs.

## ⚙️ Como Rodar

Use **Docker Compose** para subir a stack completa:
```bash
docker-compose up --build
```

Serviços disponíveis:
- API Gateway → `http://localhost:8080`
- Frontend Next.js → `http://localhost:3000`
- Auth Service → `http://localhost:8081`
- Post Service → `http://localhost:8082`
- Profile Service → `http://localhost:8083`

## ✅ Testes
```bash
npm run test
go test ./...
```