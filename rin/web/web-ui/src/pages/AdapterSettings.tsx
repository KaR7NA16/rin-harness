import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useAdapterStore } from '../stores/adapterStore'
import { useTranslation } from '../i18n'
import { Input } from '../components/shared/Input'
import { Button } from '../components/shared/Button'
import { DirectoryPicker } from '../components/shared/DirectoryPicker'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { Modal } from '../components/shared/Modal'
import { SettingsPage, SettingsSection, SettingsRow, SegmentedControl, Switch } from '../components/settings/SettingsLayout'
import { Icon } from '../components/shared/Icon'
import { useUIStore } from '../stores/uiStore'

type ImTab = 'feishu' | 'telegram'

type AdapterGuideStep = {
  title: string
  body: ReactNode
  items?: string[]
  command?: string
}

type AdapterGuide = {
  title: string
  summary: string
  steps: AdapterGuideStep[]
  checks: string[]
}

function buildAdapterGuides(t: ReturnType<typeof useTranslation>): Record<ImTab, AdapterGuide> {
  const linkClass = 'font-semibold text-[var(--color-text-accent)] hover:underline'
  return {
    feishu: {
      title: t('settings.adapters.guide.feishu.title'),
      summary: t('settings.adapters.guide.feishu.summary'),
      steps: [
        {
          title: t('settings.adapters.guide.feishu.step1.title'),
          body: (
            <>
              {t('settings.adapters.guide.feishu.step1.pre')}{' '}
              <a className={linkClass} href="https://open.feishu.cn/page/openclaw?form=multiAgent" target="_blank" rel="noreferrer">
                {t('settings.adapters.guide.feishu.step1.link')}
              </a>
              {t('settings.adapters.guide.feishu.step1.post')}
            </>
          ),
        },
        {
          title: t('settings.adapters.guide.feishu.step2.title'),
          body: (
            <>
              {t('settings.adapters.guide.feishu.step2.pre')}{' '}
              <a className={linkClass} href="https://open.feishu.cn/app?lang=zh-CN" target="_blank" rel="noreferrer">
                {t('settings.adapters.guide.feishu.step2.link')}
              </a>
              {t('settings.adapters.guide.feishu.step2.post')}
            </>
          ),
          items: [
            t('settings.adapters.guide.feishu.step2.item1'),
            t('settings.adapters.guide.feishu.step2.item2'),
            t('settings.adapters.guide.feishu.step2.item3'),
          ],
        },
        {
          title: t('settings.adapters.guide.feishu.step3.title'),
          body: t('settings.adapters.guide.feishu.step3.body'),
        },
        {
          title: t('settings.adapters.guide.feishu.step4.title'),
          body: t('settings.adapters.guide.feishu.step4.body'),
        },
        {
          title: t('settings.adapters.guide.feishu.step5.title'),
          body: t('settings.adapters.guide.feishu.step5.body'),
        },
      ],
      checks: [
        t('settings.adapters.guide.feishu.check1'),
        t('settings.adapters.guide.feishu.check2'),
        t('settings.adapters.guide.feishu.check3'),
        t('settings.adapters.guide.feishu.check4'),
      ],
    },
    telegram: {
      title: t('settings.adapters.guide.telegram.title'),
      summary: t('settings.adapters.guide.telegram.summary'),
      steps: [
        { title: t('settings.adapters.guide.telegram.step1.title'), body: t('settings.adapters.guide.telegram.step1.body') },
        { title: t('settings.adapters.guide.telegram.step2.title'), body: t('settings.adapters.guide.telegram.step2.body') },
        { title: t('settings.adapters.guide.telegram.step3.title'), body: t('settings.adapters.guide.telegram.step3.body') },
        { title: t('settings.adapters.guide.telegram.step4.title'), body: t('settings.adapters.guide.telegram.step4.body') },
        { title: t('settings.adapters.guide.telegram.step5.title'), body: t('settings.adapters.guide.telegram.step5.body') },
      ],
      checks: [
        t('settings.adapters.guide.telegram.check1'),
        t('settings.adapters.guide.telegram.check2'),
        t('settings.adapters.guide.telegram.check3'),
        t('settings.adapters.guide.telegram.check4'),
      ],
    },
  }
}

