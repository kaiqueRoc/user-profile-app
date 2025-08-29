package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"bytes"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/julienschmidt/httprouter"
)

// DB define a porção usada do pool para possibilitar mocks em testes.
type DB interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

type App struct { DB DB }

type Profile struct {
	ID string `json:"id"`
	UserID string `json:"userId"`
	Bio string `json:"bio"`
	AvatarURL string `json:"avatarUrl"`
	FollowersCount int `json:"followersCount"`
	FollowingCount int `json:"followingCount"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (a *App) getProfile(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	userID := ps.ByName("id")
	ctx := context.Background()
	row := a.DB.QueryRow(ctx, `SELECT id, user_id, COALESCE(bio,''), COALESCE(avatar_url,''), COALESCE(followers_count,0), COALESCE(following_count,0), created_at, updated_at FROM profiles WHERE user_id=$1`, userID)
	var p Profile
	if err := row.Scan(&p.ID, &p.UserID, &p.Bio, &p.AvatarURL, &p.FollowersCount, &p.FollowingCount, &p.CreatedAt, &p.UpdatedAt); err != nil {
		// se não existe profile mas usuário existe, cria vazio (lazy create)
		var ucount int
		if err2 := a.DB.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE id=$1`, userID).Scan(&ucount); err2 == nil && ucount == 1 {
			newID := uuid.NewString()
			row2 := a.DB.QueryRow(ctx, `INSERT INTO profiles (id, user_id, bio, avatar_url) VALUES ($1,$2,'','') RETURNING id, user_id, COALESCE(bio,''), COALESCE(avatar_url,''), 0, 0, created_at, updated_at`, newID, userID)
			if err3 := row2.Scan(&p.ID, &p.UserID, &p.Bio, &p.AvatarURL, &p.FollowersCount, &p.FollowingCount, &p.CreatedAt, &p.UpdatedAt); err3 == nil {
				json.NewEncoder(w).Encode(p); return
			}
		}
		w.WriteHeader(404); json.NewEncoder(w).Encode(map[string]any{"error":"profile not found"}); return
	}
	json.NewEncoder(w).Encode(p)
}

func (a *App) putProfile(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
    userID := ps.ByName("id")
    var req map[string]string
    json.NewDecoder(r.Body).Decode(&req)
    bio := req["bio"]
    avatar := req["avatarUrl"]
    ctx := context.Background()
	// valida se usuário existe para evitar FK 23503 com mensagem genérica
	var uexists int
	if err := a.DB.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE id=$1`, userID).Scan(&uexists); err != nil || uexists == 0 {
		http.Error(w, "user not found (relogin)", 400); return
	}
	// Primeiro tenta localizar um profile existente para o user
	rows, err := a.DB.Query(ctx, `SELECT id FROM profiles WHERE user_id=$1`, userID)
	if err != nil {
		http.Error(w, err.Error(), 500); return
	}
	existingIDs := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil { existingIDs = append(existingIDs, id) }
	}
	rows.Close()

	var p Profile
	if len(existingIDs) > 0 {
		// Atualiza o primeiro registro encontrado
		targetID := existingIDs[0]
		row := a.DB.QueryRow(ctx, `UPDATE profiles SET bio=$1, avatar_url=$2, updated_at=NOW() WHERE id=$3 RETURNING id, user_id, COALESCE(bio,''), COALESCE(avatar_url,''), COALESCE(followers_count,0), COALESCE(following_count,0), created_at, updated_at`, bio, avatar, targetID)
			if err := row.Scan(&p.ID, &p.UserID, &p.Bio, &p.AvatarURL, &p.FollowersCount, &p.FollowingCount, &p.CreatedAt, &p.UpdatedAt); err != nil {
			log.Println("update profile error:", err)
			http.Error(w, "could not update", 500); return
		}
		// Se houver duplicados extra, remove-os silenciosamente
		if len(existingIDs) > 1 {
			for _, dupID := range existingIDs[1:] { a.DB.Exec(ctx, `DELETE FROM profiles WHERE id=$1`, dupID) }
		}
	} else {
		// Insere novo
		newID := uuid.NewString()
		row := a.DB.QueryRow(ctx, `INSERT INTO profiles (id, user_id, bio, avatar_url) VALUES ($1,$2,$3,$4) RETURNING id, user_id, COALESCE(bio,''), COALESCE(avatar_url,''), 0, 0, created_at, updated_at`, newID, userID, bio, avatar)
		if err := row.Scan(&p.ID, &p.UserID, &p.Bio, &p.AvatarURL, &p.FollowersCount, &p.FollowingCount, &p.CreatedAt, &p.UpdatedAt); err != nil {
			if pgErr, ok := err.(*pgconn.PgError); ok && pgErr.Code == "23503" {
				http.Error(w, "foreign key violation user (relogin)", 400); return
			}
			log.Println("insert profile error:", err)
			http.Error(w, "could not insert", 500); return
		}
	}
	json.NewEncoder(w).Encode(p)
}

func (a *App) addFollow(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	followee := ps.ByName("id")
	var req struct{ FollowerId string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, err.Error(), 400); return }
	if req.FollowerId == "" || followee == "" { http.Error(w, "missing fields", 400); return }
	if req.FollowerId == followee { http.Error(w, "cannot follow self", 400); return }
	ctx := context.Background()
	if _, err := a.DB.Exec(ctx, `INSERT INTO follows (follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, req.FollowerId, followee); err != nil { http.Error(w, err.Error(), 500); return }
	// criar notificação 'follow' para o followee (não se notifica a si mesmo porque já filtramos)
	go func(follower, target string) {
		// buscar display names para payload amigável
		ctx2 := context.Background()
		var followerName string
		_ = a.DB.QueryRow(ctx2, `SELECT COALESCE(NULLIF(display_name,''), split_part(email,'@',1)) FROM users WHERE id=$1`, follower).Scan(&followerName)
		payload := map[string]any{"from": follower, "fromName": followerName}
		b, _ := json.Marshal(map[string]any{"userId": target, "type": "follow", "payload": payload})
		postURL := os.Getenv("POST_SERVICE_URL")
		if postURL == "" { postURL = "http://post-service:8083" }
		// ignorar erros (serviço pode estar temporariamente indisponível)
		http.Post(postURL+"/internal/notifications", "application/json", bytes.NewReader(b))
	}(req.FollowerId, followee)
	w.WriteHeader(204)
}

