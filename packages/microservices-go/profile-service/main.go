package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/julienschmidt/httprouter"
)

type App struct { DB *pgxpool.Pool }

type Profile struct {
	ID string `json:"id"`
	UserID string `json:"userId"`
	Bio string `json:"bio"`
	AvatarURL string `json:"avatarUrl"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (a *App) getProfile(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	userID := ps.ByName("id")
	ctx := context.Background()
	row := a.DB.QueryRow(ctx, `SELECT id, user_id, COALESCE(bio,''), COALESCE(avatar_url,''), created_at, updated_at FROM profiles WHERE user_id=$1`, userID)
	var p Profile
	if err := row.Scan(&p.ID, &p.UserID, &p.Bio, &p.AvatarURL, &p.CreatedAt, &p.UpdatedAt); err != nil {
		w.WriteHeader(404); json.NewEncoder(w).Encode(map[string]any{"error":"not found"}); return
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

    // upsert (tenta inserir; se já existir, ignora)
    id := uuid.NewString()
    if _, err := a.DB.Exec(ctx, `INSERT INTO profiles (id, user_id, bio, avatar_url)
        VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`, id, userID, bio, avatar); err != nil {
        // opcional: logar, mas não falhar a request
        log.Println("insert (upsert) profile error:", err)
    }

    // update se já existir para o user_id
    if _, err := a.DB.Exec(ctx, `UPDATE profiles SET bio=$1, avatar_url=$2, updated_at=NOW()
        WHERE user_id=$3`, bio, avatar, userID); err != nil {
        log.Println("update profile error:", err)
    }

    row := a.DB.QueryRow(ctx, `SELECT id, user_id, COALESCE(bio,''), COALESCE(avatar_url,''),
        created_at, updated_at FROM profiles WHERE user_id=$1`, userID)
    var p Profile
    if err := row.Scan(&p.ID, &p.UserID, &p.Bio, &p.AvatarURL, &p.CreatedAt, &p.UpdatedAt); err != nil {
        w.WriteHeader(404)
        json.NewEncoder(w).Encode(map[string]any{"error":"not found"})
        return
    }
    json.NewEncoder(w).Encode(p)
}

func (a *App) addFollow(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	followee := ps.ByName("id")
	var req struct{ FollowerId string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, err.Error(), 400); return }
	if req.FollowerId == "" || followee == "" { http.Error(w, "missing fields", 400); return }
	ctx := context.Background()
	if _, err := a.DB.Exec(ctx, `INSERT INTO follows (follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, req.FollowerId, followee); err != nil { http.Error(w, err.Error(), 500); return }
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


func main() {
	dsn := "postgres://"+os.Getenv("DB_USER")+":"+os.Getenv("DB_PASSWORD")+"@"+os.Getenv("DB_HOST")+":"+os.Getenv("DB_PORT")+"/"+os.Getenv("DB_NAME")
	db, err := pgxpool.New(context.Background(), dsn)
	if err != nil { log.Fatal(err) }
	defer db.Close()
	app := &App{DB: db}
	r := httprouter.New()
	r.GET("/profiles/:id", app.getProfile)
	r.PUT("/profiles/:id", app.putProfile)
	log.Println("profile-service listening :8082")
	http.ListenAndServe(":8082", r)
}
