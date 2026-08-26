/**
 * Elenco documenti con ricerca e filtro per categoria.
 *
 * Le miniature mostrano l'icona della categoria, non l'immagine reale: elencare
 * i documenti non deve richiedere di decifrare (né esporre) le scansioni. Il
 * contenuto si vede aprendo la scheda, dopo la riconferma d'identità.
 */
import { useMemo, useState } from 'react'
import { CATEGORIES, category } from '../lib/categories'
import { expiryInfo, formatTimestamp } from '../lib/format'
import type { CategoryId, ArchivioDocument } from '../types'
import { useArchivio } from '../state/ArchivioProvider'
import { Icon } from './Icon'
import { EmptyState } from './ui'

export interface DocumentListProps {
  documents: ArchivioDocument[]
  onOpen: (doc: ArchivioDocument) => void
  onAdd?: () => void
  /** Nome del proprietario, mostrato quando la lista mescola più profili. */
  ownerNameFor?: (doc: ArchivioDocument) => string | undefined
  emptyText?: string
}

export function DocumentList({
  documents,
  onOpen,
  onAdd,
  ownerNameFor,
  emptyText,
}: DocumentListProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<CategoryId | 'all'>('all')

  const counts = useMemo(() => {
    const map = new Map<CategoryId, number>()
    for (const doc of documents) map.set(doc.category, (map.get(doc.category) ?? 0) + 1)
    return map
  }, [documents])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return documents.filter((doc) => {
      if (filter !== 'all' && doc.category !== filter) return false
      if (!needle) return true
      // La ricerca guarda titolo, note e valori dei campi: tutto già decifrato in memoria.
      const haystack = [
        doc.title,
        doc.notes ?? '',
        ...doc.fields.map((f) => f.value),
        category(doc.category).label,
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [documents, query, filter])

  if (documents.length === 0) {
    return (
      <EmptyState
        icon="folder"
        title="Nessun documento"
        text={emptyText ?? 'Aggiungi la tua carta d’identità o un altro documento per iniziare.'}
        action={
          onAdd && (
            <button type="button" className="btn btn-primary" onClick={onAdd}>
              <Icon name="plus" size={18} />
              Aggiungi documento
            </button>
          )
        }
      />
    )
  }

  const activeCategories = CATEGORIES.filter((c) => counts.has(c.id))

  return (
    <div className="stack">
      <div className="search">
        <Icon name="search" size={17} />
        <input
          className="input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cerca per titolo, dato, categoria…"
          aria-label="Cerca nei documenti"
        />
      </div>

      {activeCategories.length > 1 && (
        <div className="chip-row">
          <button
            type="button"
            className="chip"
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            Tutti <span className="chip-count">{documents.length}</span>
          </button>
          {activeCategories.map((c) => (
            <button
              key={c.id}
              type="button"
              className="chip"
              aria-pressed={filter === c.id}
              onClick={() => setFilter(c.id)}
            >
              {c.short} <span className="chip-count">{counts.get(c.id)}</span>
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState icon="search" title="Nessun risultato" text="Prova con un altro termine." />
      ) : (
        <ul className="doc-list">
          {visible.map((doc, index) => (
            <li key={doc.id}>
              <DocumentCard
                doc={doc}
                index={index}
                ownerName={ownerNameFor?.(doc)}
                onOpen={() => onOpen(doc)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function DocumentCard({
  doc,
  onOpen,
  ownerName,
  index = 0,
}: {
  doc: ArchivioDocument
  onOpen: () => void
  ownerName?: string
  index?: number
}) {
  const { snapshot } = useArchivio()
  const def = category(doc.category)
  const expiry = expiryInfo(doc, snapshot.settings.expiryWarningDays)
  const sides = doc.assets.length

  return (
    <button
      type="button"
      className="doc-card"
      onClick={onOpen}
      style={{
        ['--cat-color' as string]: `var(--cat-${def.accent})`,
        // Ingresso a cascata: dà ritmo alla lista senza rallentarla.
        animationDelay: `${Math.min(index, 8) * 35}ms`,
      }}
    >
      <span className="doc-thumb">
        <Icon name={def.icon as never} size={24} />
      </span>

      <span className="doc-body">
        <span className="doc-title truncate" style={{ display: 'block' }}>
          {doc.title}
        </span>
        <span className="doc-sub">
          <span>{def.short}</span>
          {ownerName && <span className="doc-sub-dot">{ownerName}</span>}
          {sides > 0 && (
            <span className="doc-sub-dot">
              {sides === 2 ? 'fronte + retro' : sides === 1 ? 'solo fronte' : `${sides} file`}
            </span>
          )}
          {sides === 0 && doc.credential && <span className="doc-sub-dot">credenziali</span>}
        </span>
      </span>

      {expiry.state === 'expired' ? (
        <span className="badge badge-danger">Scaduto</span>
      ) : expiry.state === 'soon' ? (
        <span className="badge badge-warning">{expiry.days === 0 ? 'Oggi' : `${expiry.days} g`}</span>
      ) : (
        <span className="dim" style={{ fontSize: 'var(--text-2xs)' }}>
          {formatTimestamp(doc.updatedAt).split(',')[0]}
        </span>
      )}

      <Icon name="chevron-right" size={17} className="dim" />
    </button>
  )
}
