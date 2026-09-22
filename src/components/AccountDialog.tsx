import * as Dialog from '@radix-ui/react-dialog'
import {
  ArrowClockwise,
  CheckCircle,
  CloudArrowUp,
  Fingerprint,
  SignOut,
  UserCircle,
  X,
} from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { authClient } from '../lib/auth-client'
import { getAccountState, type AccountState } from '../lib/api'

type AccountDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  localRatingCount: number
  savedLocationCount: number
  syncEnabled: boolean
  onSync: () => Promise<void>
  onSignedOut: () => void
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return '操作没有完成，请稍后再试'
}

export function AccountDialog({
  open,
  onOpenChange,
  localRatingCount,
  savedLocationCount,
  syncEnabled,
  onSync,
  onSignedOut,
}: AccountDialogProps) {
  const { data: session, isPending, refetch } = authClient.useSession()
  const [accountState, setAccountState] = useState<AccountState | null>(null)
  const [busyAction, setBusyAction] = useState<'sync' | 'passkey' | 'login' | 'logout' | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!open || !session) return
    let cancelled = false
    void getAccountState()
      .then((state) => {
        if (!cancelled) setAccountState(state)
      })
      .catch(() => {
        if (!cancelled) setMessage('账号状态暂时无法读取，但本地功能仍可使用。')
      })
    return () => {
      cancelled = true
    }
  }, [open, session])

  const refreshState = async () => {
    await refetch()
    const state = await getAccountState()
    setAccountState(state)
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
      setMessage('云端同步已开启；之后可再绑定 Passkey，换电脑也能回来。')
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
      setMessage('Passkey 已绑定。以后可以用系统指纹、面容或 PIN 登录。')
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
      onSignedOut()
      setAccountState(null)
      await refetch()
      setMessage('已退出，并清除了这台电脑上的个人缓存；云端数据仍保留。')
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  const passkeyCount = accountState?.user.passkeyCount ?? 0

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
                先吃先评，需要换设备时再用 Passkey 回来。
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="关闭账号弹层">
              <X size={22} weight="bold" />
            </Dialog.Close>
          </div>

          {isPending ? (
            <div className="account-loading"><ArrowClockwise size={22} /> 正在读取账号状态…</div>
          ) : session ? (
            <>
              <section className="account-status-card">
                <span className={`account-status-icon ${syncEnabled ? 'is-synced' : ''}`}>
                  {syncEnabled ? <CheckCircle size={25} weight="fill" /> : <CloudArrowUp size={25} weight="duotone" />}
                </span>
                <div>
                  <small>{passkeyCount ? '已绑定账号' : '云端访客'}</small>
                  <strong>{syncEnabled ? '这台电脑正在同步' : '已建立云身份，尚未同步全部本机数据'}</strong>
                  <span>{localRatingCount} 家评分 · {savedLocationCount} 个收藏地点</span>
                </div>
              </section>

              <button className="account-primary-action" type="button" onClick={sync} disabled={Boolean(busyAction)}>
                <CloudArrowUp size={20} weight="bold" />
                {busyAction === 'sync' ? '正在合并…' : syncEnabled ? '立即同步一次' : '合并本机数据并开启同步'}
              </button>

              {passkeyCount ? (
                <div className="passkey-ready">
                  <Fingerprint size={21} weight="duotone" />
                  <span><strong>Passkey 已绑定</strong><small>可在其他电脑上用系统验证快速登录</small></span>
                </div>
              ) : (
                <button className="account-secondary-action" type="button" onClick={bindPasskey} disabled={Boolean(busyAction)}>
                  <Fingerprint size={20} weight="bold" />
                  {busyAction === 'passkey' ? '等待系统验证…' : '绑定 Passkey，换设备也能找回'}
                </button>
              )}

              <button className="account-signout" type="button" onClick={signOut} disabled={Boolean(busyAction)}>
                <SignOut size={17} weight="bold" />
                {busyAction === 'logout' ? '正在退出…' : '退出登录'}
              </button>
            </>
          ) : (
            <>
              <section className="account-pitch">
                <CloudArrowUp size={30} weight="duotone" />
                <div>
                  <strong>收藏地点和评分可以跟着你走</strong>
                  <p>不开账号也能继续浏览。开启后会把这台电脑上的评分和收藏上传到你的私密云空间；评分内容会公开展示，收藏地点不会公开。</p>
                </div>
              </section>

              <button className="account-primary-action" type="button" onClick={startCloudSync} disabled={Boolean(busyAction)}>
                <CloudArrowUp size={20} weight="bold" />
                {busyAction === 'sync' ? '正在开启…' : '免填资料，开启云端同步'}
              </button>
              <button className="account-secondary-action" type="button" onClick={loginWithPasskey} disabled={Boolean(busyAction)}>
                <Fingerprint size={20} weight="bold" />
                {busyAction === 'login' ? '等待系统验证…' : '我已有 Passkey，直接登录并合并'}
              </button>
              <p className="account-privacy-note">Passkey 不会把指纹或面容传给 DopaBite；网站只收到系统验证结果。</p>
            </>
          )}

          {message && <p className="account-message" role="status">{message}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
