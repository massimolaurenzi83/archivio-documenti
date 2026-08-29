/**
 * Composizione dell'applicazione.
 *
 * Non c'è un router: le viste sono poche e la navigazione è a schede, quindi lo
 * stato locale è più leggero (e più veloce) di una libreria di routing. Le
 * schermate di blocco e di configurazione precedono qualsiasi altra vista.
 */
import { useEffect, useMemo, useState } from 'react'
import { SELF_PROFILE_ID, archivio } from './lib/archivio'
import type { CategoryId, ArchivioDocument } from './types'
import { useArchivio } from './state/ArchivioProvider'
import { AddDocument } from './components/AddDocument'
import { AuthGate } from './components/AuthGate'
import { BatchImport } from './components/BatchImport'
import { ExportSheet } from './components/BackupPanel'
import { Dashboard } from './components/Dashboard'
import { DocumentDetail } from './components/DocumentDetail'
import { DocumentList } from './components/DocumentList'
import { FamilyView, ProfileSwitcher } from './components/FamilyView'
import { Icon } from './components/Icon'
import { LockScreen } from './components/LockScreen'
import { Onboarding } from './components/Onboarding'
import { SettingsView } from './components/Settings'
import { Toasts } from './components/ui'

type Tab = 'home' | 'documents' | 'family' | 'settings'

