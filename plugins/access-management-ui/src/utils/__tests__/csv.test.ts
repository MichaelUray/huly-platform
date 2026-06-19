import { csvEscape, csvLine, csvRows, csvBomPrefix } from '../csv'

describe('csv helpers', () => {
  it('csvEscape returns plain ASCII unchanged', () => {
    expect(csvEscape('abc')).toBe('abc')
  })
  it('csvEscape wraps comma-containing values in quotes', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
  })
  it('csvEscape doubles internal quotes', () => {
    expect(csvEscape('a"b')).toBe('"a""b"')
  })
  it('csvEscape quotes CR and LF', () => {
    expect(csvEscape('a\nb')).toBe('"a\nb"')
    expect(csvEscape('a\rb')).toBe('"a\rb"')
  })
  it('csvLine terminates with CRLF', () => {
    expect(csvLine(['a', 'b'])).toBe('a,b\r\n')
  })
  it('csvRows joins all rows', () => {
    expect(csvRows([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d\r\n')
  })
  it('csvBomPrefix is the UTF-8 BOM character', () => {
    expect(csvBomPrefix).toBe('﻿')
  })
})
