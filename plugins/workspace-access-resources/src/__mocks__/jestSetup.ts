//
// jsdom 20 (bundled with Jest 29) doesn't ship TextEncoder/TextDecoder
// in the global scope. Polyfill from Node's `util`.
//

declare const require: (id: string) => any
const util = require('util')
if (typeof (globalThis as any).TextEncoder === 'undefined') {
  ;(globalThis as any).TextEncoder = util.TextEncoder
}
if (typeof (globalThis as any).TextDecoder === 'undefined') {
  ;(globalThis as any).TextDecoder = util.TextDecoder
}
export {}