export function App() {
  const { snapshot } = useArchivio()
  const [tab, setTab] = useState<Tab>('home')
  const [activeProfileId, setActiveProfileId] = useState(SELF_PROFILE_ID)
  const [openDoc, setOpenDoc] = useState<ArchivioDocument | null>(null)
  const [adding, setAdding] = useState<{ category?: CategoryId } | null>(null)
  const [batch, setBatch] = useState(false)
  const [backup, setBackup] = useState(false)
  const [filterCategory, setFilterCategory] = useState<CategoryId | null>(null)
  const [onboarding, setOnboarding] = useState(false)

  const { status, settings, profiles, documents } = snapshot

  // L'onboarding resta a schermo finché l'utente non lo conclude, anche dopo che
  // il caveau è tecnicamente già creato e sbloccato.
  useEffect(() => {
    if (status === 'uninitialized') setOnboarding(true)
  }, [status])

  // Il tema segue le impostazioni ed è applicato sull'elemento radice.
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  // Chiudere il caveau deve chiudere anche tutto quello che era aperto sopra.
  useEffect(() => {
    if (status !== 'unlocked') {
      setOpenDoc(null)
      setAdding(null)
      setBatch(false)
      setBackup(false)
    }
  }, [status])

  // Se la sezione familiari viene disattivata, si torna al profilo principale.
  useEffect(() => {
    if (!settings.familyEnabled) {
      setActiveProfileId(SELF_PROFILE_ID)
      setTab((current) => (current === 'family' ? 'home' : current))
    }
  }, [settings.familyEnabled])

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? profiles[0],
    [profiles, activeProfileId],
  )

  /** Documenti del solo profilo attivo: le viste non mescolano mai i profili. */
  const profileDocuments = useMemo(
    () => documents.filter((d) => d.profileId === activeProfileId),
    [documents, activeProfileId],
  )

  const listDocuments = useMemo(
    () =>
      filterCategory ? profileDocuments.filter((d) => d.category === filterCategory) : profileDocuments,
    [profileDocuments, filterCategory],
  )

  if (status === 'loading') {
    return (
      <div className="lock-screen">
        <span className="lock-shield">
          <Icon name="shield" size={44} />
        </span>
        <p className="muted">Apertura del caveau…</p>
      </div>
    )
  }

  if (onboarding) {
    return (
      <>
        <Onboarding onDone={() => setOnboarding(false)} />
        <Toasts />
      </>
    )
  }

  if (status === 'locked' || status === 'uninitialized') {
    return (
      <>
        <LockScreen />
        <Toasts />
      </>
    )
  }

  const tabs: { id: Tab; label: string; icon: 'home' | 'folder' | 'users' | 'settings' }[] = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'documents', label: 'Documenti', icon: 'folder' },
    ...(settings.familyEnabled
      ? ([{ id: 'family' as Tab, label: 'Familiari', icon: 'users' as const }])
      : []),
    { id: 'settings', label: 'Impostazioni', icon: 'settings' },
  ]

  const ownerNameFor = (doc: ArchivioDocument) => {
    const owner = profiles.find((p) => p.id === doc.profileId)
    return owner && !owner.isSelf ? owner.name : undefined
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <ProfileSwitcher
          profiles={profiles}
          activeId={activeProfileId}
          familyEnabled={settings.familyEnabled}
          onSelect={(id) => {
            setActiveProfileId(id)
            setFilterCategory(null)
            setTab('home')
          }}
        />
        <span className="grow" />
        <button
          type="button"
          className="btn-icon"
          aria-label="Blocca il caveau"
          title="Blocca il caveau"
          onClick={() => archivio.lock()}
        >
          <Icon name="lock" size={19} />
        </button>
      </header>

      <main className="app-main">
        {tab === 'home' && (
          <Dashboard
            documents={profileDocuments}
            profileName={activeProfile?.isSelf ? 'I miei documenti' : (activeProfile?.name ?? '')}
            onOpen={setOpenDoc}
            onAdd={(cat) => setAdding({ category: cat })}
            onAddMany={() => setBatch(true)}
            onOpenBackup={() => setBackup(true)}
            onGoToDocuments={(cat) => {
              setFilterCategory(cat ?? null)
              setTab('documents')
            }}
            onGoToFamily={() => setTab('family')}
          />
        )}

        {tab === 'documents' && (
          <>
            <div className="section-title">
              <h2>{activeProfile?.isSelf ? 'I miei documenti' : activeProfile?.name}</h2>
              {filterCategory && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setFilterCategory(null)}
                >
                  <Icon name="close" size={14} />
                  Filtro
                </button>
              )}
            </div>
            <DocumentList
              documents={listDocuments}
              onOpen={setOpenDoc}
              onAdd={() => setAdding({})}
              ownerNameFor={ownerNameFor}
            />
          </>
        )}

        {tab === 'family' && settings.familyEnabled && (
          <FamilyView
            profiles={profiles}
            documents={documents}
            onSelect={(profile) => {
              setActiveProfileId(profile.id)
              setFilterCategory(null)
              setTab('documents')
            }}
          />
        )}

        {tab === 'settings' && <SettingsView />}
      </main>

      {(tab === 'home' || tab === 'documents') && (
        <button
          type="button"
          className="fab"
          onClick={() => setAdding({ category: filterCategory ?? undefined })}
        >
          <Icon name="plus" size={20} />
          Aggiungi
        </button>
      )}

      <nav className="bottom-nav" aria-label="Navigazione principale">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className="nav-item"
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => {
              if (item.id === 'documents') setFilterCategory(null)
              setTab(item.id)
            }}
          >
            <Icon name={item.icon} size={21} />
            {item.label}
            <span className="nav-dot" />
          </button>
        ))}
      </nav>

      {openDoc && (
        <DocumentDetail
          // Rileggiamo dallo snapshot: dopo una modifica il documento in stato
          // locale sarebbe una copia obsoleta.
          doc={documents.find((d) => d.id === openDoc.id) ?? openDoc}
          ownerName={ownerNameFor(openDoc)}
          onClose={() => setOpenDoc(null)}
        />
      )}

      {backup && <ExportSheet onClose={() => setBackup(false)} />}

      {batch && activeProfile && (
        <BatchImport
          profileId={activeProfile.id}
          profileName={activeProfile.isSelf ? undefined : activeProfile.name}
          onClose={() => setBatch(false)}
          onSaved={() => {
            setBatch(false)
            setTab('documents')
          }}
        />
      )}

      {adding && activeProfile && (
        <AddDocument
          profileId={activeProfile.id}
          profileName={activeProfile.isSelf ? undefined : activeProfile.name}
          initialCategory={adding.category}
          onClose={() => setAdding(null)}
          onSaved={(doc) => {
            setAdding(null)
            setOpenDoc(doc)
          }}
        />
      )}

      <AuthGate />
      <Toasts />
    </div>
  )
}