func (a *App) removeFollow(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	followee := ps.ByName("id")
	var req struct{ FollowerId string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, err.Error(), 400); return }
	if req.FollowerId == "" || followee == "" { http.Error(w, "missing fields", 400); return }
	ctx := context.Background()
	if _, err := a.DB.Exec(ctx, `DELETE FROM follows WHERE follower_id=$1 AND followee_id=$2`, req.FollowerId, followee); err != nil { http.Error(w, err.Error(), 500); return }
	w.WriteHeader(204)
}

func (a *App) listFollowing(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	userId := ps.ByName("id")
	ctx := context.Background()
	rows, err := a.DB.Query(ctx, `SELECT u.id, u.email, u.display_name FROM users u JOIN follows f ON u.id=f.followee_id WHERE f.follower_id=$1`, userId)
	if err != nil { http.Error(w, err.Error(), 500); return }
	defer rows.Close()
	out := []map[string]string{}
	for rows.Next() {
		var id, email, display string
		if err := rows.Scan(&id, &email, &display); err == nil { out = append(out, map[string]string{"id":id,"email":email,"displayName":display}) }
	}
	json.NewEncoder(w).Encode(out)
}

func (a *App) listFollowers(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	userId := ps.ByName("id")
	ctx := context.Background()
	rows, err := a.DB.Query(ctx, `SELECT u.id, u.email, u.display_name FROM users u JOIN follows f ON u.id=f.follower_id WHERE f.followee_id=$1`, userId)
	if err != nil { http.Error(w, err.Error(), 500); return }
	defer rows.Close()
	out := []map[string]string{}
	for rows.Next() {
		var id, email, display string
		if err := rows.Scan(&id, &email, &display); err == nil { out = append(out, map[string]string{"id":id,"email":email,"displayName":display}) }
	}
	json.NewEncoder(w).Encode(out)
}


func main() {
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
	db, err := pgxpool.New(context.Background(), dsn)
	if err != nil { log.Fatal(err) }
	defer db.Close()
	// garantir índice único em user_id
	if _, err := db.Exec(context.Background(), `CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id)`); err != nil {
        log.Println("warn: could not ensure unique index on profiles.user_id:", err)
    }
	app := &App{DB: db}
	r := httprouter.New()
	r.GET("/profiles/:id", app.getProfile)
	r.PUT("/profiles/:id", app.putProfile)
	// follow management
	r.POST("/profiles/:id/follow", app.addFollow)
	r.POST("/profiles/:id/unfollow", app.removeFollow)
	r.GET("/profiles/:id/following", app.listFollowing)
	r.GET("/profiles/:id/followers", app.listFollowers)
	log.Println("profile-service listening :8082")
	http.ListenAndServe(":8082", r)
}
