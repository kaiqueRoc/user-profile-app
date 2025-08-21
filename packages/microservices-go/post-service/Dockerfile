# Build
FROM golang:1.22-alpine AS build
RUN apk add --no-cache git
WORKDIR /app

# 1) Copia só o go.mod (sem go.sum) para invalidar cache quando mudar dependências
COPY go.mod ./

# 2) Baixa deps declaradas em go.mod (gera cache de módulos)
RUN go mod download

# 3) Agora copia o restante do código (inclui main.go)
COPY . .

# 4) Ajusta módulos com base nos imports reais e garante go.sum
RUN go mod tidy && go mod download

# 5) Build estático
RUN CGO_ENABLED=0 GOOS=linux go build -o /service .

# Run
FROM alpine:3.20
RUN adduser -D appuser
USER appuser
WORKDIR /home/appuser
COPY --from=build /service ./service
EXPOSE 8083
CMD ["./service"]
