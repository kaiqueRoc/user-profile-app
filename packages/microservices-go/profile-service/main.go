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
