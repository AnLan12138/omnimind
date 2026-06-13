import { useState } from 'react'
import { Bot, BookOpen, Zap } from 'lucide-react'
import { useI18n } from '../lib/i18n'
import AIPanel from './AIPanel'
import KnowledgePanel from './KnowledgePanel'
import SkillPanel from './SkillPanel'

/*
 * RightSidebar.tsx — 右侧边栏
 * ==========================================
 * 三个标签：AI 助手 / 知识库 / 技能
 */

type Tab = 'ai' | 'knowledge' | 'skill'

const tabs: { id: Tab; icon: any; label: string }[] = [
  { id: 'ai', icon: Bot, label: 'AI 助手' },
  { id: 'knowledge', icon: BookOpen, label: '知识库' },
  { id: 'skill', icon: Zap, label: '技能' },
]

export default function RightSidebar() {
  const { t } = useI18n()
  const [active, setActive] = useState<Tab>('ai')

  return (
    <div className="flex flex-col h-full bg-vscode-sidebar">
      {/* Tab bar */}
      <div className="flex shrink-0 border-b border-vscode-border">
        {tabs.map(tab => (
          <button key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`flex items-center gap-1 px-2.5 h-8 text-[11px] transition-colors border-b-2 ${
              active === tab.id
                ? 'border-vscode-accent text-white'
                : 'border-transparent text-vscode-text-muted hover:text-white'
            }`}>
            <tab.icon size={13} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {active === 'ai' && <AIPanel />}
        {active === 'knowledge' && <KnowledgePanel />}
        {active === 'skill' && <SkillPanel />}
      </div>
    </div>
  )
}
