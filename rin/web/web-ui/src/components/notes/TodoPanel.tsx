import { useEffect, useState } from 'react'
import { CheckSquare, Square } from 'lucide-react'
import { notesApi, type NoteTodo } from '../../api/notes'
import { useTranslation } from '../../i18n'

export function TodoPanel({ onOpenNote }: { onOpenNote: (path: string) => void }) {
  const t = useTranslation()
  const [todos, setTodos] = useState<NoteTodo[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = () => {
    void notesApi.todos()
      .then(r => setTodos(r.todos))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = async (todo: NoteTodo) => {
    // 乐观更新
    setTodos(prev => prev.map(x => x === todo ? { ...x, done: !x.done } : x))
    try {
      await notesApi.setTodo(todo.notePath, todo.line, !todo.done)
    } catch {
      setTodos(prev => prev.map(x => x === todo ? { ...x, done: todo.done } : x))
    }
  }

  const open = todos.filter(x => !x.done)
  const done = todos.filter(x => x.done)

  if (loading) {
    return <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-text-tertiary)]">{t('common.loading')}</div>
  }

  return (
    <div className="h-full overflow-y-auto p-[20px]">
      <div className="mx-auto max-w-[720px]">
        <h2 className="mb-[14px] text-[15px] font-semibold text-[var(--color-text-primary)]">
          {t('notes.todos.open', { count: String(open.length) })}
        </h2>
        {open.length === 0 && (
          <div className="py-[30px] text-center text-[12.5px] text-[var(--color-text-tertiary)]">{t('notes.todos.empty')}</div>
        )}
        <div className="flex flex-col gap-[3px]">
          {open.map((todo, i) => (
            <div key={`${todo.notePath}:${todo.line}:${i}`} className="flex items-start gap-2 rounded-[8px] px-[10px] py-[8px] hover:bg-[var(--color-surface-hover)]">
              <button onClick={() => void toggle(todo)} className="mt-[1px] shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-accent)]">
                <Square size={16} />
              </button>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-[var(--color-text-primary)]">{todo.text}</span>
                <button onClick={() => onOpenNote(todo.notePath)} className="mt-[2px] text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-accent)] hover:underline">
                  {todo.noteName}:{todo.line}
                </button>
              </span>
            </div>
          ))}
        </div>
        {done.length > 0 && (
          <>
            <h2 className="mb-[10px] mt-[26px] text-[13px] font-medium text-[var(--color-text-tertiary)]">
              {t('notes.todos.done', { count: String(done.length) })}
            </h2>
            <div className="flex flex-col gap-[3px] opacity-60">
              {done.map((todo, i) => (
                <div key={`${todo.notePath}:${todo.line}:${i}`} className="flex items-start gap-2 rounded-[8px] px-[10px] py-[6px]">
                  <button onClick={() => void toggle(todo)} className="mt-[1px] shrink-0 text-[var(--color-text-accent)]">
                    <CheckSquare size={16} />
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-[var(--color-text-secondary)] line-through">{todo.text}</span>
                    <span className="text-[11px] text-[var(--color-text-tertiary)]">{todo.noteName}:{todo.line}</span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
