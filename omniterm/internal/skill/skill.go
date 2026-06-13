package skill

import (
    "fmt"
    "os"
    "path/filepath"
    "sync"

    "gopkg.in/yaml.v3"
)

type Skill struct {
    ID          string            `yaml:"id"`
    Name        string            `yaml:"name"`
    Version     string            `yaml:"version"`
    Author      string            `yaml:"author"`
    Description string            `yaml:"description"`
    Requires    string            `yaml:"requires_parser"`
    Commands    map[string]string `yaml:"detection_commands,omitempty"`
    Enabled     bool              `yaml:"enabled"`
    Builtin     bool              `yaml:"builtin"`
    VendorRules []VendorRule      `yaml:"vendor_rules,omitempty"`
    ModeRules   map[string][]ModeRule `yaml:"mode_rules,omitempty"`
}

type VendorRule struct {
    Vendor string     `yaml:"vendor"`
    Banner []string   `yaml:"banner,omitempty"`
    Prompt PromptRule `yaml:"prompt,omitempty"`
}

type PromptRule struct {
    Patterns []string `yaml:"patterns"`
    Exclude  []string `yaml:"exclude,omitempty"`
}

type ModeRule struct {
    Mode   string `yaml:"mode"`
    Match string `yaml:"match"`
}

type Manager struct {
    skillsDir string
    skills    map[string]*Skill
    mu        sync.RWMutex
}

func NewManager(skillsDir string) *Manager {
    return &Manager{
        skillsDir: skillsDir,
        skills:    make(map[string]*Skill),
    }
}

func (m *Manager) LoadAll() error {
    if err := os.MkdirAll(m.skillsDir, 0755); err != nil {
        return fmt.Errorf("create skills dir: %w", err)
    }

    entries, err := os.ReadDir(m.skillsDir)
    if err != nil {
        return fmt.Errorf("read skills dir: %w", err)
    }

    m.mu.Lock()
    defer m.mu.Unlock()

    for _, entry := range entries {
        if entry.IsDir() {
            continue
        }
        ext := filepath.Ext(entry.Name())
        if ext != ".yaml" && ext != ".yml" {
            continue
        }

        path := filepath.Join(m.skillsDir, entry.Name())
        data, err := os.ReadFile(path)
        if err != nil {
            continue
        }

        var skill Skill
        if err := yaml.Unmarshal(data, &skill); err != nil {
            continue
        }

        if skill.ID == "" {
            continue
        }

        skill.Enabled = true
        m.skills[skill.ID] = &skill
    }

    return nil
}

func (m *Manager) Get(id string) *Skill {
    m.mu.RLock()
    defer m.mu.RUnlock()
    return m.skills[id]
}

func (m *Manager) List() []*Skill {
    m.mu.RLock()
    defer m.mu.RUnlock()
    list := make([]*Skill, 0, len(m.skills))
    for _, s := range m.skills {
        list = append(list, s)
    }
    return list
}

func (m *Manager) ListEnabled() []*Skill {
    m.mu.RLock()
    defer m.mu.RUnlock()
    list := make([]*Skill, 0, len(m.skills))
    for _, s := range m.skills {
        if s.Enabled {
            list = append(list, s)
        }
    }
    return list
}

func (m *Manager) Enable(id string) error {
    m.mu.Lock()
    defer m.mu.Unlock()
    s, ok := m.skills[id]
    if !ok {
        return fmt.Errorf("skill %s not found", id)
    }
    s.Enabled = true
    return nil
}

func (m *Manager) Disable(id string) error {
    m.mu.Lock()
    defer m.mu.Unlock()
    s, ok := m.skills[id]
    if !ok {
        return fmt.Errorf("skill %s not found", id)
    }
    s.Enabled = false
    return nil
}

func (m *Manager) Install(skill *Skill) error {
    m.mu.Lock()
    defer m.mu.Unlock()

    path := filepath.Join(m.skillsDir, skill.ID+".skill.yaml")
    data, err := yaml.Marshal(skill)
    if err != nil {
        return fmt.Errorf("marshal skill: %w", err)
    }
    if err := os.WriteFile(path, data, 0644); err != nil {
        return fmt.Errorf("write skill file: %w", err)
    }
    m.skills[skill.ID] = skill
    return nil
}

func (m *Manager) Uninstall(id string) error {
    m.mu.Lock()
    defer m.mu.Unlock()

    path := filepath.Join(m.skillsDir, id+".skill.yaml")
    if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
        return fmt.Errorf("remove skill file: %w", err)
    }
    delete(m.skills, id)
    return nil
}

func (m *Manager) EnsureBuiltin(id, name, description string) error {
    m.mu.RLock()
    _, exists := m.skills[id]
    m.mu.RUnlock()
    if exists {
        return nil
    }

    skill := &Skill{
        ID:          id,
        Name:        name,
        Version:     "1.0.0",
        Author:      "OmniMind",
        Description: description,
        Builtin:     true,
        Enabled:     true,
    }

    path := filepath.Join(m.skillsDir, id+".skill.yaml")
    data, err := yaml.Marshal(skill)
    if err != nil {
        return fmt.Errorf("marshal builtin skill: %w", err)
    }
    if err := os.WriteFile(path, data, 0644); err != nil {
        return fmt.Errorf("write builtin skill: %w", err)
    }

    m.mu.Lock()
    m.skills[id] = skill
    m.mu.Unlock()
    return nil
}
