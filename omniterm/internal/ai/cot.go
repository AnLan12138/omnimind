package ai

/*
 * cot.go — 思维链管线引擎
 * ==========================================
 * 强制 Agent 按固定阶段顺序执行：
 *   ① 设备识别 → ② 知识检索 → ③ 状态探测 → ④ 方案生成 → ⑤ 确认执行
 */

// PipelineStage defines one stage in the reasoning pipeline
type PipelineStage struct {
	Order       int
	Name        string   // 阶段名称
	Goal        string   // 该阶段目标
	MustUse     []string // 必须使用的工具
	MustNotUse  []string // 禁止使用的工具
	OutputDesc  string   // 期望产出
}

// Pipeline 执行管线
type Pipeline struct {
	Enabled bool
	Stages  []PipelineStage
	Current int
}

// NewPipeline creates the default 5-stage pipeline
func NewPipeline() *Pipeline {
	return &Pipeline{
		Enabled: true,
		Current: 0,
		Stages: []PipelineStage{
			{
				Order: 1, Name: "设备识别",
				Goal:     "先列出所有已连接设备，确定每台设备的厂商、型号、OS类型。需要配置操作时必须知道目标设备是什么",
				MustUse:  []string{"list_devices"},
				MustNotUse: []string{"send_config", "execute_config"},
				OutputDesc: "设备列表(厂商+型号+connId)",
			},
			{
				Order: 2, Name: "知识检索",
				Goal:     "查询知识库获取对应厂商的配置命令语法。例如Cisco用show/conf t/switchport，Huawei用display/system-view/port，不要混用",
				MustUse:  []string{"search_knowledge"},
				MustNotUse: []string{"send_config", "execute_config"},
				OutputDesc: "该厂商的正确命令语法",
			},
			{
				Order: 3, Name: "状态探测",
				Goal:     "用只读命令收集设备当前状态。例如当前VLAN有哪些、接口状态如何、现有配置是什么。不要直接给方案，先了解现状",
				MustUse:  []string{"send_command"},
				MustNotUse: []string{"send_config", "execute_config"},
				OutputDesc: "设备当前状态(已有配置、接口状态等)",
			},
			{
				Order: 4, Name: "方案生成",
				Goal:     "结合①设备类型+②命令语法+③当前状态，生成具体的配置命令。Cisco和Huawei分别列，展示给用户",
				MustUse:  []string{}, // 可以不用工具，直接生成文本方案
				MustNotUse: []string{"execute_config"},
				OutputDesc: "待执行的配置命令列表",
			},
			{
				Order: 5, Name: "确认执行",
				Goal:     "用户明确说确认/批准/继续/执行后，用send_config提交命令。用户说取消/不要/停止则放弃",
				MustUse:  []string{}, // 等待用户确认
				OutputDesc: "调用send_config → 用户确认 → execute_config执行",
			},
		},
	}
}

// BuildPrompt 生成管线指令注入到 system prompt
func (p *Pipeline) BuildPrompt() string {
	if !p.Enabled {
		return ""
	}
	return `## 重要: 你必须严格按照以下管线顺序操作，不能跳过任何阶段！
对于任何需要操作设备的请求，按顺序执行:

### 阶段①: 设备识别 + 技能激活
先调用 list_devices 确认所有设备的厂商、型号。然后根据厂商调用 activate_skill 激活对应技能（Cisco→cisco-expert, Huawei→huawei-expert, H3C→huawei-expert）。如果不知道是什么设备，不能进入下一步。

### 阶段②: 知识检索
调用 search_knowledge 查询对应厂商的配置语法。例如设备是Cisco就查"Cisco", 是Huawei就查"Huawei"。不同厂商命令完全不同！

### 阶段③: 状态探测
用 send_command 发送只读查询命令（show/display），收集设备当前状态。先看现状，再出方案。

### 阶段④: 方案生成
结合设备类型+知识库语法+当前状态，生成具体的配置命令。分设备列出，展示给用户审核。

### 阶段⑤: 确认执行
展示方案后等待用户确认。用户说"确认"后，用 send_config 提交，再用 execute_config 执行。用户说"取消"则停止。

## 核心原则:
- 绝对不要跳过阶段！没有stage①的设备信息就不能查RAG
- 没有stage②的语法知识就不能发配置命令
- 没有stage③的状态就不知道需要改什么
- 不同设备厂商的命令语法不同，Cisco和Huawei必须分开处理`
}
