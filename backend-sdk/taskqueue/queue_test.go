package taskqueue

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestQueueEnforcesConcurrencyAndReturnsResults(t *testing.T) {
	q, err := New(2, 8)
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()
	var active, maximum atomic.Int32
	results := make([]<-chan Result, 6)
	for i := range results {
		value := i
		results[i], err = q.Submit(context.Background(), func(context.Context) (any, error) {
			current := active.Add(1)
			for {
				old := maximum.Load()
				if current <= old || maximum.CompareAndSwap(old, current) {
					break
				}
			}
			time.Sleep(10 * time.Millisecond)
			active.Add(-1)
			return value, nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	for i, future := range results {
		result := <-future
		if result.Err != nil || result.Value != i {
			t.Fatalf("result %d: %#v", i, result)
		}
	}
	if maximum.Load() != 2 {
		t.Fatalf("maximum concurrency = %d", maximum.Load())
	}
}
