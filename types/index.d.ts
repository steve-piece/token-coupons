// The contract for the values the token-coupons mod keeps in $.state, and the
// shape of the JSON `token-coupons panel` prints, which is the one thing the
// mod and the skill's CLI have to agree on. skills/token-coupons/src/
// render-panel.mjs builds it; hooks/token-coupons.mjs draws it.

export type TokenCouponsAction = 'command' | 'delete' | 'optimize' | 'review' | 'keep' | 'context'

export type TokenCouponsRow = {
  rank: number
  action: TokenCouponsAction
  /** Tokens off every message if the action is taken. */
  saves: number
  name: string
  why: string
}

export type TokenCouponsTool = {
  id: string
  label: string
  skills: number
  /** How many of them are the same skill folders Claude Code lists. */
  alsoInClaude: number | null
  tokens: number
  /** Null where the tool publishes no allowance. */
  allowanceTokens: number | null
  over: boolean | null
  chats: number
  uses: number
  /** True when the tool reads the same disable-model-invocation line. */
  readsGate: boolean
  notes: string[]
}

export type TokenCouponsPanel = {
  version: 1
  tool: string
  /** `measured` just now, `last-run` from the record the last report left, or `empty`. */
  state: 'measured' | 'last-run' | 'empty'
  generatedOn: string | null
  ranAt: string | null
  cwd: string | null
  listing: {
    skills: number
    notListed: number
    tokens: number
    allowanceTokens: number | null
    /** Skills in Claude Code's list that another tool lists too. */
    alsoElsewhere: number | null
    overRatio: number | null
    fits: boolean | null
  } | null
  counts: {
    neverUsed: number
    neverUsedTokens: number | null
    outOfReach: number
    typedOnly: number
    typedOnlyTokens: number | null
  } | null
  wastedTokens: number | null
  saving: { tokens: number; fitsAfter: boolean | null } | null
  money: {
    model: string
    wastedPerWeek: number
    wastedPerMonth: number | null
    savedPerMonth: number | null
  } | null
  actions: Record<TokenCouponsAction, number>
  score: { score: number; grade: string } | null
  /** Distinct skills at least one tool lists; less than the per tool counts added up. */
  installed: number | null
  top: TokenCouponsRow[]
  more: number
  tools: TokenCouponsTool[]
  drift: string[]
}

export type TokenCouponsPhase = 'idle' | 'measuring' | 'failed'

declare module 'claude-code' {
  interface PluginState {
    'token-coupons': {
      /** The last panel read, or null before the first read lands. */
      panel: TokenCouponsPanel | null
      phase: TokenCouponsPhase
      /** Why the last read failed, in one plain sentence. */
      problem: string | null
      /** True when the person turned the line under the prompt off. */
      isQuiet: boolean
      /** The slash command that starts the skill's own loop, when one is installed. */
      audit: string | null
      /** True from the press that starts the skill's loop until that run finishes. */
      isAuditing: boolean
    }
  }
}
