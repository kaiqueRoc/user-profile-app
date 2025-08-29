package main

import (
    "context"
    "errors"
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"
    "time"

    "github.com/jackc/pgx/v5"
    "github.com/julienschmidt/httprouter"
)

type mockRow struct { scanFn func(dest ...any) error }
func (m mockRow) Scan(dest ...any) error { return m.scanFn(dest...) }

type mockRows struct { items [][]any; idx int }
func (m *mockRows) Next() bool { m.idx++; return m.idx <= len(m.items) }
func (m *mockRows) Scan(dest ...any) error {
    if m.idx-1 >= len(m.items) { return errors.New("out of range") }
    row := m.items[m.idx-1]
    for i,v := range row { switch d := dest[i].(type) { case *string: *d = v.(string); case *time.Time: *d = v.(time.Time) } }
    return nil
}
func (m *mockRows) Err() error { return nil }
func (m *mockRows) CommandTag() pgx.CommandTag { return nil }
func (m *mockRows) Close() {}

// implement pgx.Rows interface subset
var _ pgx.Rows = (*mockRows)(nil)

type mockDB struct {
    execFn func(ctx context.Context, sql string, args ...any) (pgx.CommandTag, error)
    queryRowFn func(ctx context.Context, sql string, args ...any) pgx.Row
    queryFn func(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}
func (m *mockDB) Exec(ctx context.Context, sql string, args ...any) (pgx.CommandTag, error) { return m.execFn(ctx, sql, args...) }
func (m *mockDB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row { return m.queryRowFn(ctx, sql, args...) }
func (m *mockDB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) { return m.queryFn(ctx, sql, args...) }

func TestGetProfile_NotFound(t *testing.T) {
    db := &mockDB{
        queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row { return mockRow{scanFn: func(dest ...any) error { return errors.New("no rows") }} },
    }
    app := &App{DB: db}
    r := httprouter.New()
    r.GET("/profiles/:id", app.getProfile)

    req := httptest.NewRequest(http.MethodGet, "/profiles/u1", nil)
    w := httptest.NewRecorder()
    r.ServeHTTP(w, req)

    if w.Code != http.StatusNotFound { t.Fatalf("expected 404 got %d", w.Code) }
}

func TestPutProfile_InsertThenUpdate(t *testing.T) {
    // We'll simulate insert + update + final select
    created := time.Now().Add(-time.Minute)
    updated := time.Now()
    db := &mockDB{
        execFn: func(ctx context.Context, sql string, args ...any) (pgx.CommandTag, error) { return nil, nil },
        queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
            return mockRow{scanFn: func(dest ...any) error {
                // id, user_id, bio, avatar_url, created_at, updated_at
                *(dest[0].(*string)) = "profile-id"
                *(dest[1].(*string)) = args[0].(string)
                *(dest[2].(*string)) = "new bio"
                *(dest[3].(*string)) = "avatar.png"
                *(dest[4].(*time.Time)) = created
                *(dest[5].(*time.Time)) = updated
                return nil
            }}
        },
    }
    app := &App{DB: db}
    r := httprouter.New()
    r.PUT("/profiles/:id", app.putProfile)

    body := `{"bio":"new bio","avatarUrl":"avatar.png"}`
    req := httptest.NewRequest(http.MethodPut, "/profiles/user123", strings.NewReader(body))
    w := httptest.NewRecorder()
    r.ServeHTTP(w, req)

    if w.Code != http.StatusOK { t.Fatalf("expected 200 got %d", w.Code) }
    if !strings.Contains(w.Body.String(), "profile-id") { t.Fatalf("response missing profile id: %s", w.Body.String()) }
}

func TestAddFollow_AndListFollowing(t *testing.T) {
    // capture follower insertion and list
    rows := &mockRows{items: [][]any{{"u2","u2@example.com","User Two"}}}
    db := &mockDB{
        execFn: func(ctx context.Context, sql string, args ...any) (pgx.CommandTag, error) { return nil, nil },
        queryFn: func(ctx context.Context, sql string, args ...any) (pgx.Rows, error) { return rows, nil },
        queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row { return mockRow{scanFn: func(dest ...any) error { return errors.New("not used") }} },
    }
    app := &App{DB: db}
    r := httprouter.New()
    r.POST("/profiles/:id/follow", app.addFollow)
    r.GET("/profiles/:id/following", app.listFollowing)

    followBody := `{"FollowerId":"u1"}`
    req := httptest.NewRequest(http.MethodPost, "/profiles/u2/follow", strings.NewReader(followBody))
    w := httptest.NewRecorder()
    r.ServeHTTP(w, req)
    if w.Code != http.StatusNoContent { t.Fatalf("expected 204 got %d", w.Code) }

    listReq := httptest.NewRequest(http.MethodGet, "/profiles/u1/following", nil)
    listW := httptest.NewRecorder()
    r.ServeHTTP(listW, listReq)
    if listW.Code != http.StatusOK { t.Fatalf("expected 200 got %d", listW.Code) }
    if !strings.Contains(listW.Body.String(), "u2@example.com") { t.Fatalf("missing user entry: %s", listW.Body.String()) }
}

func TestRemoveFollow(t *testing.T) {
    db := &mockDB{execFn: func(ctx context.Context, sql string, args ...any) (pgx.CommandTag, error) { return nil, nil }, queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row { return mockRow{scanFn: func(dest ...any) error { return errors.New("unused") }} }, queryFn: func(ctx context.Context, sql string, args ...any) (pgx.Rows, error) { return &mockRows{}, nil }}
    app := &App{DB: db}
    r := httprouter.New()
    r.POST("/profiles/:id/unfollow", app.removeFollow)
    unfollowBody := `{"FollowerId":"u1"}`
    req := httptest.NewRequest(http.MethodPost, "/profiles/u2/unfollow", strings.NewReader(unfollowBody))
    w := httptest.NewRecorder()
    r.ServeHTTP(w, req)
    if w.Code != http.StatusNoContent { t.Fatalf("expected 204 got %d", w.Code) }
}
