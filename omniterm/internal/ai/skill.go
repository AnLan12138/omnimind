package ai

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// SkillDefinition defines a skill with execution rules
type SkillDefinition struct {
	ID          string   `yaml:"id"`
	Name        string   `yaml:"name"`
	Description string   `yaml:"description"`
	Prompt      string   `yaml:"prompt"`
	Tools       []string `yaml:"tools"`        // allowed tool names
	Rules       []string `yaml:"rules"`        // behavioral rules
	Discovery   struct {
		Commands  []string `yaml:"commands"`    // auto-run on device connect
		TriggerOn []string `yaml:"trigger_on"`  // vendor names that trigger this
		Timeout   int      `yaml:"timeout"`     // seconds to wait for output
	} `yaml:"discovery"`
}

// SkillLoader loads and executes skills
type SkillLoader struct {
	skills    map[string]*SkillDefinition
	executor  SkillExecutor
}

// SkillExecutor is called to run discovery commands
type SkillExecutor func(connID, command string) (string, error)

func NewSkillLoader() *SkillLoader {
	return &SkillLoader{
		skills: make(map[string]*SkillDefinition),
	}
}

func (sl *SkillLoader) SetExecutor(exec SkillExecutor) {
	sl.executor = exec
}

func (sl *SkillLoader) LoadAll(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := filepath.Ext(e.Name())
		if ext != ".yaml" && ext != ".yml" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var sd SkillDefinition
		if err := yaml.Unmarshal(data, &sd); err != nil {
			continue
		}
		sl.skills[sd.ID] = &sd
	}
	return nil
}

func (sl *SkillLoader) List() []string {
	ids := make([]string, 0, len(sl.skills))
	for id := range sl.skills {
		ids = append(ids, id)
	}
	return ids
}

func (sl *SkillLoader) Get(id string) (*SkillDefinition, error) {
	s, ok := sl.skills[id]
	if !ok {
		return nil, fmt.Errorf("skill not found: %s", id)
	}
	return s, nil
}

func (sl *SkillLoader) EnsureBuiltin(dir, id, name, desc string) {
	os.MkdirAll(dir, 0755)
	path := filepath.Join(dir, id+".yaml")
	if _, err := os.Stat(path); err == nil {
		// Already exists — load it
		if data, err := os.ReadFile(path); err == nil {
			var sd SkillDefinition
			if yaml.Unmarshal(data, &sd) == nil {
				sl.skills[id] = &sd
				return
			}
		}
	}
	// Create with defaults
	sd := &SkillDefinition{ID: id, Name: name, Description: desc}
	sl.skills[id] = sd
	data, _ := yaml.Marshal(sd)
	os.WriteFile(path, data, 0644)
}

// RunDiscovery runs discovery commands for all skills matching the vendor
func (sl *SkillLoader) RunDiscovery(connID, vendor string) []string {
	if sl.executor == nil {
		return nil
	}
	var results []string
	for _, sd := range sl.skills {
		if len(sd.Discovery.Commands) == 0 {
			continue
		}
		matched := false
		for _, trigger := range sd.Discovery.TriggerOn {
			if trigger == vendor {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}
		for _, cmd := range sd.Discovery.Commands {
			output, err := sl.executor(connID, cmd)
			if err != nil {
				results = append(results, fmt.Sprintf("[%s] %s → 错误: %v", sd.Name, cmd, err))
			} else {
				results = append(results, fmt.Sprintf("[%s] %s → %s", sd.Name, cmd, truncOutput(output, 500)))
			}
		}
	}
	return results
}

// ApplyToPrompt returns the system prompt addition for a skill
func (sd *SkillDefinition) ApplyToPrompt(base string) string {
	p := base
	if sd.Prompt != "" {
		p += "\n\n## 当前角色: " + sd.Name + "\n" + sd.Prompt
	}
	if len(sd.Rules) > 0 {
		p += "\n\n## 行为规范:"
		for _, r := range sd.Rules {
			p += "\n- " + r
		}
	}
	if len(sd.Tools) > 0 {
		p += "\n\n## 可用工具: " + fmt.Sprintf("%v", sd.Tools)
	}
	return p
}

func truncOutput(s string, n int) string {
	if len(s) > n {
		return s[:n] + "..."
	}
	return s
}
