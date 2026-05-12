package protocol

import (
	"context"
	"math"
	"time"
)

type ReconnectConfig struct {
	MaxRetries  int           // 0 = infinite
	BaseDelay   time.Duration // starting delay
	MaxDelay    time.Duration // max delay cap
	Multiplier  float64       // backoff multiplier
}

func DefaultReconnectConfig() ReconnectConfig {
	return ReconnectConfig{
		MaxRetries: 0, // infinite
		BaseDelay:  1 * time.Second,
		MaxDelay:   60 * time.Second,
		Multiplier: 2.0,
	}
}

// ReconnectLoop attempts to reconnect using the given factory function.
// It returns nil when reconnected, or the last error if max retries exceeded.
func ReconnectLoop(ctx context.Context, cfg ReconnectConfig, connectFn func(ctx context.Context) error, stateFn func(ConnState)) error {
	retry := 0
	delay := cfg.BaseDelay

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if cfg.MaxRetries > 0 && retry >= cfg.MaxRetries {
			return ErrMaxRetries
		}

		stateFn(StateReconnecting)

		newCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		err := connectFn(newCtx)
		cancel()
		if err == nil {
			stateFn(StateConnected)
			return nil
		}

		retry++
		delay = time.Duration(math.Min(float64(delay)*cfg.Multiplier, float64(cfg.MaxDelay)))

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
	}
}

// ErrMaxRetries is returned when the max number of retries is exceeded.
var ErrMaxRetries = &maxRetriesError{}

type maxRetriesError struct{}

func (e *maxRetriesError) Error() string { return "max reconnection retries exceeded" }
