package ai

import (
	"bufio"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/valyala/fasthttp"
)

type AIHandler struct {
	queueWorker *AIQueueWorker
}

func NewAIHandler(worker *AIQueueWorker) *AIHandler {
	return &AIHandler{queueWorker: worker}
}

// GenerateQuestions memicu pembuatan soal secara asynchronous
func (h *AIHandler) GenerateQuestions(c *fiber.Ctx) error {
	var req GenerateQuestionsJobRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"status":  "error",
			"message": "Format request tidak valid",
		})
	}

	if req.QuestionCount <= 0 {
		req.QuestionCount = 10
	}
	if req.QuestionCount > 50 {
		req.QuestionCount = 50 // Limit per batch agar tidak timeout
	}

	jobID := fmt.Sprintf("job_ai_%s", uuid.New().String()[:8])
	h.queueWorker.EnqueueJob(jobID, req)

	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{
		"job_id":     jobID,
		"status":     "queued",
		"stream_url": fmt.Sprintf("/api/v1/ai/jobs/%s/events", jobID),
	})
}

// StreamJobEvents mengalirkan pembaruan progres pembuatan soal via Server-Sent Events (SSE)
func (h *AIHandler) StreamJobEvents(c *fiber.Ctx) error {
	jobID := c.Params("id")
	if jobID == "" {
		return c.Status(fiber.StatusBadRequest).SendString("Job ID diperlukan")
	}

	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("Transfer-Encoding", "chunked")

	eventChan := h.queueWorker.SubscribeEvents(jobID)

	c.Context().SetBodyStreamWriter(fasthttp.StreamWriter(func(w *bufio.Writer) {
		defer h.queueWorker.UnsubscribeEvents(jobID, eventChan)

		// Kirim initial ping
		_, _ = fmt.Fprintf(w, "event: ping\ndata: {\"time\": %d}\n\n", time.Now().Unix())
		_ = w.Flush()

		timeout := time.After(3 * time.Minute)

		for {
			select {
			case event, ok := <-eventChan:
				if !ok {
					return
				}
				dataBytes, _ := json.Marshal(event)
				eventName := "progress"
				if event.Status == JobStatusCompleted {
					eventName = "completed"
				} else if event.Status == JobStatusFailed {
					eventName = "error"
				}

				_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventName, string(dataBytes))
				_ = w.Flush()

				if event.Status == JobStatusCompleted || event.Status == JobStatusFailed {
					return
				}
			case <-timeout:
				_, _ = fmt.Fprintf(w, "event: timeout\ndata: {\"message\": \"Koneksi SSE berakhir\"}\n\n")
				_ = w.Flush()
				return
			}
		}
	}))

	return nil
}
