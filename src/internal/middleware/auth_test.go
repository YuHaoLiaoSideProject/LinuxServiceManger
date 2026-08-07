package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"linux-service-manager/internal/auth"
)

// ============================================================
//  Helper functions
// ============================================================

// createAuthCookie creates a valid authenticated session cookie
// by going through the auth package's session store.
func createAuthCookie(t *testing.T) *http.Cookie {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()

	session := auth.GetSession(req)
	session.Values["authenticated"] = true
	session.Values["username"] = "admin"
	auth.SaveSession(w, req, session)

	cookies := w.Result().Cookies()
	for _, c := range cookies {
		if c.Name == "linux-service-manager" {
			return c
		}
	}
	t.Fatal("no session cookie found in response")
	return nil
}

// mockOKHandler returns 200 OK with "ok" body.
func mockOKHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})
}

// ============================================================
//  TEST: AuthMiddlewareJSON — 未登入 → 401 JSON (F37)
// ============================================================

func TestAuthMiddlewareJSON_Unauthorized(t *testing.T) {
	next := mockOKHandler()
	handler := AuthMiddlewareJSON(next)

	// Request without session cookie
	req := httptest.NewRequest(http.MethodGet, "/api/v1/services", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	// F37: 驗證 status = 401
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", w.Code)
	}

	// F37: 驗證 Content-Type = application/json
	ct := w.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", ct)
	}

	// F37: 驗證 body 包含 {"error": "unauthorized"}
	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to parse JSON body: %v\nbody: %s", err, w.Body.String())
	}
	if body["error"] != "unauthorized" {
		t.Errorf("expected error 'unauthorized', got %q", body["error"])
	}
}

// ============================================================
//  TEST: AuthMiddlewareJSON — 已登入 → 通過 (F37)
// ============================================================

func TestAuthMiddlewareJSON_Authenticated(t *testing.T) {
	next := mockOKHandler()
	handler := AuthMiddlewareJSON(next)

	// Create authenticated session cookie
	cookie := createAuthCookie(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/services", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	// Verify request passed through to the next handler
	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}
	if w.Body.String() != "ok" {
		t.Errorf("expected body 'ok', got %q", w.Body.String())
	}
}

// ============================================================
//  TEST: AuthMiddleware — 未登入 → redirect /login (F38)
// ============================================================

func TestAuthMiddleware_Redirect(t *testing.T) {
	next := mockOKHandler()
	handler := AuthMiddleware(next)

	// Request without session cookie
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	// F38: 驗證 status = 302 (Found)
	if w.Code != http.StatusFound {
		t.Errorf("expected status 302, got %d", w.Code)
	}

	// F38: 驗證 Location header = "/login"
	location := w.Header().Get("Location")
	if location != "/login" {
		t.Errorf("expected Location '/login', got %q", location)
	}
}

// ============================================================
//  TEST: AuthMiddleware — 已登入 → 通過 (F38)
// ============================================================

func TestAuthMiddleware_Authenticated(t *testing.T) {
	next := mockOKHandler()
	handler := AuthMiddleware(next)

	// Create authenticated session cookie
	cookie := createAuthCookie(t)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	// Verify request passed through to the next handler
	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}
	if w.Body.String() != "ok" {
		t.Errorf("expected body 'ok', got %q", w.Body.String())
	}
}

// ============================================================
//  Edge cases
// ============================================================

func TestAuthMiddlewareJSON_InvalidSessionValue(t *testing.T) {
	next := mockOKHandler()
	handler := AuthMiddlewareJSON(next)

	// Create a session cookie with authenticated = false
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	session := auth.GetSession(req)
	session.Values["authenticated"] = false
	auth.SaveSession(w, req, session)

	cookies := w.Result().Cookies()
	var cookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "linux-service-manager" {
			cookie = c
			break
		}
	}
	if cookie == nil {
		t.Fatal("no session cookie found")
	}

	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/services", nil)
	req2.AddCookie(cookie)
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)

	if w2.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401 for authenticated=false, got %d", w2.Code)
	}
}
