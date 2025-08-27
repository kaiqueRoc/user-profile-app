package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/julienschmidt/httprouter"
	"github.com/redis/go-redis/v9"
)

type App struct {
	DB *pgxpool.Pool
	Rdb *redis.Client
	Hub *Hub
}

type Post struct {
	ID string `json:"id"`
	UserID string `json:"userId"`
	Content string `json:"content"`
	CreatedAt time.Time `json:"createdAt"`
	Likes int `json:"likes"`
}

type CreatePostReq struct {
	UserID string `json:"userId"`
	Content string `json:"content"`
}

type LikeReq struct { UserID string `json:"userId"` }

// WebSocket Hub
type Hub struct { clients map[*websocket.Conn]bool; broadcast chan []byte; upgrader websocket.Upgrader }
func NewHub() *Hub {
	return &Hub{clients: map[*websocket.Conn]bool{}, broadcast: make(chan []byte, 128), upgrader: websocket.Upgrader{ CheckOrigin: func(r *http.Request) bool { return true } }}
}
func (h *Hub) Run() { for msg := range h.broadcast { for c := range h.clients { c.WriteMessage(websocket.TextMessage, msg) } } }

func (a *App) ws(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	c, err := a.Hub.upgrader.Upgrade(w, r, nil); if err != nil { return }
	a.Hub.clients[c] = true
	c.SetCloseHandler(func(code int, text string) error { delete(a.Hub.clients, c); return nil })
}

func (a *App) listPosts(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	ctx := context.Background()
	feedFor := r.URL.Query().Get("feedFor")
	key := "posts:latest"
	if feedFor != "" { key = "posts:latest:for:" + feedFor }
	if cached, err := a.Rdb.Get(ctx, key).Bytes(); err == nil {
		w.Header().Set("Content-Type", "application/json"); w.Write(cached); return
	}
	var rows pgx.Rows
	var err error
	if feedFor == "" {
		rows, err = a.DB.Query(ctx, `SELECT p.id, p.user_id, p.content, p.created_at, COALESCE(l.count,0) FROM posts p
			LEFT JOIN (SELECT post_id, COUNT(*) as count FROM likes GROUP BY post_id) l ON p.id=l.post_id
			ORDER BY p.created_at DESC LIMIT 50`)
	} else {
		rows, err = a.DB.Query(ctx, `SELECT p.id, p.user_id, p.content, p.created_at, COALESCE(l.count,0) FROM posts p
			LEFT JOIN (SELECT post_id, COUNT(*) as count FROM likes GROUP BY post_id) l ON p.id=l.post_id
			WHERE p.user_id IN (SELECT followee_id FROM follows WHERE follower_id=$1)
			ORDER BY p.created_at DESC LIMIT 50`, feedFor)
	}
	if err != nil { http.Error(w, err.Error(), 500); return }
	defer rows.Close()
	var out []Post
	for rows.Next() {
		var p Post; if err := rows.Scan(&p.ID, &p.UserID, &p.Content, &p.CreatedAt, &p.Likes); err == nil { out = append(out, p) }
	}
	b, _ := json.Marshal(out)
	a.Rdb.Set(ctx, key, b, 30*time.Second)
	w.Header().Set("Content-Type", "application/json"); w.Write(b)
}

func (a *App) createPost(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	var req CreatePostReq; if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, err.Error(), 400); return }
	if req.UserID == "" || req.Content == "" { http.Error(w, "missing fields", 400); return }
	ctx := context.Background()
	id := uuid.NewString()
	_, err := a.DB.Exec(ctx, `INSERT INTO posts (id, user_id, content) VALUES ($1,$2,$3)`, id, req.UserID, req.Content)
	if err != nil { http.Error(w, err.Error(), 500); return }
	// bust cache + broadcast
	a.Rdb.Del(ctx, "posts:latest")
	msg, _ := json.Marshal(map[string]any{"type":"post_created","id":id,"userId":req.UserID})
	a.Hub.broadcast <- msg
	w.WriteHeader(201); json.NewEncoder(w).Encode(map[string]string{"id": id})
}

