import { assertWorkspaceContext } from '../assertWorkspaceContext'

describe('assertWorkspaceContext', () => {
  it('throws when audience is admin', () => {
    expect(() => assertWorkspaceContext({ token: { audience: 'admin', workspace: 'w' } })).toThrow(
      /workspace context required/
    )
  })
  it('accepts workspace audience', () => {
    expect(() =>
      assertWorkspaceContext({ token: { audience: 'workspace', workspace: 'ws1' } })
    ).not.toThrow()
  })
  it('accepts wac audience', () => {
    expect(() => assertWorkspaceContext({ token: { audience: 'wac', workspace: 'ws1' } })).not.toThrow()
  })
  it('throws when workspace claim missing', () => {
    expect(() => assertWorkspaceContext({ token: { audience: 'workspace' } })).toThrow(/missing workspace claim/)
  })
  it('throws when workspace claim is empty', () => {
    expect(() => assertWorkspaceContext({ token: { audience: 'workspace', workspace: '' } })).toThrow(
      /missing workspace claim/
    )
  })
})
