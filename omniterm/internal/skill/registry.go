package skill

import (
    "context"
    "sync"

    "omnimind/internal/device"
)

type ParserFunc func(ctx context.Context, output string, params map[string]interface{}) (*device.DeviceInfo, error)

var (
    registryMu sync.RWMutex
    registry   = map[string]ParserFunc{}
)

func Register(id string, fn ParserFunc) {
    registryMu.Lock()
    defer registryMu.Unlock()
    registry[id] = fn
}

func GetParser(id string) (ParserFunc, bool) {
    registryMu.RLock()
    defer registryMu.RUnlock()
    fn, ok := registry[id]
    return fn, ok
}
