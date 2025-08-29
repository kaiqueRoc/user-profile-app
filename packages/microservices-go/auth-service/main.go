package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/julienschmidt/httprouter"
	"golang.org/x/crypto/bcrypt"
)

type App struct {
	DB *pgxpool.Pool
	JWTSecret []byte
	BcryptCost int
}

type User struct {
	ID string `json:"id"`
	Email string `json:"email"`
	DisplayName string `json:"displayName"`
	PasswordHash string `json:"-"`
}

type RegisterReq struct {
	Email string `json:"email"`
	Password string `json:"password"`
	DisplayName string `json:"displayName"`
}

type LoginReq struct {
	Email string `json:"email"`
	Password string `json:"password"`
}

func (a *App) handleRegister(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	var req RegisterReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, err.Error(), 400); return }
	if req.Email == "" || req.Password == "" { http.Error(w, "email and password required", 400); return }
	id := uuid.NewString()
	hash, _ := bcrypt.GenerateFromPassword([]byte(req.Password), a.BcryptCost)
	ctx := context.Background()
	_, err := a.DB.Exec(ctx, `INSERT INTO users (id, email, password_hash, display_name) VALUES ($1,$2,$3,$4)`, id, req.Email, string(hash), req.DisplayName)
	if err != nil {
		// Sanitize duplicate email (unique violation) error
		if pgErr, ok := err.(*pgconn.PgError); ok && pgErr.Code == "23505" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]any{"error": "email already registered"})
			return
		}
		http.Error(w, "could not create user", 500)
		return
	}
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{"id": id, "email": req.Email, "displayName": req.DisplayName})
}

func (a *App) handleLogin(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	var req LoginReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, err.Error(), 400); return }
	ctx := context.Background()
	row := a.DB.QueryRow(ctx, `SELECT id, password_hash, display_name FROM users WHERE email=$1`, req.Email)
	var id, hash, display string
	if err := row.Scan(&id, &hash, &display); err != nil { http.Error(w, "invalid credentials", 401); return }
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil { http.Error(w, "invalid credentials", 401); return }
	claims := jwt.MapClaims{"sub": id, "email": req.Email, "exp": time.Now().Add(24*time.Hour).Unix()}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	t, _ := token.SignedString(a.JWTSecret)
	json.NewEncoder(w).Encode(map[string]any{"token": t, "user": map[string]string{"id": id, "email": req.Email, "displayName": display}})
}

func (a *App) handleValidate(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	auth := r.Header.Get("Authorization")
	if len(auth) < 8 || subtle.ConstantTimeCompare([]byte(auth[:7]), []byte("Bearer ")) != 1 {
		http.Error(w, "missing token", 401); return
	}
	token := auth[7:]
	parsed, err := jwt.Parse(token, func(t *jwt.Token) (any, error) { return a.JWTSecret, nil })
	if err != nil || !parsed.Valid { http.Error(w, "invalid", 401); return }
	json.NewEncoder(w).Encode(map[string]any{"valid": true})
}

func (a *App) handleSearchUsers(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	q := r.URL.Query().Get("query")
	ctx := context.Background()
	if q == "" {
		json.NewEncoder(w).Encode([]map[string]string{})
		return
	}
	like := "%" + q + "%"
	rows, err := a.DB.Query(ctx, `SELECT id, email, display_name FROM users WHERE email ILIKE $1 OR display_name ILIKE $1 LIMIT 50`, like)
	if err != nil { http.Error(w, err.Error(), 500); return }
	defer rows.Close()
	out := []map[string]string{}
	for rows.Next() {
		var id, email, display string
		if err := rows.Scan(&id, &email, &display); err == nil {
			out = append(out, map[string]string{"id": id, "email": email, "displayName": display})
		}
	}
	json.NewEncoder(w).Encode(out)
}

func main() {
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" { log.Fatal("JWT_SECRET required") }
	cost := 12
	if os.Getenv("BCRYPT_COST") != "" { v := os.Getenv("BCRYPT_COST"); if v == "10" { cost = 10 } else if v == "12" { cost = 12 } }
	user := os.Getenv("DB_USER")
	pass := os.Getenv("DB_PASSWORD")
	host := os.Getenv("DB_HOST")
	port := os.Getenv("DB_PORT")
	name := os.Getenv("DB_NAME")
	if user == "" { user = "app" }
	if host == "" { host = "db" }
	if port == "" { port = "5432" }
	if name == "" { name = "appdb" }
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable", user, pass, host, port, name)
	ctx := context.Background()
	db, err := pgxpool.New(ctx, dsn)
	if err != nil { log.Fatalf("db connect error: %v", err) }
	defer db.Close()
	app := &App{DB: db, JWTSecret: []byte(jwtSecret), BcryptCost: cost}

	// Auto seed: if no users, create a demo user + profile + sample posts
	go func() {
		ctx := context.Background()
		var count int
		if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&count); err == nil && count == 0 {
			uid := "11111111-1111-1111-1111-111111111111"
			pass := "demo123"
			hash, _ := bcrypt.GenerateFromPassword([]byte(pass), cost)
			if _, err := db.Exec(ctx, `INSERT INTO users (id,email,password_hash,display_name) VALUES ($1,$2,$3,$4)`, uid, "demo@example.com", string(hash), "Demo"); err == nil {
				// profile
				_, _ = db.Exec(ctx, `INSERT INTO profiles (id, user_id, bio, avatar_url) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, uuid.NewString(), uid, "Perfil demo inicial. Edite sua bio.", "")
				// posts de exemplo
				p1 := uuid.NewString(); p2 := uuid.NewString()
				_, _ = db.Exec(ctx, `INSERT INTO posts (id, user_id, content) VALUES ($1,$2,$3)`, p1, uid, "Bem-vindo! Este é um post de exemplo.")
				_, _ = db.Exec(ctx, `INSERT INTO posts (id, user_id, content) VALUES ($1,$2,$3)`, p2, uid, "Segundo post de exemplo. Crie sua própria conta para testar.")
				log.Println("seed: demo user created (demo@example.com / demo123)")
			}
		}
	}()
	router := httprouter.New()
	router.POST("/register", app.handleRegister)
	router.POST("/login", app.handleLogin)
	router.GET("/validate", app.handleValidate)
	// expose user search for other services / UI
	router.GET("/users", app.handleSearchUsers)
	log.Println("auth-service listening :8081")
	http.ListenAndServe(":8081", router)
}
