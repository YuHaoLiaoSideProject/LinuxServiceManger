package systemd

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/godbus/dbus/v5"
)

// execCommandContext and lookPath are package-level variables to allow
// mocking in tests. They default to the standard library functions.
var execCommandContext = exec.CommandContext
var lookPath = exec.LookPath

// ServiceManager defines the interface for interacting with systemd services.
// This allows mocking in tests.
type ServiceManager interface {
	ListServices() ([]Service, error)
	StartService(ctx context.Context, name string) error
	StopService(ctx context.Context, name string) error
	RestartService(ctx context.Context, name string) error
	EnableService(name string) error
	DisableService(name string) error
	GetUnitFileState(name string) (string, error)
	GetServiceLogs(name string, lines int) (string, error)
}

// DefaultManager is the real systemd implementation.
type DefaultManager struct{}

func (m *DefaultManager) ListServices() ([]Service, error)       { return ListServices() }
func (m *DefaultManager) StartService(ctx context.Context, name string) error         { return StartService(ctx, name) }
func (m *DefaultManager) StopService(ctx context.Context, name string) error          { return StopService(ctx, name) }
func (m *DefaultManager) RestartService(ctx context.Context, name string) error       { return RestartService(ctx, name) }
func (m *DefaultManager) EnableService(name string) error        { return EnableService(name) }
func (m *DefaultManager) DisableService(name string) error       { return DisableService(name) }
func (m *DefaultManager) GetUnitFileState(name string) (string, error) { return GetUnitFileState(name) }
func (m *DefaultManager) GetServiceLogs(name string, lines int) (string, error) {
	return GetServiceLogs(name, lines)
}

var _ ServiceManager = (*DefaultManager)(nil)

