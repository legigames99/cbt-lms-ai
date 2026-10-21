package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"cbt-lms-ai/internal/config"
)

type AIClient interface {
	GenerateQuestions(ctx context.Context, prompt string) (*GeneratedQuestionsPayload, error)
}

type geminiClient struct {
	apiKey     string
	model      string
	httpClient *http.Client
}

func NewAIClient(cfg *config.Config) AIClient {
	model := cfg.AIModel
	if model == "" {
		model = "gemini-2.5-flash"
	}

	return &geminiClient{
		apiKey: cfg.AIAPIKey,
		model:  model,
		httpClient: &http.Client{
			Timeout: 90 * time.Second,
		},
	}
}

// GenerateQuestions memanggil Google Gemini API dengan Structured JSON Schema
func (c *geminiClient) GenerateQuestions(ctx context.Context, prompt string) (*GeneratedQuestionsPayload, error) {
	// Fallback untuk development / demo jika API Key belum diisi
	if c.apiKey == "" {
		return c.generateMockQuestions()
	}

	url := fmt.Sprintf(
		"https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s",
		c.model,
		c.apiKey,
	)

	reqBodyMap := map[string]interface{}{
		"contents": []map[string]interface{}{
			{
				"role": "user",
				"parts": []map[string]interface{}{
					{"text": prompt},
				},
			},
		},
		"generationConfig": map[string]interface{}{
			"temperature":        0.4,
			"response_mime_type": "application/json",
			"response_schema":    GetGeminiJSONSchema(),
		},
	}

	reqJSON, err := json.Marshal(reqBodyMap)
	if err != nil {
		return nil, fmt.Errorf("gagal marshal request gemini: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewBuffer(reqJSON))
	if err != nil {
		return nil, fmt.Errorf("gagal membuat request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("gagal memanggil Gemini API: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("gagal membaca respons Gemini: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Gemini API error (HTTP %d): %s", resp.StatusCode, string(bodyBytes))
	}

	// Parsing response Gemini
	var geminiResp struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}

	if err := json.Unmarshal(bodyBytes, &geminiResp); err != nil {
		return nil, fmt.Errorf("gagal unmarshal struktur respons Gemini: %w", err)
	}

	if len(geminiResp.Candidates) == 0 || len(geminiResp.Candidates[0].Content.Parts) == 0 {
		return nil, errors.New("tidak ada output yang dihasilkan oleh model AI")
	}

	rawJSONText := geminiResp.Candidates[0].Content.Parts[0].Text

	var payload GeneratedQuestionsPayload
	if err := json.Unmarshal([]byte(rawJSONText), &payload); err != nil {
		return nil, fmt.Errorf("output AI tidak sesuai format JSON yang diminta: %w", err)
	}

	return &payload, nil
}

// Mock generator untuk keperluan demo dan unit test
func (c *geminiClient) generateMockQuestions() (*GeneratedQuestionsPayload, error) {
	return &GeneratedQuestionsPayload{
		Questions: []GeneratedQuestionItem{
			{
				CognitiveLevel: "C2",
				StemHTML:       "<p>Manakah dari pernyataan berikut yang paling tepat mendeskripsikan Hukum Kekekalan Energi?</p>",
				Options: []OptionItem{
					{ID: "A", Text: "Energi dapat diciptakan tetapi tidak dapat dimusnahkan."},
					{ID: "B", Text: "Energi tidak dapat diciptakan dan tidak dapat dimusnahkan, hanya dapat berubah bentuk."},
					{ID: "C", Text: "Energi total dalam sistem tertutup selalu berkurang seiring waktu."},
					{ID: "D", Text: "Energi mekanik selalu konstan pada setiap jenis tumbukan."},
					{ID: "E", Text: "Energi potensial selalu lebih besar daripada energi kinetik."},
				},
				CorrectAnswer:   "B",
				ExplanationHTML: "<p>Hukum Pertama Termodinamika menyatakan bahwa energi bersifat kekal; energi tidak dapat diciptakan atau dimusnahkan melainkan berpindah atau berubah bentuk.</p>",
			},
			{
				CognitiveLevel: "C3",
				StemHTML:       "<p>Sebuah mobil bermassa 1.000 kg bergerak dengan kecepatan 20 m/s. Berapakah energi kinetik mobil tersebut?</p>",
				Options: []OptionItem{
					{ID: "A", Text: "100.000 Joule"},
					{ID: "B", Text: "200.000 Joule"},
					{ID: "C", Text: "400.000 Joule"},
					{ID: "D", Text: "10.000 Joule"},
					{ID: "E", Text: "50.000 Joule"},
				},
				CorrectAnswer:   "B",
				ExplanationHTML: "<p>Rumus energi kinetik adalah <code>Ek = 1/2 * m * v^2</code>. Maka <code>Ek = 0.5 * 1000 * (20^2) = 500 * 400 = 200.000 Joule</code>.</p>",
			},
		},
	}, nil
}
