import { FileText } from 'lucide-react'
import { useI18n } from '../lib/i18n'

/*
 * TemplatesPanel.tsx — 模板面板（占位）
 * ==========================================
 * 后续用于管理和使用命令模板
 */

export default function TemplatesPanel() {
  const { t } = useI18n()

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
        <FileText size={32} className="text-vscode-text-dim/30" />
        <p className="text-[11px] text-vscode-text-dim">{t('templates', '命令模板')}</p>
        <p className="text-[10px] text-vscode-text-dim/60">{t('templatesHint', '模板功能即将推出')}</p>
      </div>
    </div>
  )
}
