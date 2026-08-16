// Command agent 是精簡版 Linux Service Manager Agent binary。
// 建置：go build ./cmd/agent（CI 平行建置 agent-linux-amd64 / agent-linux-arm64，決策 7）
package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"log"
	"net/http"
	"os"

	"linux-service-manager/internal/agent"
	"linux-service-manager/internal/systemd"
)

const version = "1.2.0" // 與 Manager 的 AgentMinVersion 同步（決策 3）

func main() {
	// Config path is overridable via LSM_AGENT_CONFIG (default: /etc/linux-service-manager/agent.yaml).
	cfgPath := os.Getenv("LSM_AGENT_CONFIG")
	if cfgPath == "" {
		cfgPath = "/etc/linux-service-manager/agent.yaml"
	}
	cfg, err := agent.LoadConfig(cfgPath)
	if err != nil {
		log.Fatalf("agent: %v", err) // 缺必填欄位啟動即失敗（SYS-45）
	}

	sm := &systemd.DefaultManager{} // 既有 ServiceManager 實作，零改動（專案既有用法，無 New() 建構子）

	srv := agent.NewServer(cfg, sm)
	tlsCfg := &tls.Config{}
	// 選填 mTLS：client_cert 設定時要求 Manager 提供受信任憑證（決策 5 方案 B）
	if cfg.ClientCert != "" {
		pem, err := os.ReadFile(cfg.ClientCert)
		if err != nil {
			log.Fatalf("agent: failed to read client_cert %s: %v", cfg.ClientCert, err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			log.Fatalf("agent: no valid certificates in client_cert %s", cfg.ClientCert)
		}
		tlsCfg.ClientAuth = tls.RequireAndVerifyClientCert
		tlsCfg.ClientCAs = pool
		log.Printf("agent: mTLS enabled (client cert pool: %s)", cfg.ClientCert)
	}

	httpServer := &http.Server{
		Addr:      cfg.ListenAddr,
		Handler:   agent.RequireTLS(srv.Routes()), // 明文回 426（決策 1）
		TLSConfig: tlsCfg,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	hb := agent.NewHeartbeatClient(cfg, version)
	go hb.Run(ctx) // 10s ticker ±2s jitter + backoff

	log.Printf("agent v%s listening on %s (heartbeat → %s)", version, cfg.ListenAddr, cfg.ManagerAddr)
	log.Fatal(httpServer.ListenAndServeTLS(cfg.TLSCert, cfg.TLSKey))
}
