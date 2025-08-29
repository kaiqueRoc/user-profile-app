package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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
	Comments int `json:"comments"`
	AuthorName string `json:"authorName,omitempty"`
	Liked bool `json:"liked,omitempty"`
}

type CreatePostReq struct {
	UserID string `json:"userId"`
	Content string `json:"content"`
}

type LikeReq struct { UserID string `json:"userId"` }

type UpdatePostReq struct {
	UserID  string `json:"userId"`
	Content string `json:"content"`
}

type Comment struct {
	ID string `json:"id"`
	PostID string `json:"postId"`
	UserID string `json:"userId"`
	Content string `json:"content"`
	CreatedAt time.Time `json:"createdAt"`
	AuthorName string `json:"authorName,omitempty"`
}

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
		rows, err = a.DB.Query(ctx, `SELECT p.id, p.user_id, p.content, p.created_at,
			COALESCE(l.count,0) as likes,
			COALESCE(c.count,0) as comments,
			COALESCE(u.display_name,'') as author_name,
			false as liked
		FROM posts p
		LEFT JOIN (SELECT post_id, COUNT(*) as count FROM likes GROUP BY post_id) l ON p.id=l.post_id
		LEFT JOIN (SELECT post_id, COUNT(*) as count FROM comments GROUP BY post_id) c ON p.id=c.post_id
		LEFT JOIN users u ON p.user_id = u.id
		WHERE p.deleted_at IS NULL
		ORDER BY p.created_at DESC LIMIT 50`)
	} else {
		rows, err = a.DB.Query(ctx, `SELECT p.id, p.user_id, p.content, p.created_at,
			COALESCE(l.count,0) as likes,
			COALESCE(c.count,0) as comments,
			COALESCE(u.display_name,'') as author_name,
			CASE WHEN ul.user_id IS NULL THEN false ELSE true END as liked
		FROM posts p
		LEFT JOIN (SELECT post_id, COUNT(*) as count FROM likes GROUP BY post_id) l ON p.id=l.post_id
		LEFT JOIN (SELECT post_id, COUNT(*) as count FROM comments GROUP BY post_id) c ON p.id=c.post_id
		LEFT JOIN users u ON p.user_id = u.id
		LEFT JOIN likes ul ON ul.post_id = p.id AND ul.user_id = $1
		WHERE p.deleted_at IS NULL AND (p.user_id = $1 OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id=$1))
		ORDER BY p.created_at DESC LIMIT 50`, feedFor)
	}
	if err != nil { http.Error(w, err.Error(), 500); return }
	defer rows.Close()
	var out []Post
	for rows.Next() {
		var p Post; if err := rows.Scan(&p.ID, &p.UserID, &p.Content, &p.CreatedAt, &p.Likes, &p.Comments, &p.AuthorName, &p.Liked); err == nil { out = append(out, p) }
	}
	b, _ := json.Marshal(out)
	a.Rdb.Set(ctx, key, b, 30*time.Second)
	w.Header().Set("Content-Type", "application/json"); w.Write(b)
}

