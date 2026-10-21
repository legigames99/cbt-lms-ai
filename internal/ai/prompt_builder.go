package ai

import (
	"fmt"
	"strings"
)

type PromptBuilder struct{}

func NewPromptBuilder() *PromptBuilder {
	return &PromptBuilder{}
}

func (b *PromptBuilder) BuildQuestionPrompt(materialTitle, materialContent string, req GenerateQuestionsJobRequest) string {
	var distBuilder strings.Builder
	for level, count := range req.CognitiveDistribution {
		distBuilder.WriteString(fmt.Sprintf("- Level %s: %d soal\n", level, count))
	}

	distStr := distBuilder.String()
	if distStr == "" {
		distStr = fmt.Sprintf("- Level C2–C4: %d soal secara proporsional\n", req.QuestionCount)
	}

	prompt := fmt.Sprintf(`Anda adalah asisten ahli pembuat soal ujian sekolah tingkat menengah (SMP/SMA/SMK) berstandar Kurikulum Merdeka dan Taksonomi Bloom.

TUGAS:
Buatlah tepat %d butir soal pilihan ganda (5 opsi: A, B, C, D, E) berdasarkan materi pembelajaran berikut.

JUDUL MATERI:
%s

ISI MATERI PEMBELAJARAN:
"""
%s
"""

DISTRIBUSI TINGKAT KOGNITIF (BLOOM):
%s

INSTRUKSI KHUSUS DARI GURU:
%s

PEDOMAN KETAT:
1. Setiap soal wajib memiliki 5 opsi jawaban (A, B, C, D, E) dengan 1 kunci jawaban yang paling tepat.
2. Kalimat soal (stem_html) harus jelas, tidak ambigu, menggunakan bahasa Indonesia baku, dan boleh menggunakan tag HTML sederhana (misal <p>, <strong>, <em>, <ol>, <ul>, <table>).
3. Penjelasan (explanation_html) wajib menjelaskan mengapa kunci tersebut benar dan mendidik siswa secara konseptual.
4. Jangan membuat soal yang jawabannya "Semua jawaban benar" atau "Tidak ada jawaban yang benar".
5. Keluaran WAJIB mengikuti skema JSON terstruktur yang telah ditentukan.`,
		req.QuestionCount,
		materialTitle,
		materialContent,
		distStr,
		req.AdditionalPrompt,
	)

	return prompt
}
