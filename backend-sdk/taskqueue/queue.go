package taskqueue

import (
	"context"
	"errors"
	"sync"
)

type Job func(context.Context) (any, error)
type Result struct {
	Value any
	Err   error
}
type submission struct {
	ctx    context.Context
	job    Job
	result chan Result
}

type Queue struct {
	jobs   chan submission
	mu     sync.RWMutex
	closed bool
	wg     sync.WaitGroup
}

func New(maxConcurrent, capacity int) (*Queue, error) {
	if maxConcurrent < 1 {
		return nil, errors.New("maxConcurrent must be positive")
	}
	if capacity < 1 {
		return nil, errors.New("capacity must be positive")
	}
	q := &Queue{jobs: make(chan submission, capacity)}
	for i := 0; i < maxConcurrent; i++ {
		q.wg.Add(1)
		go q.worker()
	}
	return q, nil
}

func (q *Queue) Submit(ctx context.Context, job Job) (<-chan Result, error) {
	if q == nil || job == nil {
		return nil, errors.New("queue and job are required")
	}
	q.mu.RLock()
	defer q.mu.RUnlock()
	if q.closed {
		return nil, errors.New("queue is closed")
	}
	result := make(chan Result, 1)
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case q.jobs <- submission{ctx: ctx, job: job, result: result}:
		return result, nil
	}
}

func (q *Queue) Close() {
	if q == nil {
		return
	}
	q.mu.Lock()
	if !q.closed {
		q.closed = true
		close(q.jobs)
	}
	q.mu.Unlock()
	q.wg.Wait()
}

func (q *Queue) worker() {
	defer q.wg.Done()
	for item := range q.jobs {
		if err := item.ctx.Err(); err != nil {
			item.result <- Result{Err: err}
		} else {
			value, err := item.job(item.ctx)
			item.result <- Result{Value: value, Err: err}
		}
		close(item.result)
	}
}
