//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { keyEventToCommand, type KeyCommandContext } from '../keyboard-commands'

const baseCtx: KeyCommandContext = {
  isTextInputFocused: false,
  isDragActive: false,
  hasMultiSelection: false,
  containsActiveElement: true
}

function key (
  key: string,
  mods: Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>> = {}
): Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'> {
  return {
    key,
    metaKey: mods.metaKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    altKey: mods.altKey ?? false
  }
}

describe('keyEventToCommand', () => {
  describe('Cmd/Ctrl+Z undo/redo', () => {
    it('Ctrl+Z returns undo', () => {
      expect(keyEventToCommand(key('z', { ctrlKey: true }), baseCtx)).toEqual({ type: 'undo' })
    })
    it('Cmd+Z returns undo', () => {
      expect(keyEventToCommand(key('z', { metaKey: true }), baseCtx)).toEqual({ type: 'undo' })
    })
    it('Cmd+Shift+Z returns redo', () => {
      expect(keyEventToCommand(key('Z', { metaKey: true, shiftKey: true }), baseCtx)).toEqual({ type: 'redo' })
    })
    it('returns null when text input is focused (lets browser handle text-undo)', () => {
      expect(keyEventToCommand(key('z', { ctrlKey: true }), { ...baseCtx, isTextInputFocused: true })).toBeNull()
    })
    it('returns null when focus is outside the Gantt root', () => {
      expect(keyEventToCommand(key('z', { ctrlKey: true }), { ...baseCtx, containsActiveElement: false })).toBeNull()
    })
  })

  describe('outer guard', () => {
    it('returns null for Tab when focus is outside Gantt', () => {
      expect(keyEventToCommand(key('Tab'), { ...baseCtx, containsActiveElement: false })).toBeNull()
    })
  })

  describe('focus / movement', () => {
    it('Tab moves focus forward', () => {
      expect(keyEventToCommand(key('Tab'), baseCtx)).toEqual({ type: 'moveFocus', dir: 1 })
    })
    it('Shift+Tab moves focus backward', () => {
      expect(keyEventToCommand(key('Tab', { shiftKey: true }), baseCtx)).toEqual({ type: 'moveFocus', dir: -1 })
    })
    it('ArrowRight shifts 1 day', () => {
      expect(keyEventToCommand(key('ArrowRight'), baseCtx)).toEqual({ type: 'shift', days: 1 })
    })
    it('Shift+ArrowRight shifts 7 days', () => {
      expect(keyEventToCommand(key('ArrowRight', { shiftKey: true }), baseCtx)).toEqual({ type: 'shift', days: 7 })
    })
    it('ArrowLeft shifts -1 day', () => {
      expect(keyEventToCommand(key('ArrowLeft'), baseCtx)).toEqual({ type: 'shift', days: -1 })
    })
    it('Shift+ArrowLeft shifts -7 days', () => {
      expect(keyEventToCommand(key('ArrowLeft', { shiftKey: true }), baseCtx)).toEqual({ type: 'shift', days: -7 })
    })
  })

  describe('Escape cascading', () => {
    it('Esc cancels drag when drag is active', () => {
      expect(keyEventToCommand(key('Escape'), { ...baseCtx, isDragActive: true })).toEqual({ type: 'cancelDrag' })
    })
    it('Esc clears selection when no drag but selection exists', () => {
      expect(keyEventToCommand(key('Escape'), { ...baseCtx, hasMultiSelection: true })).toEqual({ type: 'clearSelection' })
    })
    it('cancelDrag wins over clearSelection when both are true', () => {
      expect(keyEventToCommand(key('Escape'), { ...baseCtx, isDragActive: true, hasMultiSelection: true })).toEqual({ type: 'cancelDrag' })
    })
    it('Esc returns null when neither drag nor selection', () => {
      expect(keyEventToCommand(key('Escape'), baseCtx)).toBeNull()
    })
  })

  describe('Cmd/Ctrl+A select all', () => {
    it('Cmd+A returns selectAll', () => {
      expect(keyEventToCommand(key('a', { metaKey: true }), baseCtx)).toEqual({ type: 'selectAll' })
    })
    it('Ctrl+A returns selectAll', () => {
      expect(keyEventToCommand(key('A', { ctrlKey: true }), baseCtx)).toEqual({ type: 'selectAll' })
    })
    it('Cmd+Shift+A is NOT selectAll', () => {
      expect(keyEventToCommand(key('a', { metaKey: true, shiftKey: true }), baseCtx)).toBeNull()
    })
    it('Cmd+A returns null when text input focused', () => {
      expect(keyEventToCommand(key('a', { metaKey: true }), { ...baseCtx, isTextInputFocused: true })).toBeNull()
    })
  })

  describe('zoom cycle', () => {
    it('+ returns cycleZoom +1', () => {
      expect(keyEventToCommand(key('+'), baseCtx)).toEqual({ type: 'cycleZoom', delta: 1 })
    })
    it('= returns cycleZoom +1', () => {
      expect(keyEventToCommand(key('='), baseCtx)).toEqual({ type: 'cycleZoom', delta: 1 })
    })
    it('- returns cycleZoom -1', () => {
      expect(keyEventToCommand(key('-'), baseCtx)).toEqual({ type: 'cycleZoom', delta: -1 })
    })
    it('_ returns cycleZoom -1', () => {
      expect(keyEventToCommand(key('_'), baseCtx)).toEqual({ type: 'cycleZoom', delta: -1 })
    })
  })

  describe('bare-key shortcuts (T/D/W/M/Q)', () => {
    it('T → jumpToToday', () => {
      expect(keyEventToCommand(key('t'), baseCtx)).toEqual({ type: 'jumpToToday' })
    })
    it('D → setZoom day', () => {
      expect(keyEventToCommand(key('d'), baseCtx)).toEqual({ type: 'setZoom', zoom: 'day' })
    })
    it('W → setZoom week', () => {
      expect(keyEventToCommand(key('w'), baseCtx)).toEqual({ type: 'setZoom', zoom: 'week' })
    })
    it('M → setZoom month', () => {
      expect(keyEventToCommand(key('m'), baseCtx)).toEqual({ type: 'setZoom', zoom: 'month' })
    })
    it('Q → setZoom quarter', () => {
      expect(keyEventToCommand(key('q'), baseCtx)).toEqual({ type: 'setZoom', zoom: 'quarter' })
    })
    it('bare keys are gated by text-input focus', () => {
      expect(keyEventToCommand(key('t'), { ...baseCtx, isTextInputFocused: true })).toBeNull()
      expect(keyEventToCommand(key('d'), { ...baseCtx, isTextInputFocused: true })).toBeNull()
    })
    it('bare keys are gated by Cmd/Ctrl modifier', () => {
      expect(keyEventToCommand(key('t', { ctrlKey: true }), baseCtx)).toBeNull()
      expect(keyEventToCommand(key('d', { metaKey: true }), baseCtx)).toBeNull()
    })
    it('bare keys are gated by Alt modifier', () => {
      expect(keyEventToCommand(key('t', { altKey: true }), baseCtx)).toBeNull()
    })
  })

  describe('? help and E export', () => {
    it('? returns showHelp', () => {
      expect(keyEventToCommand(key('?'), baseCtx)).toEqual({ type: 'showHelp' })
    })
    it('e returns exportPng', () => {
      expect(keyEventToCommand(key('e'), baseCtx)).toEqual({ type: 'exportPng' })
    })
    it('E returns exportPng', () => {
      expect(keyEventToCommand(key('E'), baseCtx)).toEqual({ type: 'exportPng' })
    })
  })

  describe('unknown keys', () => {
    it('returns null for unmapped keys', () => {
      expect(keyEventToCommand(key('x'), baseCtx)).toBeNull()
      expect(keyEventToCommand(key('F1'), baseCtx)).toBeNull()
      expect(keyEventToCommand(key(' '), baseCtx)).toBeNull()
    })
  })
})
