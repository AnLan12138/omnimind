package config

import "os"

func DataDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil { return "", err }
	return home + "/.omnimind", nil
}

func HomeDir() (string, error) {
	return os.UserHomeDir()
}
