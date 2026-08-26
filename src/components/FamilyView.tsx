/**
 * Sezione documenti dei familiari.
 *
 * Ogni familiare è un profilo a sé: i suoi documenti non compaiono mai nella
 * vista personale e viceversa. Si entra scegliendo il profilo, e da quel momento
 * l'app mostra solo i suoi documenti.
 */
import { useMemo, useState } from 'react'
import { initials } from '../lib/format'
import { randomId } from '../lib/crypto'
import { archivio, SELF_PROFILE_ID } from '../lib/archivio'
import type { Profile, ArchivioDocument } from '../types'
import { useArchivio } from '../state/ArchivioProvider'
import { Icon } from './Icon'
import { ConfirmSheet, EmptyState, Sheet } from './ui'

const PALETTE_SIZE = 6

export interface FamilyViewProps {
  profiles: Profile[]
  documents: ArchivioDocument[]
  onSelect: (profile: Profile) => void
}

export function FamilyView({ profiles, documents, onSelect }: FamilyViewProps) {
  const { toast } = useArchivio()
  const [editing, setEditing] = useState<Profile | 'new' | null>(null)
  const [toDelete, setToDelete] = useState<Profile | null>(null)

  const family = useMemo(() => profiles.filter((p) => !p.isSelf), [profiles])
  const countFor = (profileId: string) => documents.filter((d) => d.profileId === profileId).length

  return (
    <>
      <section>
        <div className="section-title">
          <h2>Familiari</h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} />
            Aggiungi
          </button>
        </div>

        <p className="muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
          I documenti di ogni familiare restano in un'area separata, protetta dagli stessi metodi di
          sblocco.
        </p>

        {family.length === 0 ? (
          <EmptyState
            icon="users"
            title="Nessun familiare"
            text="Crea un profilo per conservare i documenti di tua moglie, di un figlio o di un genitore."
            action={
              <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
                <Icon name="plus" size={18} />
                Aggiungi familiare
              </button>
            }
          />
        ) : (
          <ul className="stack">
            {family.map((profile) => (
              <li key={profile.id}>
                <div
                  className="card card-pad row"
                  style={{ ['--profile-color' as string]: `var(--profile-${profile.colorIndex % PALETTE_SIZE})` }}
                >
                  <span className="avatar avatar-lg">{initials(profile.name)}</span>
                  <button
                    type="button"
                    className="grow"
                    style={{ textAlign: 'left' }}
                    onClick={() => onSelect(profile)}
                  >
                    <span className="doc-title" style={{ display: 'block' }}>
                      {profile.name}
                    </span>
                    <span className="doc-sub">
                      {profile.relation && <span>{profile.relation}</span>}
                      <span className={profile.relation ? 'doc-sub-dot' : ''}>
                        {countFor(profile.id)}{' '}
                        {countFor(profile.id) === 1 ? 'documento' : 'documenti'}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label={`Modifica ${profile.name}`}
                    onClick={() => setEditing(profile)}
                  >
                    <Icon name="edit" size={17} />
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label={`Elimina ${profile.name}`}
                    onClick={() => setToDelete(profile)}
                  >
                    <Icon name="trash" size={17} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <ProfileSheet
          profile={editing === 'new' ? null : editing}
          usedColors={family.map((p) => p.colorIndex)}
          onClose={() => setEditing(null)}
          onSave={async (profile) => {
            await archivio.saveProfile(profile)
            setEditing(null)
            toast(editing === 'new' ? 'Profilo creato.' : 'Profilo aggiornato.', 'success')
          }}
        />
      )}

      <ConfirmSheet
        open={toDelete !== null}
        title={`Eliminare ${toDelete?.name ?? ''}?`}
        destructive
        confirmLabel="Elimina tutto"
        body={
          <>
            Verranno cancellati il profilo e i suoi {countFor(toDelete?.id ?? '')} documenti, immagini
            comprese. L'operazione non è annullabile.
          </>
        }
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (toDelete) await archivio.deleteProfile(toDelete.id)
          setToDelete(null)
          toast('Profilo eliminato.', 'success')
        }}
      />
    </>
  )
}

/* ---------------------------- creazione/modifica ------------------------- */

