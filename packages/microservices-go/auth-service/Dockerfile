# ---------- Build ----------
FROM golang:1.22-alpine AS build
RUN apk add --no-cache git
WORKDIR /app

COPY go.mod ./
RUN go mod download

COPY . .
RUN go mod tidy && go mod download

RUN CGO_ENABLED=0 GOOS=linux go build -o /service .

# ---------- Test (stage que o compose seleciona) ----------
FROM golang:1.22-alpine AS test
RUN apk add --no-cache git
WORKDIR /app

COPY go.mod ./
RUN go mod download

COPY . .
RUN go mod tidy && go mod download

CMD ["go","test","./..."]

# ---------- Run ----------
FROM alpine:3.20
RUN adduser -D appuser
USER appuser
WORKDIR /home/appuser
COPY --from=build /service ./service
EXPOSE 8081
CMD ["./service"]
