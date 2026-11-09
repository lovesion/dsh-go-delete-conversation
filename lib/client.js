/**
 * dsh-go-delete-conversation — browser half.
 *
 * 往会话列表长按（「…」）菜单里加一行「删除会话」，位置排在官方「归档」那行后面，
 * 删除动作本身在 `shell.overlay` 的确认框里执行，避免菜单关闭过程中发请求。
 *
 * 菜单所在插槽是 `sidebar.workspaces.session.menu.item`（官方 pin 100 / rename 200 /
 * fork 300 / archive 400 / session-id 450，本插件用 420）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-go-delete-conversation',
  factory: (require) => {
    const React = require('react')

    /** 本插件在 locale 里的命名空间，也是插槽条目 id 前缀。 */
    const NS = 'dsh-go-delete-conversation'
    /** 宿主半边暴露的删除路由，见 lib/index.js。 */
    const DELETE_PATH = '/dsh-go-delete-conversation/delete'

    /**
     * ui-primitives 提供官方菜单行的外观；从磁盘解析的插件可能看不到它，
     * 那就退化成普通 menuitem 按钮，键盘走查仍然接得上。
     */
    let primitives = null
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch {
      primitives = null
    }
    const MenuItemButton =
      primitives !== null && typeof primitives.MenuItemButton === 'function' ? primitives.MenuItemButton : null
    const TrashIcon =
      primitives !== null && typeof primitives.IconTrashOutlineRegular === 'function'
        ? primitives.IconTrashOutlineRegular
        : null

    const DICT = {
      zh: {
        'menu.deleteSession': '删除会话',
        'dialog.title': '删除会话',
        'dialog.body': '将永久删除「{title}」及其全部消息记录，且无法撤销。',
        'dialog.cancel': '取消',
        'dialog.confirm': '永久删除',
        'dialog.deleting': '正在删除…',
      },
      en: {
        'menu.deleteSession': 'Delete session',
        'dialog.title': 'Delete session',
        'dialog.body': 'This permanently deletes "{title}" and its entire message history. It cannot be undone.',
        'dialog.cancel': 'Cancel',
        'dialog.confirm': 'Delete permanently',
        'dialog.deleting': 'Deleting…',
      },
    }

    /**
     * 极简可观察值：确认框和菜单行不在同一棵树里，靠它共享一个请求。
     * @param {any} initial 初始值
     * @returns {{get:Function,set:Function,subscribe:Function}} 读写接口
     */
    function createSignal(initial) {
      let value = initial
      const listeners = new Set()
      return {
        get: () => value,
        set(next) {
          value = next
          for (const listener of [...listeners]) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      }
    }

    /**
     * 让组件跟随一个 signal 重渲染。
     * @param {any} signal 信号
     * @returns {any} 当前值
     */
    function useSignal(signal) {
      return React.useSyncExternalStore(signal.subscribe, signal.get, signal.get)
    }

    /**
     * 调宿主路由真删。
     * @param {string} sessionId 会话 id
     * @returns {Promise<any>} 宿主回应
     */
    async function requestDeletion(sessionId) {
      const response = await fetch(DELETE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (!response.ok || body === null || body.ok !== true) {
        throw new Error(body !== null && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`)
      }
      return body
    }

    /**
     * 删完重建侧边栏列表；删掉的正好是当前选中的会话就释放选中。
     * @param {any} ctx 客户端上下文
     * @param {string} sessionId 被删的会话 id
     */
    function refreshAfterDeletion(ctx, sessionId) {
      const sessions = ctx.get('sessions')
      if (sessions === undefined) return
      try {
        if (String(sessions.list.getSnapshot().current) === sessionId) ctx.sessions.clearSelection()
      } catch {}
      Promise.resolve(sessions.refresh()).catch(() => {})
    }

    /**
     * 菜单行。
     * @param {object} props 会话 id、标题、菜单开合状态和翻译
     * @returns {any} 菜单行
     */
    function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, requestDelete, t }) {
      const [, setMenuOpen] = useMenuOpenState()
      const label = t('menu.deleteSession')
      const select = () => {
        setMenuOpen(false)
        requestDelete({ sessionId, displayTitle })
      }
      if (MenuItemButton !== null) {
        return React.createElement(MenuItemButton, {
          icon: TrashIcon === null ? undefined : React.createElement(TrashIcon, {}),
          onSelect: select,
          children: label,
        })
      }
      return React.createElement(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          onClick: select,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '6px 10px',
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
          },
        },
        label,
      )
    }

    /**
     * 确认框；真正的删除在这里执行。
     * @param {object} props 客户端上下文、请求信号、翻译
     * @returns {any} 确认框或 null
     */
    function DeleteSessionDialog({ ctx, signal, t }) {
      const request = useSignal(signal)
      const [pending, setPending] = React.useState(false)
      const [error, setError] = React.useState('')
      const openId = request === null ? null : request.sessionId
      React.useEffect(() => {
        setPending(false)
        setError('')
      }, [openId])
      if (request === null) return null
      const confirm = () => {
        setPending(true)
        setError('')
        requestDeletion(request.sessionId)
          .then(() => {
            signal.set(null)
            refreshAfterDeletion(ctx, request.sessionId)
          })
          .catch((failure) => {
            setPending(false)
            setError(failure instanceof Error ? failure.message : String(failure))
          })
      }
      const cancel = () => {
        if (pending) return
        signal.set(null)
      }
      const buttonStyle = {
        padding: '6px 14px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-divider, rgba(0, 0, 0, 0.12))',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary, #1a1a1a)',
        font: 'inherit',
        cursor: pending ? 'default' : 'pointer',
      }
      return React.createElement(
        'div',
        {
          style: {
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.35)',
            pointerEvents: 'auto',
            zIndex: 40,
          },
          onClick: cancel,
        },
        React.createElement(
          'div',
          {
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('dialog.title'),
            onClick: (event) => {
              event.stopPropagation()
            },
            style: {
              width: 'min(420px, calc(100vw - 48px))',
              padding: '18px 20px 16px',
              borderRadius: 12,
              background: 'var(--dsw-alias-bg-elevated, #ffffff)',
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.24)',
            },
          },
          React.createElement(
            'div',
            {
              style: {
                color: 'var(--dsw-alias-label-primary, #1a1a1a)',
                fontSize: 15,
                lineHeight: '22px',
                fontWeight: 500,
              },
            },
            t('dialog.title'),
          ),
          React.createElement(
            'div',
            {
              style: {
                marginTop: 8,
                color: 'var(--dsw-alias-label-secondary, #666666)',
                fontSize: 13,
                lineHeight: '20px',
                wordBreak: 'break-word',
              },
            },
            t('dialog.body', { title: request.displayTitle }),
          ),
          error === ''
            ? null
            : React.createElement(
                'div',
                {
                  style: {
                    marginTop: 10,
                    color: 'var(--dsw-alias-label-danger, #d93025)',
                    fontSize: 13,
                    lineHeight: '20px',
                  },
                },
                error,
              ),
          React.createElement(
            'div',
            { style: { marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 } },
            React.createElement(
              'button',
              { type: 'button', onClick: cancel, disabled: pending, style: buttonStyle },
              t('dialog.cancel'),
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: confirm,
                disabled: pending,
                style: {
                  ...buttonStyle,
                  borderColor: 'transparent',
                  background: 'var(--dsw-alias-label-danger, #d93025)',
                  color: '#ffffff',
                  opacity: pending ? 0.6 : 1,
                },
              },
              pending ? t('dialog.deleting') : t('dialog.confirm'),
            ),
          ),
        ),
      )
    }

    const exports = {}
    exports.inject = ['slots', 'locale']
    /**
     * 浏览器半边主体。
     * @param {any} ctx 客户端上下文
     */
    exports.apply = function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, DICT), 'dsh-go-delete-conversation: dictionaries')
      const t = ctx.locale.bind(NS)
      const deleteRequest = createSignal(null)

      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register(
          {
            name: 'sidebar.workspaces.session.menu.item',
            id: NS,
            // 官方：pin 100 / rename 200 / fork 300 / archive 400 / session-id 450。
            // 420 让「删除会话」紧跟在「归档」后面，也和 session-id 分开。
            order: 420,
            locale: NS,
            inject: () => ({
              requestDelete: (request) => {
                deleteRequest.set(request)
              },
            }),
          },
          function DeleteSessionMenuRow(props) {
            return React.createElement(DeleteSessionMenuItem, { ...props, t })
          },
        ),
      )

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: `${NS}.confirm`,
            locale: NS,
            inject: () => ({}),
          },
          function DeleteSessionConfirm() {
            return React.createElement(DeleteSessionDialog, { ctx, signal: deleteRequest, t })
          },
        ),
      )
    }
    return exports
  },
})
