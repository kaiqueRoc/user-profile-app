package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func mustConnectTestDB() *pgxpool.Pool {
	host := envOr("DB_HOST", "db")        // dentro do compose, "db" é o hostname correto
	port := envOr("DB_PORT", "5432")
	user := envOr("DB_USER", "postgres")
	pass := envOr("DB_PASSWORD", "postgres")
	name := envOr("DB_NAME", "postgres")  // evite "app" como default se seu init usa outro nome

	dsn := fmt.Sprintf("postgres://%s:%s@%s:%s/%s", user, pass, host, port, name)
	fmt.Println("🔌 tentando Postgres em:", dsn)

	// espera até 90s o DB ficar pronto
	deadline := time.Now().Add(90 * time.Second)
	var lastErr error

	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		db, err := pgxpool.New(ctx, dsn)
		if err == nil {
			// força a abertura com Ping
			pingErr := db.Ping(ctx)
			cancel()
			if pingErr == nil {
				fmt.Println("✅ conectado ao Postgres")
				return db
			}
			lastErr = pingErr
			db.Close()
		} else {
			lastErr = err
			cancel()
		}
		time.Sleep(2 * time.Second)
	}

	panic(fmt.Errorf("não conectou ao Postgres em 90s: %v (verifique envs DB_*)", lastErr))
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