// validServiceName matches systemd unit names for .service units.
// Allows: letters, digits, @, :, _, ., -  —  must start with alphanumeric, end with .service
var validServiceName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9:@_.\-]*\.service$`)

// ValidateServiceName checks whether name is a valid systemd service unit name.
func ValidateServiceName(name string) error {
	if !validServiceName.MatchString(name) {
		return fmt.Errorf("invalid service name: %s", name)
	}
	return nil
}

// Service represents a systemd service unit.
type Service struct {
	Name          string
	Load          string
	Active        string
	Sub           string
	UnitFileState string // enabled, disabled, static, masked, alias, indirect
	FragmentPath  string // /etc/systemd/system/xxx.service or /usr/lib/systemd/system/xxx.service
	Locked        bool   // true = locked, hide Actions
}

// ListServices returns all systemd service units.
// It tries D-Bus first; if that fails, it falls back to systemctl.
func ListServices() ([]Service, error) {
	services, err := listViaDbus()
	if err == nil {
		return services, nil
	}

	// Fallback: use systemctl command
	return listViaSystemctl()
}

// listViaDbus connects to the systemd D-Bus API and lists services.
func listViaDbus() ([]Service, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := dbus.SystemBusPrivate(dbus.WithContext(ctx))
	if err != nil {
		return nil, fmt.Errorf("dbus connect: %w", err)
	}
	defer conn.Close()

	if err := conn.Auth(nil); err != nil {
		return nil, fmt.Errorf("dbus auth: %w", err)
	}
	if err := conn.Hello(); err != nil {
		return nil, fmt.Errorf("dbus hello: %w", err)
	}

	obj := conn.Object("org.freedesktop.systemd1", "/org/freedesktop/systemd1")

	// systemd's D-Bus API: ListUnits method on org.freedesktop.systemd1.Manager
	call := obj.CallWithContext(ctx, "org.freedesktop.systemd1.Manager.ListUnits", 0)
	if call.Err != nil {
		return nil, fmt.Errorf("ListUnits call: %w", call.Err)
	}

	// Parse response: array of (name, description, load_state, active_state, sub_state, ...)
	var units [][]interface{}
	if err := call.Store(&units); err != nil {
		return nil, fmt.Errorf("store result: %w", err)
	}

	// Call ListUnitFiles to get FragmentPath and UnitFileState for all unit files
	call2 := obj.CallWithContext(ctx, "org.freedesktop.systemd1.Manager.ListUnitFiles", 0)
	if call2.Err != nil {
		return nil, fmt.Errorf("ListUnitFiles call: %w", call2.Err)
	}

	var unitFiles [][]interface{}
	if err := call2.Store(&unitFiles); err != nil {
		return nil, fmt.Errorf("store ListUnitFiles result: %w", err)
	}

	// Build map: unit name → {FragmentPath, UnitFileState}
	type unitFileInfo struct {
		FragmentPath  string
		UnitFileState string
	}
	unitFileMap := make(map[string]unitFileInfo)
	for _, uf := range unitFiles {
		if len(uf) < 2 {
			continue
		}
		path, _ := uf[0].(string)
		state, _ := uf[1].(string)
		name := filepath.Base(path)
		unitFileMap[name] = unitFileInfo{FragmentPath: path, UnitFileState: state}
	}

	var services []Service
	for _, u := range units {
		if len(u) < 5 {
			continue
		}
		name, _ := u[0].(string)
		// Only include .service units
		if !strings.HasSuffix(name, ".service") {
			continue
		}
		load, _ := u[2].(string)
		active, _ := u[3].(string)
		sub, _ := u[4].(string)

		svc := Service{
			Name:   name,
			Load:   load,
			Active: active,
			Sub:    sub,
		}

		// Enrich with unit file info
		if info, ok := unitFileMap[name]; ok {
			svc.UnitFileState = info.UnitFileState
			svc.FragmentPath = info.FragmentPath
		} else {
			svc.UnitFileState = "unknown"
			svc.FragmentPath = ""
		}

		// Determine lock status
		svc.Locked = isLocked(name, svc.UnitFileState, svc.FragmentPath)

		services = append(services, svc)
	}

	return services, nil
}

// listViaSystemctl runs systemctl and parses its output.
func listViaSystemctl() ([]Service, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx,
		"systemctl", "list-units",
		"--type=service",
		"--all",
		"--no-pager",
		"--no-legend",
		"--plain",
	)

	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("systemctl: %w", err)
	}

	services, err := parseSystemctlOutput(string(out))
	if err != nil {
		return nil, err
	}

	// Batch query FragmentPath and UnitFileState via systemctl show
	if len(services) > 0 {
		enrichServicesWithUnitFileInfo(ctx, services)
	}

	// Compute lock status for each service
	for i := range services {
		services[i].Locked = isLocked(services[i].Name, services[i].UnitFileState, services[i].FragmentPath)
	}

	return services, nil
}

// StartService starts a systemd service unit using systemctl.
// The ctx parameter allows callers (e.g. batch operations) to cancel
// in-flight operations when their own deadline expires.
func StartService(ctx context.Context, name string) error {
	if err := ValidateServiceName(name); err != nil {
		return err
	}

	// Check for pre-cancelled context before spawning a subprocess.
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("operation cancelled: %w", err)
	}

	derived, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(derived, "systemctl", "start", name)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl start %s: %s: %w", name, strings.TrimSpace(string(out)), err)
	}
	return nil
}

// StopService stops a systemd service unit using systemctl.
// The ctx parameter allows callers (e.g. batch operations) to cancel
// in-flight operations when their own deadline expires.
func StopService(ctx context.Context, name string) error {
	if err := ValidateServiceName(name); err != nil {
		return err
	}

	// Check for pre-cancelled context before spawning a subprocess.
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("operation cancelled: %w", err)
	}

	derived, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(derived, "systemctl", "stop", name)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl stop %s: %s: %w", name, strings.TrimSpace(string(out)), err)
	}
	return nil
}

// EnableService enables a systemd service unit using systemctl.
func EnableService(name string) error {
	if err := ValidateServiceName(name); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "systemctl", "enable", name)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl enable %s: %s: %w", name, strings.TrimSpace(string(out)), err)
	}
	return nil
}

// DisableService disables a systemd service unit using systemctl.
func DisableService(name string) error {
	if err := ValidateServiceName(name); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "systemctl", "disable", name)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl disable %s: %s: %w", name, strings.TrimSpace(string(out)), err)
	}
	return nil
}

// RestartService restarts a systemd service unit using systemctl.
// The ctx parameter allows callers (e.g. batch operations) to cancel
// in-flight operations when their own deadline expires.
func RestartService(ctx context.Context, name string) error {
	if err := ValidateServiceName(name); err != nil {
		return err
	}

	// Check for pre-cancelled context before spawning a subprocess.
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("operation cancelled: %w", err)
	}

	derived, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(derived, "systemctl", "restart", name)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl restart %s: %s: %w", name, strings.TrimSpace(string(out)), err)
	}
	return nil
}

// parseSystemctlOutput parses the output of:
//
//	systemctl list-units --type=service --all --no-pager --no-legend --plain
//
// Each line: name  load  active  sub  description
func parseSystemctlOutput(output string) ([]Service, error) {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	var services []Service

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Split on whitespace — first 4 fields are our columns, rest is description
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}

		name := fields[0]
		if !strings.HasSuffix(name, ".service") {
			continue
		}

		services = append(services, Service{
			Name:   name,
			Load:   fields[1],
			Active: fields[2],
			Sub:    fields[3],
		})
	}

	return services, nil
}

// enrichServicesWithUnitFileInfo batch queries FragmentPath and UnitFileState
// via systemctl show for all services and mutates them in-place.
func enrichServicesWithUnitFileInfo(ctx context.Context, services []Service) {
	const maxBatchSize = 500

	names := make([]string, len(services))
	for i, svc := range services {
		names[i] = svc.Name
	}

	// Parse output: each unit block starts with Id=, followed by FragmentPath=, UnitFileState=
	// Blocks are separated by blank lines
	type unitFileInfo struct {
		FragmentPath  string
		UnitFileState string
	}
	infoMap := make(map[string]unitFileInfo)

	// Process in batches to avoid overly long argument lists
	for start := 0; start < len(names); start += maxBatchSize {
		end := start + maxBatchSize
		if end > len(names) {
			end = len(names)
		}
		batch := names[start:end]

		args := append([]string{"show", "--property=Id,FragmentPath,UnitFileState"}, batch...)
		cmd := exec.CommandContext(ctx, "systemctl", args...)
		out, err := cmd.Output()
		if err != nil {
			continue
		}

		var currentName string
		var currentInfo unitFileInfo

		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				// End of a unit block
				if currentName != "" {
					infoMap[currentName] = currentInfo
					currentName = ""
					currentInfo = unitFileInfo{}
				}
				continue
			}
			if strings.HasPrefix(line, "Id=") {
				currentName = strings.TrimPrefix(line, "Id=")
			} else if strings.HasPrefix(line, "FragmentPath=") {
				currentInfo.FragmentPath = strings.TrimPrefix(line, "FragmentPath=")
			} else if strings.HasPrefix(line, "UnitFileState=") {
				currentInfo.UnitFileState = strings.TrimPrefix(line, "UnitFileState=")
			}
		}
		// Don't forget the last block (no trailing blank line)
		if currentName != "" {
			infoMap[currentName] = currentInfo
		}
	}

	// Apply info to services
	for i := range services {
		if info, ok := infoMap[services[i].Name]; ok {
			services[i].FragmentPath = info.FragmentPath
			services[i].UnitFileState = info.UnitFileState
		} else {
			services[i].UnitFileState = "unknown"
		}
	}
}

// isLocked determines whether a service should be locked (actions hidden).
// Returns false (unlocked) only if ALL conditions are met:
//  1. FragmentPath starts with /etc/systemd/system/
//  2. Service name does NOT start with "dbus-"
//  3. UnitFileState is NOT static, masked, or alias
//  4. OR explicitly unlocked via UNLOCKED_SERVICES env var
func isLocked(name, unitFileState, fragmentPath string) bool {
	// Check UNLOCKED_SERVICES environment variable (explicit unlock)
	if isUnlockedByConfig(name) {
		return false
	}

	// FragmentPath must be under /etc/systemd/system/
	if !strings.HasPrefix(fragmentPath, "/etc/systemd/system/") {
		return true
	}

	// Services starting with "dbus-" are system-generated symlinks
	if strings.HasPrefix(name, "dbus-") {
		return true
	}

	// static, masked, alias should not be manually operated
	switch unitFileState {
	case "static", "masked", "alias":
		return true
	}

	return false
}

// unlockedConfig caches the parsed UNLOCKED_SERVICES patterns at first use.
// This avoids repeated os.Getenv + strings.Split on every ListServices call.
type unlockedConfig struct {
	once     sync.Once
	patterns []string
}

var unlockedCfg unlockedConfig

// resetUnlockedConfigForTest resets the cached unlocked config.
// Only for use in tests that set different UNLOCKED_SERVICES values.
func resetUnlockedConfigForTest() {
	unlockedCfg = unlockedConfig{}
}

// isUnlockedByConfig checks the UNLOCKED_SERVICES environment variable
// against the given service name. Supports comma-separated values with
// glob pattern matching via filepath.Match.
// The env var is parsed once on first call and cached thereafter.
func isUnlockedByConfig(name string) bool {
	unlockedCfg.once.Do(func() {
		unlocked := os.Getenv("UNLOCKED_SERVICES")
		if unlocked == "" {
			return
		}
		for _, p := range strings.Split(unlocked, ",") {
			p = strings.TrimSpace(p)
			if p != "" {
				unlockedCfg.patterns = append(unlockedCfg.patterns, p)
			}
		}
	})

	if len(unlockedCfg.patterns) == 0 {
		return false
	}

	nameWithoutSuffix := strings.TrimSuffix(name, ".service")

	for _, p := range unlockedCfg.patterns {
		// Exact match (with or without .service suffix)
		if p == name || p == nameWithoutSuffix {
			return true
		}

		// Glob pattern match
		if matched, err := filepath.Match(p, name); err == nil && matched {
			return true
		}
		if matched, err := filepath.Match(p, nameWithoutSuffix); err == nil && matched {
			return true
		}
	}

	return false
}

// GetUnitFileState queries a single service's UnitFileState via systemctl show.
func GetUnitFileState(name string) (string, error) {
	if err := ValidateServiceName(name); err != nil {
		return "", err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "systemctl", "show", "-p", "UnitFileState", "--value", name)
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("systemctl show %s: %w", name, err)
	}
	return strings.TrimSpace(string(out)), nil
}

// GetServiceLogs retrieves the last N lines of a service's journald logs.
// It executes journalctl with the given service name and line count.
func GetServiceLogs(name string, lines int) (string, error) {
	// 1. Validate service name
	if err := ValidateServiceName(name); err != nil {
		return "", err
	}

	// 2. Validate lines range
	if lines < 1 || lines > 1000 {
		return "", fmt.Errorf("lines must be between 1 and 1000")
	}

	// 3. Check journalctl exists
	if _, err := lookPath("journalctl"); err != nil {
		return "", fmt.Errorf("journalctl not found: system does not support journalctl")
	}

	// 4. Execute journalctl
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := execCommandContext(ctx,
		"journalctl", "-u", name,
		"-n", strconv.Itoa(lines),
		"--no-pager",
		"-o", "short-iso",
	)

	out, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("timeout reading logs")
		}
		stderr := strings.TrimSpace(string(out))
		if strings.Contains(stderr, "permission denied") ||
			strings.Contains(stderr, "not authorized") {
			return "", fmt.Errorf("permission denied: user lacks journalctl access")
		}
		return "", fmt.Errorf("journalctl error: %s", stderr)
	}

	return string(out), nil
}