export function AdapterSettings() {
  const t = useTranslation()
  const addToast = useUIStore((s) => s.addToast)
  const { config, isLoading, fetchConfig, updateConfig, generatePairingCode, removePairedUser } = useAdapterStore()

  // Active IM tab —— Feishu 默认展示，在前
  const [activeIm, setActiveIm] = useState<ImTab>('feishu')
  const [guidePlatform, setGuidePlatform] = useState<ImTab | null>(null)

  // Server —— serverUrl 不再暴露在 UI 里（见下方 Server URL 注释），
  // 桌面端用 Tauri env var 注入动态端口。
  const [defaultProjectDir, setDefaultProjectDir] = useState('')

  // Telegram
  const [tgBotToken, setTgBotToken] = useState('')
  const [tgAllowedUsers, setTgAllowedUsers] = useState('')

  // Feishu
  const [fsAppId, setFsAppId] = useState('')
  const [fsAppSecret, setFsAppSecret] = useState('')
  const [fsEncryptKey, setFsEncryptKey] = useState('')
  const [fsVerificationToken, setFsVerificationToken] = useState('')
  const [fsAllowedUsers, setFsAllowedUsers] = useState('')
  const [fsStreamingCard, setFsStreamingCard] = useState(false)

  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const [formDirty, setFormDirty] = useState(false)

  // Pairing
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [pendingUnbind, setPendingUnbind] = useState<{ platform: 'telegram' | 'feishu'; userId: string | number } | null>(null)
  const [isUnbinding, setIsUnbinding] = useState(false)

  useEffect(() => {
    fetchConfig()
  }, [])

  // Sync form state when config is loaded
  useEffect(() => {
    if (formDirty) return
    setDefaultProjectDir(config.defaultProjectDir ?? '')
    setTgBotToken(config.telegram?.botToken ?? '')
    setTgAllowedUsers(config.telegram?.allowedUsers?.join(', ') ?? '')
    setFsAppId(config.feishu?.appId ?? '')
    setFsAppSecret(config.feishu?.appSecret ?? '')
    setFsEncryptKey(config.feishu?.encryptKey ?? '')
    setFsVerificationToken(config.feishu?.verificationToken ?? '')
    setFsAllowedUsers(config.feishu?.allowedUsers?.join(', ') ?? '')
    setFsStreamingCard(config.feishu?.streamingCard ?? false)
  }, [config, formDirty])

  async function handleSave() {
    setIsSaving(true)
    setSaveStatus('idle')
    setSaveError('')
    try {
      const patch: Record<string, unknown> = {}

      patch.defaultProjectDir = defaultProjectDir

      const tgUsers = tgAllowedUsers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => !isNaN(n))

      patch.telegram = {
        botToken: tgBotToken || undefined,
        allowedUsers: tgUsers.length ? tgUsers : [],
      }

      const fsUsers = fsAllowedUsers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      patch.feishu = {
        appId: fsAppId || undefined,
        appSecret: fsAppSecret || undefined,
        encryptKey: fsEncryptKey || undefined,
        verificationToken: fsVerificationToken || undefined,
        allowedUsers: fsUsers.length ? fsUsers : [],
        streamingCard: fsStreamingCard,
      }

      await updateConfig(patch)
      setFormDirty(false)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (err) {
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  const handleGenerateCode = useCallback(async () => {
    setIsGenerating(true)
    try {
      const code = await generatePairingCode()
      setPairingCode(code)
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : t('settings.adapters.pairingCodeGenerateFailed'),
      })
    } finally {
      setIsGenerating(false)
    }
  }, [generatePairingCode, addToast, t])

  const handleUnbind = useCallback(async (platform: 'telegram' | 'feishu', userId: string | number) => {
    setPendingUnbind({ platform, userId })
  }, [])

  const confirmUnbind = useCallback(async () => {
    if (!pendingUnbind) return
    setIsUnbinding(true)
    try {
      await removePairedUser(pendingUnbind.platform, pendingUnbind.userId)
      await fetchConfig()
      setPendingUnbind(null)
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsUnbinding(false)
    }
  }, [pendingUnbind, removePairedUser, fetchConfig, addToast])

  // Collect all paired users across platforms
  const allPairedUsers = [
    ...(config.telegram?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'telegram' as const })),
    ...(config.feishu?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'feishu' as const })),
  ]

  // Check pairing expiry
  const [now, setNow] = useState(() => Date.now())
  const pairingExpiry = config.pairing?.expiresAt
  const isPairingActive = pairingExpiry ? now < pairingExpiry : false
  const minutesLeft = pairingExpiry ? Math.max(0, Math.ceil((pairingExpiry - now) / 60000)) : 0

  useEffect(() => {
    if (!isPairingActive) return
    const timer = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [isPairingActive])
  const imTabs: Array<{ value: ImTab; label: string }> = [
    { value: 'feishu', label: t('settings.adapters.feishu') },
    { value: 'telegram', label: t('settings.adapters.telegram') },
  ]

  const openGuide = useCallback((platform: ImTab) => {
    setActiveIm(platform)
    setGuidePlatform(platform)
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--color-text-tertiary)]">
        <Icon name="progress_activity" size={18} className="animate-spin text-[20px] mr-2" />
        {t('common.loading')}
      </div>
    )
  }

  return (
    <SettingsPage icon="chat" title={t('settings.tab.adapters')} description={t('settings.adapters.description')} saveMode="form">
      <div className="flex flex-col gap-[24px]" onChange={() => setFormDirty(true)}>
        {/* Pairing */}
        <SettingsSection
          title={t('settings.adapters.pairing')}
          description={t('settings.adapters.pairingDesc')}
          action={(
            <Button variant="secondary" size="sm" onClick={handleGenerateCode} loading={isGenerating}>
              {pairingCode || isPairingActive
                ? t('settings.adapters.regenerateCode')
                : t('settings.adapters.generateCode')}
            </Button>
          )}
        >
          <div className="px-[20px] py-[16px] space-y-4">
            {(pairingCode || isPairingActive) && (
              <div className="flex flex-wrap items-center gap-2.5">
                {pairingCode && (
                  <span className={`font-mono text-[24px] font-semibold tracking-[0.32em] ${
                    isPairingActive
                      ? 'text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-tertiary)] line-through opacity-60'
                  }`}>
                    {pairingCode}
                  </span>
                )}
                <span className="rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-text-tertiary)]">
                  {isPairingActive
                    ? `${t('settings.adapters.codeExpiresIn')} ${minutesLeft} ${t('settings.adapters.minutes')}`
                    : t('settings.adapters.codeExpired')}
                </span>
              </div>
            )}
            {pairingCode && isPairingActive && (
              <p className="text-[12px] leading-[1.6] text-[var(--color-text-tertiary)]">
                {t('settings.adapters.pairingCodeHint')}
              </p>
            )}

            <div>
              <h4 className="mb-2 text-[13px] font-semibold text-[var(--color-text-primary)]">
                {t('settings.adapters.pairedUsers')}
              </h4>
              {allPairedUsers.length === 0 ? (
                <p className="rounded-[12px] border border-dashed border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-4 py-5 text-center text-[13px] text-[var(--color-text-tertiary)]">
                  {t('settings.adapters.noPairedUsers')}
                </p>
              ) : (
                <div className="space-y-2">
                  {allPairedUsers.map((user) => (
                    <div
                      key={`${user.platform}-${user.userId}`}
                      className="flex items-center justify-between gap-3 rounded-[12px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-3 py-2.5"
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="rounded bg-[var(--color-surface-container)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
                          {t(`settings.adapters.platform.${user.platform}`)}
                        </span>
                        <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">{user.displayName}</span>
                        <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">
                          {new Date(user.pairedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUnbind(user.platform, user.userId)}
                        className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-[var(--color-error)] transition-colors hover:bg-[var(--color-error)]/10"
                      >
                        {t('settings.adapters.unbind')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SettingsSection>

      {/* Server URL —— 之前是个手填字段，但桌面端 Tauri 启动 adapter sidecar
          时已经把 server 的动态端口通过 ADAPTER_SERVER_URL env var 注进去了，
          loadConfig() 里 env 优先级高于这里的 file value，所以这个字段在桌面
          运行时完全不会被读到。用户也根本不知道该填什么端口（每次启动随机）。
          Standalone 模式（直接 bun run adapters/...）保留 file 字段兜底就够了。 */}

        {/* Default Project */}
        <SettingsSection>
          <SettingsRow
            label={t('settings.adapters.defaultProject')}
            hint={t('settings.adapters.defaultProjectHint')}
            align="start"
          >
            <div className="min-w-[220px]">
              <DirectoryPicker value={defaultProjectDir} onChange={(v) => { setFormDirty(true); setDefaultProjectDir(v) }} />
            </div>
          </SettingsRow>
        </SettingsSection>

        {/* IM Adapter Tabs —— Feishu 默认展示，在前 */}
        <SettingsSection
          title={activeIm === 'feishu' ? t('settings.adapters.feishu') : t('settings.adapters.telegram')}
          action={<SegmentedControl items={imTabs} value={activeIm} onChange={setActiveIm} />}
        >
          {activeIm === 'feishu' && (
            <div className="space-y-4 px-[20px] py-[16px]">
              <PlatformGuidePrompt
                icon="forum"
                title={t('settings.adapters.feishuGuideTitle')}
                description={t('settings.adapters.feishuGuideDesc')}
                buttonLabel={t('settings.adapters.openFullGuide')}
                onOpen={() => openGuide('feishu')}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label={t('settings.adapters.appId')}
                  value={fsAppId}
                  onChange={(e) => setFsAppId(e.target.value)}
                  placeholder={t('settings.adapters.appIdPlaceholder')}
                />
                <div data-setting-id="extensions.imSecret">
                  <Input
                    label={t('settings.adapters.appSecret')}
                    type="password"
                    value={fsAppSecret}
                    onChange={(e) => setFsAppSecret(e.target.value)}
                    placeholder={t('settings.adapters.appSecretPlaceholder')}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label={t('settings.adapters.encryptKey')}
                  type="password"
                  value={fsEncryptKey}
                  onChange={(e) => setFsEncryptKey(e.target.value)}
                  placeholder={t('settings.adapters.encryptKeyPlaceholder')}
                />
                <Input
                  label={t('settings.adapters.verificationToken')}
                  type="password"
                  value={fsVerificationToken}
                  onChange={(e) => setFsVerificationToken(e.target.value)}
                  placeholder={t('settings.adapters.verificationTokenPlaceholder')}
                />
              </div>
              <Input
                label={t('settings.adapters.allowedUsers')}
                value={fsAllowedUsers}
                onChange={(e) => setFsAllowedUsers(e.target.value)}
                placeholder={t('settings.adapters.fsAllowedUsersPlaceholder')}
              />
              <p className="text-[12px] text-[var(--color-text-tertiary)]">{t('settings.adapters.allowedUsersHint')}</p>
              <div className="-mx-[20px]">
              <SettingsRow
                label={t('settings.adapters.streamingCard')}
                hint={t('settings.adapters.streamingCardDesc')}
              >
                <Switch
                  checked={fsStreamingCard}
                  onChange={(v) => { setFormDirty(true); setFsStreamingCard(v) }}
                  ariaLabel={t('settings.adapters.streamingCard')}
                />
              </SettingsRow>
              </div>
            </div>
          )}

          {activeIm === 'telegram' && (
            <div className="space-y-4 px-[20px] py-[16px]">
              <PlatformGuidePrompt
                icon="chat"
                title={t('settings.adapters.telegramGuideTitle')}
                description={t('settings.adapters.telegramGuideDesc')}
                buttonLabel={t('settings.adapters.openFullGuide')}
                onOpen={() => openGuide('telegram')}
              />
              <Input
                label={t('settings.adapters.botToken')}
                type="password"
                value={tgBotToken}
                onChange={(e) => setTgBotToken(e.target.value)}
                placeholder={t('settings.adapters.botTokenPlaceholder')}
              />
              <Input
                label={t('settings.adapters.allowedUsers')}
                value={tgAllowedUsers}
                onChange={(e) => setTgAllowedUsers(e.target.value)}
                placeholder={t('settings.adapters.tgAllowedUsersPlaceholder')}
              />
              <p className="text-[12px] text-[var(--color-text-tertiary)]">{t('settings.adapters.allowedUsersHint')}</p>
            </div>
          )}
        </SettingsSection>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} loading={isSaving}>
          {t('settings.adapters.save')}
        </Button>
        {saveStatus === 'saved' && (
          <span className="text-[13px] text-[var(--color-success)]">
            <Icon name="check_circle" size={16} className="align-middle mr-1" />
            {t('settings.adapters.saved')}
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="text-[13px] text-[var(--color-error)]">
            <Icon name="error" size={16} className="align-middle mr-1" />
            {saveError}
          </span>
        )}
      </div>

        <ConfirmDialog
          open={pendingUnbind !== null}
          onClose={() => {
            if (isUnbinding) return
            setPendingUnbind(null)
          }}
          onConfirm={confirmUnbind}
          title={t('settings.adapters.unbind')}
          body={t('settings.adapters.unbindConfirm')}
          confirmLabel={t('settings.adapters.unbind')}
          cancelLabel={t('common.cancel')}
          confirmVariant="danger"
          loading={isUnbinding}
        />
        <AdapterGuideModal
          platform={guidePlatform}
          onClose={() => setGuidePlatform(null)}
          closeLabel={t('common.close')}
        />
      </div>
    </SettingsPage>
  )
}

function PlatformGuidePrompt({
  icon,
  title,
  description,
  buttonLabel,
  onOpen,
}: {
  icon: 'forum' | 'chat'
  title: string
  description: string
  buttonLabel: string
  onOpen: () => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-text-primary)] text-[var(--color-background)]">
          <Icon name={icon} size={17} />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">
            {title}
          </div>
          <p className="mt-1 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">
            {description}
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onOpen}
        icon={<Icon name="article" size={14} />}
        className="w-full shrink-0 sm:w-auto"
      >
        {buttonLabel}
      </Button>
    </div>
  )
}

function AdapterGuideModal({
  platform,
  onClose,
  closeLabel,
}: {
  platform: ImTab | null
  onClose: () => void
  closeLabel: string
}) {
  const t = useTranslation()
  const guides = buildAdapterGuides(t)
  const guide = platform ? guides[platform] : null

  return (
    <Modal
      open={Boolean(guide)}
      onClose={onClose}
      title={guide?.title}
      width={760}
      footer={(
        <Button type="button" variant="secondary" onClick={onClose}>
          {closeLabel}
        </Button>
      )}
    >
      {guide && (
        <div className="space-y-6">
          <p className="text-[13px] leading-6 text-[var(--color-text-secondary)]">
            {guide.summary}
          </p>

          <div className="space-y-5">
            {guide.steps.map((step, index) => (
              <section key={step.title} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-inverse-surface)] text-[12px] font-bold text-[var(--color-inverse-on-surface)]">
                  {index + 1}
                </div>
                <div className="min-w-0">
                  <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                    {step.title}
                  </h3>
                  <div className="mt-1 text-[13px] leading-6 text-[var(--color-text-secondary)]">
                    {step.body}
                  </div>
                  {step.items && (
                    <ul className="mt-2 space-y-1 text-[12px] leading-5 text-[var(--color-text-tertiary)]">
                      {step.items.map((item) => (
                        <li key={item} className="flex gap-2">
                          <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-[var(--color-text-tertiary)]" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {step.command && (
                    <pre className="mt-2 overflow-x-auto rounded-[8px] bg-[var(--color-surface-container-low)] px-3 py-2 text-[12px] text-[var(--color-text-primary)]">
                      {step.command}
                    </pre>
                  )}
                </div>
              </section>
            ))}
          </div>

          <section className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
            <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('settings.adapters.guide.checksTitle')}</h3>
            <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-[var(--color-text-secondary)]">
              {guide.checks.map((check) => (
                <li key={check} className="flex gap-2">
                  <Icon name="check" size={13} className="mt-[3px] shrink-0 text-[var(--color-success)]" />
                  <span>{check}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Modal>
  )
}
