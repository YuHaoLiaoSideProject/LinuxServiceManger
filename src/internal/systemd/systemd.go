package systemd

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/godbus/dbus/v5"
)

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
func StartService(name string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "systemctl", "start", name)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl start %s: %s: %w", name, strings.TrimSpace(string(out)), err)
	}
	return nil
}

// StopService stops a systemd service unit using systemctl.
func StopService(name string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "systemctl", "stop", name)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl stop %s: %s: %w", name, strings.TrimSpace(string(out)), err)
	}
	return nil
}

// RestartService restarts a systemd service unit using systemctl.
func RestartService(name string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "systemctl", "restart", name)
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
	names := make([]string, len(services))
	for i, svc := range services {
		names[i] = svc.Name
	}

	args := append([]string{"show", "--property=Id,FragmentPath,UnitFileState"}, names...)
	cmd := exec.CommandContext(ctx, "systemctl", args...)
	out, err := cmd.Output()
	if err != nil {
		return
	}

	// Parse output: each unit block starts with Id=, followed by FragmentPath=, UnitFileState=
	// Blocks are separated by blank lines
	type unitFileInfo struct {
		FragmentPath  string
		UnitFileState string
	}
	infoMap := make(map[string]unitFileInfo)

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

// isUnlockedByConfig checks the UNLOCKED_SERVICES environment variable
// against the given service name. Supports comma-separated values with
// glob pattern matching via filepath.Match.
func isUnlockedByConfig(name string) bool {
	unlocked := os.Getenv("UNLOCKED_SERVICES")
	if unlocked == "" {
		return false
	}

	nameWithoutSuffix := strings.TrimSuffix(name, ".service")
	patterns := strings.Split(unlocked, ",")

	for _, p := range patterns {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}

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