func (a *App) likeToggle(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	postID := ps.ByName("id")
	var req LikeReq; if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, err.Error(), 400); return }
	ctx := context.Background()
	// toggle like
	var exists int
	a.DB.QueryRow(ctx, `SELECT COUNT(*) FROM likes WHERE user_id=$1 AND post_id=$2`, req.UserID, postID).Scan(&exists)
	if exists > 0 {
		_, _ = a.DB.Exec(ctx, `DELETE FROM likes WHERE user_id=$1 AND post_id=$2`, req.UserID, postID)
	} else {
		_, _ = a.DB.Exec(ctx, `INSERT INTO likes (user_id, post_id) VALUES ($1,$2)`, req.UserID, postID)
	}
	// bust + broadcast + notify post owner
	a.Rdb.Del(ctx, "posts:latest")
	// find post owner
	var owner string
	a.DB.QueryRow(ctx, `SELECT user_id FROM posts WHERE id=$1`, postID).Scan(&owner)
	if owner != "" && owner != req.UserID {
		nid := uuid.NewString()
		payload, _ := json.Marshal(map[string]any{"postId": postID, "from": req.UserID})
		a.DB.Exec(ctx, `INSERT INTO notifications (id,user_id,type,payload) VALUES ($1,$2,$3,$4)`, nid, owner, "like", payload)
	}
	msg, _ := json.Marshal(map[string]any{"type":"post_liked","postId":postID,"userId":req.UserID})
	a.Hub.broadcast <- msg
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (a *App) addComment(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	postID := ps.ByName("id")
	var req struct{ UserID, Content string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, err.Error(), 400); return }
	if req.UserID == "" || req.Content == "" { http.Error(w, "missing fields", 400); return }
	ctx := context.Background()
	// check follower relationship: only allow commenting if req.UserID follows the post owner
	var owner string
	a.DB.QueryRow(ctx, `SELECT user_id FROM posts WHERE id=$1`, postID).Scan(&owner)
	if owner == "" {
		http.Error(w, "post not found", 404); return
	}
	var follows int
	if err := a.DB.QueryRow(ctx, `SELECT COUNT(*) FROM follows WHERE follower_id=$1 AND followee_id=$2`, req.UserID, owner).Scan(&follows); err != nil {
		http.Error(w, err.Error(), 500); return
	}
	if follows == 0 {
		http.Error(w, "only followers can comment", 403); return
	}
	id := uuid.NewString()
	if _, err := a.DB.Exec(ctx, `INSERT INTO comments (id, post_id, user_id, content) VALUES ($1,$2,$3,$4)`, id, postID, req.UserID, req.Content); err != nil { http.Error(w, err.Error(), 500); return }
	// bust cache + notify owner
	a.Rdb.Del(ctx, "posts:latest")
	if owner != "" && owner != req.UserID {
		nid := uuid.NewString()
		payload, _ := json.Marshal(map[string]any{"postId": postID, "commentId": id, "from": req.UserID})
		a.DB.Exec(ctx, `INSERT INTO notifications (id,user_id,type,payload) VALUES ($1,$2,$3,$4)`, nid, owner, "comment", payload)
	}
	msg, _ := json.Marshal(map[string]any{"type":"post_commented","postId":postID,"commentId":id,"userId":req.UserID})
	a.Hub.broadcast <- msg
	json.NewEncoder(w).Encode(map[string]string{"id": id})
}

func (a *App) deletePost(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	postID := ps.ByName("id")
	var req struct{ UserID string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, err.Error(), 400); return }
	if req.UserID == "" { http.Error(w, "missing user id", 400); return }
	ctx := context.Background()
	var owner string
	if err := a.DB.QueryRow(ctx, `SELECT user_id FROM posts WHERE id=$1`, postID).Scan(&owner); err != nil {
		http.Error(w, "post not found", 404); return
	}
	if owner != req.UserID {
		http.Error(w, "forbidden", 403); return
	}
	if _, err := a.DB.Exec(ctx, `DELETE FROM posts WHERE id=$1`, postID); err != nil {
		http.Error(w, err.Error(), 500); return
	}
	// bust cache and broadcast deletion
	a.Rdb.Del(ctx, "posts:latest")
	msg, _ := json.Marshal(map[string]any{"type":"post_deleted","postId":postID})
	a.Hub.broadcast <- msg
	w.WriteHeader(204)
}

func (a *App) listNotifications(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	userID := ps.ByName("id")
	ctx := context.Background()
	rows, err := a.DB.Query(ctx, `SELECT id, type, payload, read, created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, userID)
	if err != nil { http.Error(w, err.Error(), 500); return }
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id string; var ntype string; var payload []byte; var read bool; var createdAt time.Time
		if err := rows.Scan(&id, &ntype, &payload, &read, &createdAt); err == nil {
			var p any; json.Unmarshal(payload, &p)
			out = append(out, map[string]any{"id": id, "type": ntype, "payload": p, "read": read, "createdAt": createdAt})
		}
	}
	json.NewEncoder(w).Encode(out)
}

func (a *App) markNotificationRead(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	id := ps.ByName("id")
	ctx := context.Background()
	if _, err := a.DB.Exec(ctx, `UPDATE notifications SET read=true WHERE id=$1`, id); err != nil { http.Error(w, err.Error(), 500); return }
	w.WriteHeader(204)
}

func main() {
	dsn := "postgres://"+os.Getenv("DB_USER")+":"+os.Getenv("DB_PASSWORD")+"@"+os.Getenv("DB_HOST")+":"+os.Getenv("DB_PORT")+"/"+os.Getenv("DB_NAME")
	db, err := pgxpool.New(context.Background(), dsn)
	if err != nil { log.Fatal(err) }
	defer db.Close()
	rdb := redis.NewClient(&redis.Options{Addr: os.Getenv("REDIS_HOST")+":"+os.Getenv("REDIS_PORT")})
	hub := NewHub()
	go hub.Run()

	app := &App{DB: db, Rdb: rdb, Hub: hub}
	r := httprouter.New()
	r.GET("/posts", app.listPosts)
	r.POST("/posts", app.createPost)
	r.POST("/posts/:id/like", app.likeToggle)
	r.POST("/posts/:id/comments", app.addComment)
	r.GET("/ws", app.ws)
	r.GET("/notifications/:id", app.listNotifications)
	r.POST("/notifications/:id/read", app.markNotificationRead)

	log.Println("post-service listening :8083")
	http.ListenAndServe(":8083", r)
}
