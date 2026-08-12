package token

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
)

// Load reads and parses the JSON file into memory.
func (s *Store) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.filePath)
	if os.IsNotExist(err) {
		s.tokens = make(map[string]*Token)
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to read token store: %w", err)
	}

	if len(data) == 0 {
		s.tokens = make(map[string]*Token)
		return nil
	}

	if err := json.Unmarshal(data, &s.tokens); err != nil {
		log.Printf("token: failed to parse token store, starting with empty map: %v", err)
		s.tokens = make(map[string]*Token)
		return nil
	}

	return nil
}

// save atomically writes the token map to file (temp + rename).
func (s *Store) save() error {
	data, err := json.MarshalIndent(s.tokens, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal tokens: %w", err)
	}

	// Ensure parent directory exists
	if dir := dirOf(s.filePath); dir != "" {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", dir, err)
		}
	}

	// Atomic write: temp file + rename
	tmpPath := s.filePath + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmpPath, s.filePath)
}

func dirOf(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			return path[:i]
		}
	}
	return ""
}
