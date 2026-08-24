import { useEffect, useState } from 'react'
import { Modal } from '../shared/Modal'
import { Input } from '../shared/Input'
import { Button } from '../shared/Button'
import { useTranslation } from '../../i18n'
import type { NoteTemplate } from '../../api/notes'

type Props = {
  open: boolean
  title: string
  initialValue?: string
  initialTemplate?: string
  templates?: NoteTemplate[]
  onSubmit: (path: string, templatePath?: string) => void
  onClose: () => void
}

export function NoteNameDialog({ open, title, initialValue = '', initialTemplate = '', templates = [], onSubmit, onClose }: Props) {
  const t = useTranslation()
  const [value, setValue] = useState(initialValue)
  const [template, setTemplate] = useState(initialTemplate)

  useEffect(() => {
    if (open) {
      setValue(initialValue)
      setTemplate(initialTemplate)
    }
  }, [open, initialValue, initialTemplate])

  const submit = () => {
    const v = value.trim()
    if (!v) return
    onSubmit(v.endsWith('.md') ? v : `${v}.md`, template || undefined)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={title} width={420}>
      <div className="flex flex-col gap-[14px] p-[20px]">
        <Input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder={t('notes.pathPlaceholder')}
        />
        {templates.length > 0 && (
          <select
            value={template}
            onChange={e => setTemplate(e.target.value)}
            className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-[10px] py-[8px] text-[13px] outline-none"
          >
            <option value="">{t('notes.noTemplate')}</option>
            {templates.map(tpl => (
              <option key={tpl.path} value={tpl.path}>{tpl.name}</option>
            ))}
          </select>
        )}
        <div className="flex justify-end gap-[8px]">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={submit} disabled={!value.trim()}>{t('common.save')}</Button>
        </div>
      </div>
    </Modal>
  )
}
