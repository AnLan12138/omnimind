package session

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/crypto/ssh"
)

func GenerateKeyPair(keyPath string, comment string) (string, error) {
	dir := filepath.Dir(keyPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", fmt.Errorf("create dir: %w", err)
	}

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", fmt.Errorf("generate key: %w", err)
	}

	// Save private key
	privBytes, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return "", fmt.Errorf("marshal private key: %w", err)
	}
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privBytes})
	if err := os.WriteFile(keyPath, privPEM, 0600); err != nil {
		return "", fmt.Errorf("write private key: %w", err)
	}

	// Generate public key in OpenSSH format
	pubKey, err := ssh.NewPublicKey(priv.Public())
	if err != nil {
		return "", fmt.Errorf("generate ssh public key: %w", err)
	}
	pubBytes := ssh.MarshalAuthorizedKey(pubKey)
	pubBytes = []byte(string(pubBytes) + " " + comment + "\n")

	pubPath := keyPath + ".pub"
	if err := os.WriteFile(pubPath, pubBytes, 0644); err != nil {
		return "", fmt.Errorf("write public key: %w", err)
	}

	return string(pubBytes), nil
}