func (a *App) createPost(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	var req CreatePostReq; if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, err.Error(), 400); return }
	if req.UserID == "" || req.Content == "" { http.Error(w, "missing fields", 400); return }
	ctx := context.Background()
	// validate user exists (protect against FK error when DB reset but client has stale token)
	var uexists int
	if err := a.DB.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE id=$1`, req.UserID).Scan(&uexists); err != nil || uexists == 0 {
		http.Error(w, "user not found (stale token?)", 400); return
	}
	id := uuid.NewString()
	_, err := a.DB.Exec(ctx, `INSERT INTO posts (id, user_id, content) VALUES ($1,$2,$3)`, id, req.UserID, req.Content)
	if err != nil {
		if pgErr, ok := err.(*pgconn.PgError); ok && pgErr.Code == "23503" {
			http.Error(w, "invalid user (foreign key) – re-login required", 400); return
		}
		http.Error(w, err.Error(), 500); return
	}
	// fetch created row with author's display name & created_at
	var createdAt time.Time; var authorName string
	a.DB.QueryRow(ctx, `SELECT p.created_at, COALESCE(u.display_name,'') FROM posts p LEFT JOIN users u ON p.user_id=u.id WHERE p.id=$1`, id).Scan(&createdAt, &authorName)
	// bust cache + broadcast
	deleteFeedCaches(ctx, a.Rdb)
	postObj := map[string]any{"id": id, "userId": req.UserID, "content": req.Content, "createdAt": createdAt, "likes": 0, "comments": 0, "authorName": authorName}
	msg, _ := json.Marshal(map[string]any{"type":"post_created","post": postObj})
	a.Hub.broadcast <- msg
	w.WriteHeader(201); json.NewEncoder(w).Encode(postObj)
}

func (a *App) likeToggle(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	postID := ps.ByName("id")
	var req LikeReq; if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, err.Error(), 400); return }
	ctx := context.Background()
	// ensure user exists
	var ucnt int
	if err := a.DB.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE id=$1`, req.UserID).Scan(&ucnt); err != nil || ucnt == 0 {
		http.Error(w, "user not found (stale token?)", 400); return
	}
	// toggle like
	var exists int
	a.DB.QueryRow(ctx, `SELECT COUNT(*) FROM likes WHERE user_id=$1 AND post_id=$2`, req.UserID, postID).Scan(&exists)
	removed := false
	if exists > 0 {
		_, _ = a.DB.Exec(ctx, `DELETE FROM likes WHERE user_id=$1 AND post_id=$2`, req.UserID, postID)
		removed = true
	} else {
		if _, err := a.DB.Exec(ctx, `INSERT INTO likes (user_id, post_id) VALUES ($1,$2)`, req.UserID, postID); err != nil {
			if pgErr, ok := err.(*pgconn.PgError); ok && pgErr.Code == "23503" {
				http.Error(w, "invalid user/post (foreign key)", 400); return
			}
			http.Error(w, err.Error(), 500); return
		}
	}
	// current like count
	var likeCount int
	a.DB.QueryRow(ctx, `SELECT COUNT(*) FROM likes WHERE post_id=$1`, postID).Scan(&likeCount)
	// bust + broadcast + notify post owner
	deleteFeedCaches(ctx, a.Rdb)
	// find post owner & liker display name for nicer notification
	var owner string
	a.DB.QueryRow(ctx, `SELECT user_id FROM posts WHERE id=$1`, postID).Scan(&owner)
	if owner != "" && owner != req.UserID {
		var fromName string
		a.DB.QueryRow(ctx, `SELECT COALESCE(NULLIF(display_name,''), split_part(email,'@',1)) FROM users WHERE id=$1`, req.UserID).Scan(&fromName)
		nid := uuid.NewString()
		payloadMap := map[string]any{"postId": postID, "from": req.UserID, "fromName": fromName}
		payload, _ := json.Marshal(payloadMap)
		a.DB.Exec(ctx, `INSERT INTO notifications (id,user_id,type,payload) VALUES ($1,$2,$3,$4)`, nid, owner, "like", payload)
		// broadcast notification event so clients can update badge in realtime (include same payload + notificationType)
		notifMsg, _ := json.Marshal(map[string]any{"type":"notification_created","userId":owner,"notificationId":nid,"payload":payloadMap, "notificationType":"like"})
		a.Hub.broadcast <- notifMsg
	}
	eventType := "post_liked"
	if removed { eventType = "post_unliked" }
	msg, _ := json.Marshal(map[string]any{"type":eventType,"postId":postID,"userId":req.UserID,"likes": likeCount})
	a.Hub.broadcast <- msg
	json.NewEncoder(w).Encode(map[string]any{"ok": true, "likes": likeCount, "liked": !removed})
}


