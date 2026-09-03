// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act, StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { AiChatHistoryPage, AiChatMessage, AiChatSubscriber, Overseer } from '@gadgets/workshop-shared/api'

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  disconnect() {}
})
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {}
}

vi.mock('@gadgets/kumo', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@gadgets/kumo')
  const Pass = ({ children }: { children?: React.ReactNode }) => children ?? null
  const Null = () => null
  const parts = new Proxy(Pass, {
    get: (_target, property) => property === 'Root' ? Null : Pass,
  })
  const toasts = { add: vi.fn<(options: unknown) => void>() }
  return {
    ...actual,
    Dialog: parts,
    DropdownMenu: parts,
    Popover: parts,
    Tooltip: Pass,
    useKumoToastManager: () => toasts,
  }
})

vi.mock('./AuthContext', () => {
  const context = {
    authenticatedApi: { listGatekeeperVendors: async () => [] },
    currentUser: null,
  }
  return {
    useAuthenticatedApi: () => context,
    useOptionalAuthenticatedApi: () => null,
  }
})

import { entry, makeOverseer, makeTestRoot } from './action-test-harness'
import ChatInterface from './ChatInterface'
import { linkActionLog } from './useActions'

const testRoot = makeTestRoot()

afterEach(() => {
  testRoot.cleanup()
  vi.restoreAllMocks()
})

function withChatApi(
  server: ReturnType<typeof makeOverseer>,
  getChatMessage = vi.fn<(chatId: number, sequence: number) => Promise<AiChatMessage | null>>(),
) {
  let subscriber: AiChatSubscriber | undefined
  Object.assign(server.overseer as object, {
    getChatMessage,
    listChats: async () => [],
    listModels: async () => [],
    onRpcBroken: () => {},
    subscribeToChat: (next: AiChatSubscriber) => {
      subscriber = next
      return { [Symbol.dispose]: () => {} }
    },
  })
  return {
    getChatMessage,
    emitMessage(message: AiChatMessage) {
      act(() => subscriber!.message(message))
    },
  }
}

function renderChat(overseer: RpcStub<Overseer>, workspaceId: string) {
  return testRoot.render(
    <ChatInterface
      workspaceId={workspaceId}
      overseer={overseer}
      selectedChatId={null}
      onNavigateToChat={() => {}}
      pendingConsoleLogCount={0}
      consoleLogPreview=""
      consoleLogSeverity="info"
      onConsumeConsoleLogs={() => ''}
      onDiscardConsoleLogs={() => {}}
      onOpenGadget={() => {}}
      outputOfWorkpiece={() => undefined}
    />,
  )
}

const actionMessage = {
  chatId: 1,
  sequence: 0,
  timestamp: new Date(),
  author: { type: 'agent', id: 'model', name: 'Model' },
  type: 'action',
  actionId: 1,
  actionLog: entry(1),
} as AiChatMessage

const resolvedMessage =
  { ...actionMessage, actionLog: entry(1, { state: 'approved' }) } as AiChatMessage

// Renders a first session that caches a pending action card, then settles it so a linked swap
// can resume. Pass a key to link the stub; unlinked sessions never park a watermark.
async function cachePendingCard(key?: string) {
  const workspaceId = `workspace-${key ?? "unlinked"}`
  const first = makeOverseer()
  const firstChat = withChatApi(first)
  if (key !== undefined) linkActionLog(first.overseer, key)
  await renderChat(first.overseer, workspaceId)
  await first.resolveSubscription()
  await first.resolvePendingQuery({ entries: [entry(1)] })
  firstChat.emitMessage(actionMessage)
  return workspaceId
}

describe('ChatInterface action refresh', () => {
  it('refetches cached mutable cards when an unlinked stub swaps', async () => {
    const workspaceId = await cachePendingCard()

    const second = makeOverseer()
    const secondChat = withChatApi(second, vi.fn(async () => resolvedMessage))
    await renderChat(second.overseer, workspaceId)
    await vi.waitFor(() => expect(secondChat.getChatMessage).toHaveBeenCalledWith(1, 0))
  })

  it('skips the cached-card refetch on a resumed linked stub swap', async () => {
    const workspaceId = await cachePendingCard('ws-chat-resume')

    const second = makeOverseer()
    const secondChat = withChatApi(second, vi.fn(async () => resolvedMessage))
    linkActionLog(second.overseer, 'ws-chat-resume')
    await renderChat(second.overseer, workspaceId)
    await second.resolveSubscription()
    await second.resolvePendingQuery({ entries: [entry(1)] })
    expect(secondChat.getChatMessage).not.toHaveBeenCalled()
  })
})

describe('ChatInterface history', () => {
  it('paints history on the live fiber after a Strict Mode remount', async () => {
    const workspaceId = `ws-history-${crypto.randomUUID()}`
    const server = makeOverseer()
    let settleHistory!: (page: AiChatHistoryPage) => void
    const pendingHistory = new Promise<AiChatHistoryPage>((resolve) => {
      settleHistory = resolve
    })
    withChatApi(server)
    Object.assign(server.overseer as object, {
      getChatHistory: () => pendingHistory,
    })

    await testRoot.render(
      <StrictMode>
        <ChatInterface
          workspaceId={workspaceId}
          overseer={server.overseer}
          selectedChatId={1}
          onNavigateToChat={() => {}}
          pendingConsoleLogCount={0}
          consoleLogPreview=""
          consoleLogSeverity="info"
          onConsumeConsoleLogs={() => ''}
          onDiscardConsoleLogs={() => {}}
          onOpenGadget={() => {}}
          outputOfWorkpiece={() => undefined}
        />
      </StrictMode>,
    )
    await server.resolveSubscription()
    await server.resolvePendingQuery({ entries: [] })
    await act(async () => {
      settleHistory({
        messages: [{
          chatId: 1,
          sequence: 0,
          timestamp: new Date(),
          author: { type: 'user', id: 'ada', name: 'Ada' },
          type: 'message',
          message: '```js\n1+1\n```',
        }],
      })
    })
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('1+1')
    })
  })
})
