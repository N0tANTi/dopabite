import * as Dialog from '@radix-ui/react-dialog'
import {
  ArrowClockwise,
  Check,
  CheckCircle,
  CloudArrowUp,
  EnvelopeSimple,
  Fingerprint,
  PencilSimple,
  SignOut,
  UserCircle,
  X,
} from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { authClient } from '../lib/auth-client'
import {
  getAccountState,
  getPublicConfig,
  updateProfile,
  type AccountState,
  type PublicConfig,
} from '../lib/api'
import { createNicknameSuggestion, getNicknameError, normalizeNickname } from '../lib/nickname'

type AccountDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  nickname: string
  localRatingCount: number
  savedLocationCount: number
  syncEnabled: boolean
  onSync: () => Promise<void>
  onProfileChange: (nickname: string) => void
  onSignedOut: () => void
}

type BusyAction = 'sync' | 'passkey' | 'login' | 'logout' | 'profile' | 'email-send' | 'email-verify'

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return '操作没有完成，请稍后再试'
}

export function AccountDialog({
  open,
  onOpenChange,
  nickname,
  localRatingCount,
  savedLocationCount,
  syncEnabled,
  onSync,
  onProfileChange,
  onSignedOut,
}: AccountDialogProps) {
  const { data: session, isPending, refetch } = authClient.useSession()
  const [accountState, setAccountState] = useState<AccountState | null>(null)
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null)
  const [message, setMessage] = useState('')
  const [nicknameDraft, setNicknameDraft] = useState(nickname || createNicknameSuggestion())
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [emailStep, setEmailStep] = useState<'email' | 'otp'>('email')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void getPublicConfig()
      .then((nextConfig) => {
        if (!cancelled) setConfig(nextConfig)
      })
      .catch(() => {
        if (!cancelled) setConfig({ emailOtpEnabled: false })
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open || !session) return
    let cancelled = false
    void getAccountState()
      .then((state) => {
        if (cancelled) return
        setAccountState(state)
        setNicknameDraft(state.user.name)
        onProfileChange(state.user.name)
      })
      .catch(() => {
        if (!cancelled) setMessage('账号状态暂时无法读取，但本地功能仍可使用。')
      })
    return () => {
      cancelled = true
    }
  }, [onProfileChange, open, session])

  const refreshState = async () => {
    await refetch()
    const state = await getAccountState()
    setAccountState(state)
    setNicknameDraft(state.user.name)
    onProfileChange(state.user.name)
    return state
  }

  const sync = async () => {
    setBusyAction('sync')
    setMessage('')
    try {
      await onSync()
      await refreshState()
      setMessage('这台电脑的评分和收藏已经与云端合并。')
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  const startCloudSync = async () => {
    setBusyAction('sync')
    setMessage('')
    try {
      const result = await authClient.signIn.anonymous()
      if (result.error) throw new Error(result.error.message)
      await refetch()
      await onSync()
      await refreshState()
      setMessage('云端同步已开启。之后绑定邮箱，就能在其他设备找回数据。')
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  const saveNickname = async () => {
    const error = getNicknameError(nicknameDraft)
    if (error) {
      setMessage(error)
      return
    }
    setBusyAction('profile')
    setMessage('')
    try {
      const profile = await updateProfile(normalizeNickname(nicknameDraft))
      setNicknameDraft(profile.name)
      onProfileChange(profile.name)
      setAccountState((current) => current
        ? { ...current, user: { ...current.user, name: profile.name } }
        : current)
      setMessage('公开昵称已更新，过去发布的评分也会显示新昵称。')
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  const sendEmailCode = async () => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setMessage('请输入有效的邮箱地址')
      return
    }
    const nicknameError = getNicknameError(nicknameDraft)
    if (nicknameError) {
      setMessage(nicknameError)
      return
    }
    setBusyAction('email-send')
    setMessage('')
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: normalizedEmail,
        type: 'sign-in',
      })
      if (result.error) throw new Error(result.error.message)
      setEmail(normalizedEmail)
      setEmailStep('otp')
      setMessage('验证码已发送，5 分钟内有效。')
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  const verifyEmailCode = async () => {
    if (!/^\d{6}$/.test(otp.trim())) {
      setMessage('请输入 6 位验证码')
      return
    }
    setBusyAction('email-verify')
    setMessage('')
    try {
      const result = await authClient.signIn.emailOtp({
        email,
        otp: otp.trim(),
        name: normalizeNickname(nicknameDraft),
      })
      if (result.error) throw new Error(result.error.message)
      await refetch()
      await onSync()
      const state = await refreshState()
      setEmailStep('email')
      setOtp('')
      setMessage(`已绑定 ${state.user.email ?? email}，数据已合并。`)
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  const loginWithPasskey = async () => {
    setBusyAction('login')
    setMessage('')
    try {
      const result = await authClient.signIn.passkey()
      if (result.error) throw new Error(result.error.message)
      await refetch()
      await onSync()
      await refreshState()
      setMessage('登录成功，云端内容已和这台电脑合并。')
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  const bindPasskey = async () => {
    setBusyAction('passkey')
    setMessage('')
    try {
      const result = await authClient.passkey.addPasskey({ name: 'DopaBite 通行密钥' })
      if (result.error) throw new Error(result.error.message)
      await refreshState()
      setMessage('Passkey 已绑定。以后可用系统指纹、面容或 PIN 登录。')
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  const signOut = async () => {
    setBusyAction('logout')
    setMessage('')
    try {
      const result = await authClient.signOut()
      if (result.error) throw new Error(result.error.message)
      const nextNickname = createNicknameSuggestion()
      onProfileChange(nextNickname)
      onSignedOut()
      setAccountState(null)
      setNicknameDraft(nextNickname)
      await refetch()
      setMessage('已退出，并清除了这台电脑上的个人缓存。云端数据仍保留。')
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  const passkeyCount = accountState?.user.passkeyCount ?? 0
  const isAnonymous = accountState?.user.isAnonymous ?? true
  const isEmailAccount = Boolean(session && accountState && !accountState.user.isAnonymous)

  const emailLoginPanel = config?.emailOtpEnabled ? (
    <section className="email-login-panel" aria-label="邮箱验证码登录">
      <div className="account-section-heading">
        <span><EnvelopeSimple size={20} weight="duotone" /></span>
        <div>
          <strong>{session ? '绑定邮箱，换设备也能找回' : '邮箱验证码登录'}</strong>
          <small>首次验证会自动建号，不需要设置密码</small>
        </div>
      </div>
      {emailStep === 'email' ? (
        <div className="email-login-form">
          <label>
            <span>邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              autoComplete="email"
            />
          </label>
          <button type="button" onClick={sendEmailCode} disabled={Boolean(busyAction)}>
            {busyAction === 'email-send' ? '正在发送' : '发送验证码'}
          </button>
        </div>
      ) : (
        <div className="email-login-form otp-form">
          <label>
            <span>6 位验证码</span>
            <input
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
            />
          </label>
          <button type="button" onClick={verifyEmailCode} disabled={Boolean(busyAction)}>
            {busyAction === 'email-verify' ? '正在验证' : '验证并登录'}
          </button>
          <button
            type="button"
            className="email-change-button"
            onClick={() => {
              setEmailStep('email')
              setOtp('')
            }}
          >
            换个邮箱
          </button>
        </div>
      )}
    </section>
  ) : (
    <section className="email-login-panel is-unavailable" aria-label="邮箱登录待配置">
      <div className="account-section-heading">
        <span><EnvelopeSimple size={20} weight="duotone" /></span>
        <div>
          <strong>邮箱验证码即将开放</strong>
          <small>邮件服务配置完成后会自动启用。当前仍可免登录评分和同步。</small>
        </div>
      </div>
    </section>
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="account-dialog" aria-describedby="account-description">
          <div className="dialog-topline account-dialog-topline">
            <span className="dialog-icon account-dialog-icon" aria-hidden="true">
              <UserCircle size={25} weight="duotone" />
            </span>
            <div>
              <Dialog.Title>你的 DopaBite</Dialog.Title>
              <Dialog.Description id="account-description">
                评分公开可见，收藏地点仅自己可见。
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="关闭账号弹层">
              <X size={22} weight="bold" />
            </Dialog.Close>
          </div>

          {isPending ? (
            <div className="account-loading"><ArrowClockwise size={22} /> 正在读取账号状态...</div>
          ) : session ? (
            <>
              <section className="account-status-card">
                <span className={`account-status-icon ${syncEnabled ? 'is-synced' : ''}`}>
                  {syncEnabled ? <CheckCircle size={25} weight="fill" /> : <CloudArrowUp size={25} weight="duotone" />}
                </span>
                <div>
                  <small>{isEmailAccount ? '邮箱账号' : '云端访客'}</small>
                  <strong>{accountState?.user.email ?? accountState?.user.name ?? '正在读取身份'}</strong>
                  <span>{localRatingCount} 家评分 / {savedLocationCount} 个收藏地点</span>
                </div>
              </section>

              <section className="nickname-editor">
                <div className="account-section-heading">
                  <span><PencilSimple size={19} weight="duotone" /></span>
                  <div>
                    <strong>公开昵称</strong>
                    <small>你的所有公开评分都会显示这个名字</small>
                  </div>
                </div>
                <div className="nickname-editor-form">
                  <input
                    value={nicknameDraft}
                    onChange={(event) => setNicknameDraft(event.target.value)}
                    maxLength={16}
                    autoComplete="nickname"
                    aria-label="公开昵称"
                  />
                  <button type="button" onClick={saveNickname} disabled={Boolean(busyAction)}>
                    <Check size={17} weight="bold" />
                    {busyAction === 'profile' ? '保存中' : '保存'}
                  </button>
                </div>
              </section>

              <button className="account-primary-action" type="button" onClick={sync} disabled={Boolean(busyAction)}>
                <CloudArrowUp size={20} weight="bold" />
                {busyAction === 'sync' ? '正在合并...' : syncEnabled ? '立即同步一次' : '合并本机数据并开启同步'}
              </button>

              {isAnonymous ? emailLoginPanel : (
                <div className="email-account-ready">
                  <EnvelopeSimple size={20} weight="duotone" />
                  <span><strong>邮箱已绑定</strong><small>登录状态默认保留 30 天</small></span>
                </div>
              )}

              <details className="account-other-methods">
                <summary>其他登录方式</summary>
                {isEmailAccount && passkeyCount ? (
                  <div className="passkey-ready">
                    <Fingerprint size={21} weight="duotone" />
                    <span><strong>Passkey 已绑定</strong><small>可用系统指纹、面容或 PIN 登录</small></span>
                  </div>
                ) : isEmailAccount ? (
                  <button className="account-secondary-action" type="button" onClick={bindPasskey} disabled={Boolean(busyAction)}>
                    <Fingerprint size={20} weight="bold" />
                    {busyAction === 'passkey' ? '等待系统验证...' : '可选：绑定 Passkey'}
                  </button>
                ) : (
                  <button className="account-secondary-action" type="button" onClick={loginWithPasskey} disabled={Boolean(busyAction)}>
                    <Fingerprint size={20} weight="bold" />
                    {busyAction === 'login' ? '等待系统验证...' : '已有 Passkey，直接登录'}
                  </button>
                )}
                <p className="account-privacy-note">设备不支持 Passkey 也不影响使用。生物信息不会传给 DopaBite。</p>
              </details>

              <button className="account-signout" type="button" onClick={signOut} disabled={Boolean(busyAction)}>
                <SignOut size={17} weight="bold" />
                {busyAction === 'logout' ? '正在退出...' : '退出登录'}
              </button>
            </>
          ) : (
            <>
              <section className="account-pitch">
                <CloudArrowUp size={30} weight="duotone" />
                <div>
                  <strong>评分给大家看，收藏只留给自己</strong>
                  <p>你可以直接开始评分。绑定邮箱后，评分和收藏会随账号同步到其他设备。</p>
                </div>
              </section>

              <section className="nickname-editor">
                <div className="account-section-heading">
                  <span><PencilSimple size={19} weight="duotone" /></span>
                  <div>
                    <strong>先取一个公开昵称</strong>
                    <small>我们已经随机生成一个，你也可以直接修改</small>
                  </div>
                </div>
                <div className="nickname-editor-form is-preview">
                  <input
                    value={nicknameDraft}
                    onChange={(event) => setNicknameDraft(event.target.value)}
                    maxLength={16}
                    autoComplete="nickname"
                    aria-label="公开昵称"
                  />
                </div>
              </section>

              {emailLoginPanel}

              <button className="account-primary-action" type="button" onClick={startCloudSync} disabled={Boolean(busyAction)}>
                <CloudArrowUp size={20} weight="bold" />
                {busyAction === 'sync' ? '正在开启...' : '先以访客身份开启同步'}
              </button>

              <details className="account-other-methods">
                <summary>其他登录方式</summary>
                <button className="account-secondary-action" type="button" onClick={loginWithPasskey} disabled={Boolean(busyAction)}>
                  <Fingerprint size={20} weight="bold" />
                  {busyAction === 'login' ? '等待系统验证...' : '已有 Passkey，直接登录'}
                </button>
                <p className="account-privacy-note">设备不支持 Passkey 也不影响使用。</p>
              </details>
            </>
          )}

          {message && <p className="account-message" role="status">{message}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