func (a *App) addComment(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	postID := ps.ByName("id")
	var req struct{ UserID, Content string }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, err.Error(), 400); return }
	if req.UserID == "" || req.Content == "" { http.Error(w, "missing fields", 400); return }
	ctx := context.Background()
	// user existence check
	var ucnt int
	if err := a.DB.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE id=$1`, req.UserID).Scan(&ucnt); err != nil || ucnt == 0 {
		http.Error(w, "user not found (stale token?)", 400); return
	}
	// previous follower restriction removed: allow any authenticated user to comment
	var owner string
	if err := a.DB.QueryRow(ctx, `SELECT user_id FROM posts WHERE id=$1`, postID).Scan(&owner); err != nil || owner == "" {
		http.Error(w, "post not found", 404); return
	}
	id := uuid.NewString()
	if _, err := a.DB.Exec(ctx, `INSERT INTO comments (id, post_id, user_id, content) VALUES ($1,$2,$3,$4)`, id, postID, req.UserID, req.Content); err != nil { http.Error(w, err.Error(), 500); return }
	// bust cache + notify owner
	deleteFeedCaches(ctx, a.Rdb)
	if owner != "" && owner != req.UserID {
		// authorName still empty until we fetch below, fetch early
		var fromName string
		a.DB.QueryRow(ctx, `SELECT COALESCE(NULLIF(display_name,''), split_part(email,'@',1)) FROM users WHERE id=$1`, req.UserID).Scan(&fromName)
		nid := uuid.NewString()
		payloadMap := map[string]any{"postId": postID, "commentId": id, "from": req.UserID, "fromName": fromName, "comment": req.Content}
		payload, _ := json.Marshal(payloadMap)
		a.DB.Exec(ctx, `INSERT INTO notifications (id,user_id,type,payload) VALUES ($1,$2,$3,$4)`, nid, owner, "comment", payload)
		// broadcast (include notificationType)
		notifMsg, _ := json.Marshal(map[string]any{"type":"notification_created","userId":owner,"notificationId":nid,"payload":payloadMap, "notificationType":"comment"})
		a.Hub.broadcast <- notifMsg
	}
	// fetch inserted comment to include created_at
	var createdAt time.Time
	a.DB.QueryRow(ctx, `SELECT created_at FROM comments WHERE id=$1`, id).Scan(&createdAt)
	var authorName string
	a.DB.QueryRow(ctx, `SELECT COALESCE(NULLIF(u.display_name,''), split_part(u.email,'@',1)) FROM users u WHERE u.id=$1`, req.UserID).Scan(&authorName)
	commentPayload := map[string]any{"id": id, "postId": postID, "userId": req.UserID, "content": req.Content, "createdAt": createdAt, "authorName": authorName}
	var ccount int
	a.DB.QueryRow(ctx, `SELECT COUNT(*) FROM comments WHERE post_id=$1`, postID).Scan(&ccount)
	msg, _ := json.Marshal(map[string]any{"type":"post_commented","comment": commentPayload, "postId": postID, "commentCount": ccount})
	a.Hub.broadcast <- msg
	json.NewEncoder(w).Encode(commentPayload)
}

func (a *App) listComments(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	postID := ps.ByName("id")
	if postID == "" { http.Error(w, "missing post id", 400); return }
	ctx := context.Background()
	rows, err := a.DB.Query(ctx, `SELECT c.id, c.post_id, c.user_id, c.content, c.created_at, COALESCE(NULLIF(u.display_name,''), split_part(u.email,'@',1))
		FROM comments c LEFT JOIN users u ON c.user_id=u.id
		WHERE c.post_id=$1 ORDER BY c.created_at ASC LIMIT 100`, postID)
	if err != nil { http.Error(w, err.Error(), 500); return }
	defer rows.Close()
	out := []Comment{}
	for rows.Next() {
		var c Comment
		if err := rows.Scan(&c.ID, &c.PostID, &c.UserID, &c.Content, &c.CreatedAt, &c.AuthorName); err == nil { out = append(out, c) }
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
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
	if _, err := a.DB.Exec(ctx, `UPDATE posts SET deleted_at=NOW() WHERE id=$1`, postID); err != nil {
		http.Error(w, err.Error(), 500); return
	}
	// bust all feed caches and broadcast deletion
	deleteFeedCaches(ctx, a.Rdb)
	msg, _ := json.Marshal(map[string]any{"type":"post_deleted","postId":postID})
	a.Hub.broadcast <- msg
	w.WriteHeader(204)
}

func (a *App) updatePost(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	postID := ps.ByName("id")
	var req UpdatePostReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, err.Error(), 400); return }
	if req.UserID == "" || req.Content == "" { http.Error(w, "missing fields", 400); return }
	ctx := context.Background()
	var owner string
	if err := a.DB.QueryRow(ctx, `SELECT user_id FROM posts WHERE id=$1`, postID).Scan(&owner); err != nil { http.Error(w, "post not found", 404); return }
	if owner != req.UserID { http.Error(w, "forbidden", 403); return }
	if _, err := a.DB.Exec(ctx, `UPDATE posts SET content=$1 WHERE id=$2`, req.Content, postID); err != nil { http.Error(w, err.Error(), 500); return }
	// fetch updated row with likes count
	row := a.DB.QueryRow(ctx, `SELECT p.id, p.user_id, p.content, p.created_at, COALESCE(l.count,0), COALESCE(c.count,0), COALESCE(u.display_name,''), false FROM posts p
		LEFT JOIN (SELECT post_id, COUNT(*) as count FROM likes GROUP BY post_id) l ON p.id=l.post_id
		LEFT JOIN (SELECT post_id, COUNT(*) as count FROM comments GROUP BY post_id) c ON p.id=c.post_id
		LEFT JOIN users u ON p.user_id=u.id
		WHERE p.id=$1`, postID)
	var p Post
	if err := row.Scan(&p.ID, &p.UserID, &p.Content, &p.CreatedAt, &p.Likes, &p.Comments, &p.AuthorName, &p.Liked); err != nil { http.Error(w, err.Error(), 500); return }
	deleteFeedCaches(ctx, a.Rdb)
	msg, _ := json.Marshal(map[string]any{"type":"post_updated","post":p})
	a.Hub.broadcast <- msg
	json.NewEncoder(w).Encode(p)
}

// naive cache bust: clear generic + scan keys for per-user feeds
func deleteFeedCaches(ctx context.Context, rdb *redis.Client) {
	rdb.Del(ctx, "posts:latest")
	// attempt pattern scan (ignores errors silently)
	iter := rdb.Scan(ctx, 0, "posts:latest:for:*", 0).Iterator()
	for iter.Next(ctx) { rdb.Del(ctx, iter.Val()) }
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
			p := map[string]any{}
			_ = json.Unmarshal(payload, &p)
			// skip self-action notifications (if payload.from == user itself) for like/comment/follow types
			if from, ok := p["from"].(string); ok && from == userID && (ntype == "like" || ntype == "comment" || ntype == "follow") {
				continue
			}
			// enrich fromName
			if p != nil {
				if _, ok := p["fromName"]; !ok {
					if fromRaw, ok2 := p["from"]; ok2 {
						if fromID, ok3 := fromRaw.(string); ok3 && fromID != "" {
							var fromName string
							_ = a.DB.QueryRow(ctx, `SELECT COALESCE(NULLIF(display_name,''), split_part(email,'@',1)) FROM users WHERE id=$1`, fromID).Scan(&fromName)
							if fromName != "" { p["fromName"] = fromName }
						}
					}
				}
				if ntype == "comment" && (p["comment"] == nil || p["comment"] == "") {
					if cidRaw, ok := p["commentId"]; ok {
						if cid, okc := cidRaw.(string); okc && cid != "" {
							var content string
							_ = a.DB.QueryRow(ctx, `SELECT content FROM comments WHERE id=$1`, cid).Scan(&content)
							if content != "" { p["comment"] = content }
						}
					}
				}
			}
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

// mark all notifications for a user as read
func (a *App) markAllNotificationsRead(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	userID := ps.ByName("id")
	if userID == "" { http.Error(w, "missing user id", 400); return }
	ctx := context.Background()
	if _, err := a.DB.Exec(ctx, `UPDATE notifications SET read=true WHERE user_id=$1 AND read=false`, userID); err != nil { http.Error(w, err.Error(), 500); return }
	w.WriteHeader(204)
}

func (a *App) clearNotifications(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	userID := ps.ByName("id")
	if userID == "" { http.Error(w, "missing user id", 400); return }
	ctx := context.Background()
	if _, err := a.DB.Exec(ctx, `DELETE FROM notifications WHERE user_id=$1`, userID); err != nil { http.Error(w, err.Error(), 500); return }
	w.WriteHeader(204)
}

// createNotificationInternal permite que outros serviços (ex: profile-service) criem notificações (follow) e disparem broadcast.
func (a *App) createNotificationInternal(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	var req struct {
		UserID string `json:"userId"`
		Type   string `json:"type"`
		Payload map[string]any `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil { http.Error(w, err.Error(), 400); return }
	if req.UserID == "" || req.Type == "" { http.Error(w, "missing fields", 400); return }
	// sanitize payload.fromName if missing (best effort enrichment)
	if req.Payload != nil {
		if _, ok := req.Payload["fromName"]; !ok {
			if from, ok2 := req.Payload["from"].(string); ok2 && from != "" {
				var fromName string
				_ = a.DB.QueryRow(context.Background(), `SELECT COALESCE(NULLIF(display_name,''), split_part(email,'@',1)) FROM users WHERE id=$1`, from).Scan(&fromName)
				if fromName != "" { req.Payload["fromName"] = fromName }
			}
		}
	}
	ctx := context.Background()
	nid := uuid.NewString()
	pb, _ := json.Marshal(req.Payload)
	if _, err := a.DB.Exec(ctx, `INSERT INTO notifications (id,user_id,type,payload) VALUES ($1,$2,$3,$4)`, nid, req.UserID, req.Type, pb); err != nil {
		http.Error(w, err.Error(), 500); return
	}
	// broadcast (include notificationType)
	notifPayload := map[string]any{"type":"notification_created","userId":req.UserID,"notificationId":nid,"payload":req.Payload, "notificationType":req.Type}
	msg, _ := json.Marshal(notifPayload)
	a.Hub.broadcast <- msg
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]any{"id": nid})
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
	rdb := redis.NewClient(&redis.Options{Addr: os.Getenv("REDIS_HOST")+":"+os.Getenv("REDIS_PORT")})
	hub := NewHub()
	go hub.Run()

	app := &App{DB: db, Rdb: rdb, Hub: hub}
	r := httprouter.New()
	r.GET("/posts", app.listPosts)
	r.POST("/posts", app.createPost)
	r.PUT("/posts/:id", app.updatePost)
	r.DELETE("/posts/:id", app.deletePost)
	r.POST("/posts/:id/like", app.likeToggle)
	r.POST("/posts/:id/comments", app.addComment)
	r.GET("/posts/:id/comments", app.listComments)
	r.GET("/ws", app.ws)
	r.GET("/notifications/:id", app.listNotifications)
	r.POST("/notifications/:id/read", app.markNotificationRead)
	r.POST("/notifications/:id/read-all", app.markAllNotificationsRead)
	r.POST("/notifications/:id/clear", app.clearNotifications)
	// internal notification creation (e.g. follow)
	r.POST("/internal/notifications", app.createNotificationInternal)

	log.Println("post-service listening :8083")
	http.ListenAndServe(":8083", r)
}
