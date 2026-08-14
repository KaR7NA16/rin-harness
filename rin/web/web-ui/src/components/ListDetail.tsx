import { useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { JsonDetail } from './JsonDetail'

export interface ListItemLabel {
  title: string
  subtitle?: string
}

export function ListDetail<T>(props: {
  items: T[]
  label: (item: T, index: number) => ListItemLabel
  empty?: string
  renderDetail?: (item: T) => ReactNode
}): ReactElement {
  const { items, label, empty = 'no results', renderDetail } = props
  const [selected, setSelected] = useState<number | null>(null)

  if (items.length === 0) {
    return <div className="muted">{empty}</div>
  }

  const selectedItem = selected !== null && selected < items.length ? items[selected] : null

  return (
    <div className="two-pane">
      <div className="list-pane">
        <ul className="item-list">
          {items.map((item, index) => {
            const entry = label(item, index)
            return (
              <li key={index}>
                <button
                  type="button"
                  className={selected === index ? 'item-button item-button-active' : 'item-button'}
                  onClick={() => setSelected(index)}
                >
                  <span className="item-title">{entry.title}</span>
                  {entry.subtitle ? <span className="item-subtitle">{entry.subtitle}</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
      <div className="detail-pane">
        {selectedItem === null ? (
          <div className="muted">Select an item to inspect it.</div>
        ) : (
          <>
            <div className="detail-header">{label(selectedItem, selected ?? 0).title}</div>
            {renderDetail !== undefined ? renderDetail(selectedItem) : <JsonDetail value={selectedItem} />}
          </>
        )}
      </div>
    </div>
  )
}