function ProfileSheet({
  profile,
  usedColors,
  onSave,
  onClose,
}: {
  profile: Profile | null
  usedColors: number[]
  onSave: (profile: Profile) => void | Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(profile?.name ?? '')
  const [relation, setRelation] = useState(profile?.relation ?? '')
  const [colorIndex, setColorIndex] = useState(
    profile?.colorIndex ??
      // Primo colore libero, per non avere due avatar identici.
      [1, 2, 3, 4, 5, 0].find((i) => !usedColors.includes(i)) ??
      1,
  )
  const [saving, setSaving] = useState(false)

  return (
    <Sheet open onClose={onClose} title={profile ? 'Modifica profilo' : 'Nuovo familiare'}>
      <div className="stack">
        <div className="field">
          <label className="label" htmlFor="profile-name">
            Nome
          </label>
          <input
            id="profile-name"
            className="input"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="Es. Giulia"
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="profile-relation">
            Relazione (opzionale)
          </label>
          <input
            id="profile-relation"
            className="input"
            value={relation}
            onChange={(e) => setRelation(e.target.value)}
            placeholder="Moglie, figlio, madre…"
          />
        </div>

        <div className="field">
          <span className="label">Colore</span>
          <div className="row" style={{ gap: 'var(--space-3)' }}>
            {Array.from({ length: PALETTE_SIZE }).map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Colore ${i + 1}`}
                aria-pressed={colorIndex === i}
                onClick={() => setColorIndex(i)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--radius-pill)',
                  background: `var(--profile-${i})`,
                  outline: colorIndex === i ? '2px solid var(--text-primary)' : 'none',
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="sheet-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
          Annulla
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!name.trim() || saving}
          onClick={async () => {
            setSaving(true)
            await onSave({
              id: profile?.id ?? randomId(),
              name: name.trim(),
              relation: relation.trim() || undefined,
              colorIndex,
              isSelf: false,
              createdAt: profile?.createdAt ?? Date.now(),
            })
            setSaving(false)
          }}
        >
          {profile ? 'Salva' : 'Crea profilo'}
        </button>
      </div>
    </Sheet>
  )
}

/* ------------------------------ selettore profilo ----------------------- */

export function ProfileSwitcher({
  profiles,
  activeId,
  onSelect,
  familyEnabled,
}: {
  profiles: Profile[]
  activeId: string
  onSelect: (id: string) => void
  familyEnabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const active = profiles.find((p) => p.id === activeId) ?? profiles[0]
  if (!active) return null

  const selectable = familyEnabled ? profiles : profiles.filter((p) => p.isSelf)
  if (selectable.length <= 1) {
    return (
      <span
        className="profile-switcher"
        style={{ ['--profile-color' as string]: `var(--profile-${active.colorIndex % PALETTE_SIZE})` }}
      >
        <span className="avatar">{initials(active.name)}</span>
        <span className="profile-name truncate">{shortName(active)}</span>
      </span>
    )
  }

  return (
    <>
      <button
        type="button"
        className="profile-switcher"
        style={{ ['--profile-color' as string]: `var(--profile-${active.colorIndex % PALETTE_SIZE})` }}
        onClick={() => setOpen(true)}
        aria-label="Cambia profilo"
      >
        <span className="avatar">{initials(active.name)}</span>
        <span className="profile-name truncate">{shortName(active)}</span>
        <Icon name="chevron-right" size={14} className="dim" />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Scegli il profilo">
        <div className="stack-sm">
          {selectable.map((profile) => (
            <button
              key={profile.id}
              type="button"
              className="profile-option"
              aria-current={profile.id === activeId}
              style={{ ['--profile-color' as string]: `var(--profile-${profile.colorIndex % PALETTE_SIZE})` }}
              onClick={() => {
                onSelect(profile.id)
                setOpen(false)
              }}
            >
              <span className="avatar">{initials(profile.name)}</span>
              <span className="grow">
                <span className="list-row-title">{shortName(profile)}</span>
                {profile.relation && <span className="list-row-desc">{profile.relation}</span>}
                {profile.id === SELF_PROFILE_ID && (
                  <span className="list-row-desc">Profilo principale</span>
                )}
              </span>
              {profile.id === activeId && (
                <span style={{ color: 'var(--accent)' }}>
                  <Icon name="check" size={18} />
                </span>
              )}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  )
}

function shortName(profile: Profile): string {
  return profile.isSelf ? 'Io' : profile.name
}
