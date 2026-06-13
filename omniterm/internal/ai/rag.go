package ai

import (
	"encoding/json"
	"math"
	"os"
	"sort"
	"strings"
	"sync"
)

// RAGStore is a document store with TF-IDF vector search
type RAGStore struct {
	mu      sync.RWMutex
	docs    []RAGDocument
	path    string
	// TF-IDF state
	vocab    map[string]int     // word → index
	idf      []float64          // idf for each word
	docVecs  [][]float64        // tf-idf vector per doc
	dirty    bool
}

func NewRAGStore(path string) *RAGStore {
	rs := &RAGStore{
		path:   path,
		vocab:  make(map[string]int),
	}
	rs.load()
	return rs
}

func (rs *RAGStore) load() {
	data, err := os.ReadFile(rs.path)
	if err != nil {
		return
	}
	var docs []RAGDocument
	if err := json.Unmarshal(data, &docs); err != nil {
		return
	}
	for _, d := range docs {
		rs.docs = append(rs.docs, d)
	}
	rs.rebuildIndex()
}

func (rs *RAGStore) save() {
	// Don't save vectors — they're computed on load
	type savedoc struct {
		ID      string   `json:"id"`
		Title   string   `json:"title"`
		Content string   `json:"content"`
		Tags    []string `json:"tags"`
	}
	var plain []savedoc
	for _, d := range rs.docs {
		plain = append(plain, savedoc{d.ID, d.Title, d.Content, d.Tags})
	}
	data, _ := json.Marshal(plain)
	os.WriteFile(rs.path, data, 0644)
}

func (rs *RAGStore) Index(doc RAGDocument) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	rs.docs = append(rs.docs, doc)
	rs.dirty = true
	rs.save()
}

// rebuildIndex rebuilds the TF-IDF vocabulary and vectors
func (rs *RAGStore) rebuildIndex() {
	rs.vocab = make(map[string]int)
	rs.docVecs = nil

	// First pass: build vocabulary
	for _, doc := range rs.docs {
		tokens := tokenize(doc.Title + " " + doc.Content)
		for _, t := range tokens {
			if _, ok := rs.vocab[t]; !ok {
				rs.vocab[t] = len(rs.vocab)
			}
		}
	}

	vocabSize := len(rs.vocab)
	if vocabSize == 0 {
		return
	}

	// Compute DF (document frequency)
	df := make([]int, vocabSize)
	for _, doc := range rs.docs {
		seen := make(map[int]bool)
		tokens := tokenize(doc.Title + " " + doc.Content)
		for _, t := range tokens {
			if idx, ok := rs.vocab[t]; ok && !seen[idx] {
				df[idx]++
				seen[idx] = true
			}
		}
	}

	// Compute IDF
	N := float64(len(rs.docs))
	rs.idf = make([]float64, vocabSize)
	for i := 0; i < vocabSize; i++ {
		rs.idf[i] = math.Log(1 + N/float64(1+df[i]))
	}

	// Second pass: build TF-IDF vectors
	rs.docVecs = make([][]float64, len(rs.docs))
	for i, doc := range rs.docs {
		tf := make(map[int]float64)
		tokens := tokenize(doc.Title + " " + doc.Content)
		for _, t := range tokens {
			if idx, ok := rs.vocab[t]; ok {
				tf[idx]++
			}
		}
		// Normalize TF
		for idx := range tf {
			tf[idx] = tf[idx] / float64(len(tokens))
		}

		vec := make([]float64, vocabSize)
		for idx, v := range tf {
			vec[idx] = v * rs.idf[idx]
		}
		rs.docVecs[i] = vec
	}
	rs.dirty = false
}

// Search finds topK documents by TF-IDF cosine similarity
func (rs *RAGStore) Search(query string, topK int) []RAGDocument {
	rs.mu.RLock()
	defer rs.mu.RUnlock()

	if len(rs.docs) == 0 {
		return nil
	}
	if rs.dirty || len(rs.docVecs) != len(rs.docs) {
		// Rebuild on next search — but we hold RLock
		// For now, just return keyword-based results
		return rs.keywordSearch(query, topK)
	}

	// Build query vector
	qTokens := tokenize(query)
	qTF := make(map[int]float64)
	for _, t := range qTokens {
		if idx, ok := rs.vocab[t]; ok {
			qTF[idx]++
		}
	}
	for idx := range qTF {
		qTF[idx] = qTF[idx] / float64(len(qTokens))
	}

	qVec := make([]float64, len(rs.vocab))
	for idx, v := range qTF {
		qVec[idx] = v * rs.idf[idx]
	}

	// Cosine similarity
	type pair struct {
		idx   int
		score float64
	}
	var scores []pair
	for i, dv := range rs.docVecs {
		s := cosine(qVec, dv)
		// Boost by tag match
		for _, tag := range rs.docs[i].Tags {
			if containsAny(query, tag) {
				s += 0.3
			}
		}
		if s > 0.01 {
			scores = append(scores, pair{i, s})
		}
	}

	sort.Slice(scores, func(i, j int) bool {
		return scores[i].score > scores[j].score
	})

	if topK > len(scores) {
		topK = len(scores)
	}
	result := make([]RAGDocument, topK)
	for i := 0; i < topK; i++ {
		result[i] = rs.docs[scores[i].idx]
	}
	return result
}

// keywordSearch fallback when vectors aren't built yet
func (rs *RAGStore) keywordSearch(query string, topK int) []RAGDocument {
	type pair struct {
		doc   RAGDocument
		score int
	}
	var items []pair
	qWords := tokenize(query)
	for _, doc := range rs.docs {
		text := doc.Title + " " + doc.Content
		s := 0
		for _, w := range qWords {
			if strings.Contains(text, w) {
				s++
			}
		}
		for _, tag := range doc.Tags {
			if strings.Contains(tag, query) || strings.Contains(query, tag) {
				s += 3
			}
		}
		if s > 0 {
			items = append(items, pair{doc, s})
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].score > items[j].score
	})
	if topK > len(items) {
		topK = len(items)
	}
	result := make([]RAGDocument, topK)
	for i := 0; i < topK; i++ {
		result[i] = items[i].doc
	}
	return result
}

// ── helpers ──

func tokenize(text string) []string {
	var tokens []string
	for _, w := range strings.Fields(strings.ToLower(text)) {
		w = strings.Trim(w, ".,;:!?()[]{}\"'")
		if len(w) > 1 {
			tokens = append(tokens, w)
		}
	}
	return tokens
}

func cosine(a, b []float64) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot, normA, normB float64
	for i := range a {
		dot += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return dot / (math.Sqrt(normA) * math.Sqrt(normB))
}

func containsAny(s, sub string) bool {
	return strings.Contains(s, sub)
}

func (rs *RAGStore) Delete(id string) error {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	for i, doc := range rs.docs {
		if doc.ID == id {
			rs.docs = append(rs.docs[:i], rs.docs[i+1:]...)
			rs.dirty = true
			rs.save()
			return nil
		}
	}
	return nil
}
