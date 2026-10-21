package ai

import "encoding/json"

// GeneratedQuestionItem mencerminkan satu butir soal hasil generasi AI
type GeneratedQuestionItem struct {
	CognitiveLevel  string       `json:"cognitive_level"` // C1 - C6
	StemHTML        string       `json:"stem_html"`
	Options         []OptionItem `json:"options"`
	CorrectAnswer   string       `json:"correct_answer"` // "A", "B", "C", "D", "E"
	ExplanationHTML string       `json:"explanation_html"`
}

type OptionItem struct {
	ID   string `json:"id"`   // "A", "B", "C", "D", "E"
	Text string `json:"text"` // Isi pilihan jawaban
}

type GeneratedQuestionsPayload struct {
	Questions []GeneratedQuestionItem `json:"questions"`
}

type GenerateQuestionsJobRequest struct {
	CourseID              int            `json:"course_id"`
	MaterialID            int            `json:"material_id"`
	BankID                int            `json:"bank_id"`
	QuestionCount         int            `json:"question_count"`
	QuestionType          string         `json:"question_type"` // "mcq"
	CognitiveDistribution map[string]int `json:"cognitive_distribution"` // {"C2": 5, "C3": 10, ...}
	AdditionalPrompt      string         `json:"additional_prompt,omitempty"`
}

type JobStatus string

const (
	JobStatusQueued     JobStatus = "queued"
	JobStatusProcessing JobStatus = "processing"
	JobStatusCompleted  JobStatus = "completed"
	JobStatusFailed     JobStatus = "failed"
)

type AIJobProgressEvent struct {
	JobID         string    `json:"job_id"`
	Status        JobStatus `json:"status"`
	Completed     int       `json:"completed"`
	Total         int       `json:"total"`
	Message       string    `json:"message,omitempty"`
	InsertedCount int       `json:"inserted_count,omitempty"`
}

// GetGeminiJSONSchema mengembalikan skema JSON baku untuk dipaksakan ke Gemini / OpenAI API
func GetGeminiJSONSchema() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"questions": map[string]interface{}{
				"type": "array",
				"items": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"cognitive_level": map[string]interface{}{
							"type": "string",
							"enum": []string{"C1", "C2", "C3", "C4", "C5", "C6"},
						},
						"stem_html": map[string]interface{}{
							"type": "string",
						},
						"options": map[string]interface{}{
							"type": "array",
							"items": map[string]interface{}{
								"type": "object",
								"properties": map[string]interface{}{
									"id": map[string]interface{}{
										"type": "string",
										"enum": []string{"A", "B", "C", "D", "E"},
									},
									"text": map[string]interface{}{
										"type": "string",
									},
								},
								"required": []string{"id", "text"},
							},
						},
						"correct_answer": map[string]interface{}{
							"type": "string",
							"enum": []string{"A", "B", "C", "D", "E"},
						},
						"explanation_html": map[string]interface{}{
							"type": "string",
						},
					},
					"required": []string{"cognitive_level", "stem_html", "options", "correct_answer", "explanation_html"},
				},
			},
		},
		"required": []string{"questions"},
	}
}

func MarshalJSON(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}
