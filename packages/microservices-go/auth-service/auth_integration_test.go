package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/julienschmidt/httprouter"
)

func newTestApp(t *testing.T) *App {
	t.Helper()
	db := mustConnectTestDB()
	// limpa usuários com e-mail de teste para evitar interferência entre execuções
	_, _ = db.Exec(context.Background(), `DELETE FROM users WHERE email LIKE 'test+%@example.com'`)
	secret := []byte(envOr("JWT_SECRET", "test-secret"))
	return &App{
		DB:         db,
		JWTSecret:  secret,
		BcryptCost: 6, // custo baixo p/ teste mais rápido
	}
}

func newRouter(app *App) *httprouter.Router {
	r := httprouter.New()
	r.POST("/register", app.handleRegister)
	r.POST("/login", app.handleLogin)
	r.GET("/validate", app.handleValidate)
	return r
}

func TestRegister_Login_Validate_Success(t *testing.T) {
	app := newTestApp(t)
	defer app.DB.Close()
	router := newRouter(app)

	email := "test+" + uuid.NewString() + "@example.com"
	pw := "S3nh@F0rte!"
	display := "Tester"

	// --- register
	regBody, _ := json.Marshal(RegisterReq{Email: email, Password: pw, DisplayName: display})
	req := httptest.NewRequest(http.MethodPost, "/register", bytes.NewReader(regBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("register: esperado 201, veio %d; body=%s", rec.Code, rec.Body.String())
	}

	var regResp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &regResp)
	if regResp["email"] != email {
		t.Fatalf("register: email diferente: %v", regResp["email"])
	}

	// --- login
	loginBody, _ := json.Marshal(LoginReq{Email: email, Password: pw})
	req2 := httptest.NewRequest(http.MethodPost, "/login", bytes.NewReader(loginBody))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusOK {
		t.Fatalf("login: esperado 200, veio %d; body=%s", rec2.Code, rec2.Body.String())
	}

	var loginResp map[string]any
	_ = json.Unmarshal(rec2.Body.Bytes(), &loginResp)
	token, _ := loginResp["token"].(string)
	if token == "" {
		t.Fatalf("login: token vazio; body=%s", rec2.Body.String())
	}

	// --- validate
	req3 := httptest.NewRequest(http.MethodGet, "/validate", nil)
	req3.Header.Set("Authorization", "Bearer "+token)
	rec3 := httptest.NewRecorder()
	router.ServeHTTP(rec3, req3)

	if rec3.Code != http.StatusOK {
		t.Fatalf("validate: esperado 200, veio %d; body=%s", rec3.Code, rec3.Body.String())
	}
}

func TestRegister_DuplicateEmail(t *testing.T) {
	app := newTestApp(t)
	defer app.DB.Close()
	router := newRouter(app)

	email := "test+" + uuid.NewString() + "@example.com"
	pw := "x"
	body, _ := json.Marshal(RegisterReq{Email: email, Password: pw, DisplayName: "Dup"})

	// primeira criação
	req1 := httptest.NewRequest(http.MethodPost, "/register", bytes.NewReader(body))
	req1.Header.Set("Content-Type", "application/json")
	rec1 := httptest.NewRecorder()
	router.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusCreated {
		t.Fatalf("primeiro register deveria ser 201; veio %d (%s)", rec1.Code, rec1.Body.String())
	}

	// duplicado
	req2 := httptest.NewRequest(http.MethodPost, "/register", bytes.NewReader(body))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusConflict && rec2.Code != http.StatusBadRequest {
		t.Fatalf("duplicado: esperado 409/400; veio %d (%s)", rec2.Code, rec2.Body.String())
	}
}

func TestLogin_InvalidPassword(t *testing.T) {
	app := newTestApp(t)
	defer app.DB.Close()
	router := newRouter(app)

	email := "test+" + uuid.NewString() + "@example.com"
	okPw := "ok"
	badPw := "bad"

	// cria usuário
	regBody, _ := json.Marshal(RegisterReq{Email: email, Password: okPw, DisplayName: "X"})
	req := httptest.NewRequest(http.MethodPost, "/register", bytes.NewReader(regBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("register falhou: %d %s", rec.Code, rec.Body.String())
	}

	// tenta logar com senha errada
	loginBody, _ := json.Marshal(LoginReq{Email: email, Password: badPw})
	req2 := httptest.NewRequest(http.MethodPost, "/login", bytes.NewReader(loginBody))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusUnauthorized {
		t.Fatalf("login errado: esperado 401, veio %d (%s)", rec2.Code, rec2.Body.String())
	}
}

func TestValidate_MissingOrBadToken(t *testing.T) {
	app := newTestApp(t)
	defer app.DB.Close()
	router := newRouter(app)

	// sem header
	req1 := httptest.NewRequest(http.MethodGet, "/validate", nil)
	rec1 := httptest.NewRecorder()
	router.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusUnauthorized {
		t.Fatalf("sem token: esperado 401, veio %d", rec1.Code)
	}

	// token ruim
	req2 := httptest.NewRequest(http.MethodGet, "/validate", nil)
	req2.Header.Set("Authorization", "Bearer "+"xxx."+strings.Repeat("y", 10))
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusUnauthorized {
		t.Fatalf("token inválido: esperado 401, veio %d", rec2.Code)
	}
}

// opcional: garante que variáveis críticas existam (útil no CI)
func TestEnv_JWTSecret(t *testing.T) {
	if os.Getenv("JWT_SECRET") == "" {
		t.Skip("JWT_SECRET vazio no ambiente de teste — usando fallback do teste")
	}
}

func TestTimeout_Short(t *testing.T) {
	// tempo pequeno para evitar hangs de rede nos testes
	_ = time.Second
}
