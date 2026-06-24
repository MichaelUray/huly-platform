//
// Copyright © 2025 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import core, {
  AttachedDoc,
  Class,
  ClassCollaborators,
  Doc,
  DocumentQuery,
  Hierarchy,
  ModelDb,
  Ref
} from '.'

export function getClassCollaborators<T extends Doc> (
  model: ModelDb,
  hiearachy: Hierarchy,
  _id: Ref<Class<T>>
): ClassCollaborators<T> | undefined {
  const ancestors = hiearachy.getAncestors(_id)
  const collabs = new Map(
    model
      .findAllSync(core.class.ClassCollaborators, {
        attachedTo: { $in: ancestors }
      })
      .map((c) => [c.attachedTo, c])
  )
  for (const ancestor of ancestors) {
    const res = collabs.get(ancestor)
    if (res !== undefined) {
      return res
    }
  }
}

/**
 * Per Q2 (2026-06-21): collaborator lookup is hierarchy-aware on BOTH paths:
 * - `getClassCollaborators` traverses ancestors via `hierarchy.getAncestors(_class)`.
 * - `resolveMentionGrantTarget` does the same (was exact-class until Q2=B).
 *
 * Implication: a class registered as 'collaboratorOnly' on a BASE class will
 * propagate to all descendants automatically. If you want exact-class semantics
 * for a specific check, use `hierarchy.isDerived` directly without going through
 * getAncestors.
 *
 * Codex verification gap closed: subclass fixture in collaborators.test.ts pins
 * that mention target resolution and middleware agree on inheritance.
 *
 * Behavior:
 * Walks a Doc's attachedTo chain to find the nearest ancestor (including the
 * Doc itself) whose ClassCollaborators — registered on the class OR any of its
 * ancestor classes (closest-class wins) — has BOTH provideSecurity===true AND
 * mentionsGrantAccess===true. Returns that ancestor Doc as the grant target,
 * or null if no such class is reached within the depth cap.
 *
 * Used by both the chunter mention-trigger (server) and the warning popup
 * (client) so the disclosure UX matches the actual server-side grant. The
 * helper is isomorphic via the findAll dependency injection — server passes
 * `(cls, q) => control.findAll(control.ctx, cls, q)`, client passes
 * `(cls, q) => getClient().findAll(cls, q)`. Hierarchy access is required so
 * the lookup matches `getClassCollaborators`'s ancestor traversal (parity
 * pinned by the subclass fixture in collaborators.test.ts).
 *
 * Depth cap (8) defends against pathological attachedTo cycles.
 */
export async function resolveMentionGrantTarget (
  start: Doc,
  findAll: <T extends Doc>(cls: Ref<Class<T>>, q: DocumentQuery<T>) => Promise<T[]>,
  hierarchy: Hierarchy
): Promise<Doc | null> {
  let cur: Doc | undefined = start
  for (let i = 0; i < 8 && cur != null; i++) {
    const ancestors = hierarchy.getAncestors(cur._class)
    const ccs = await findAll(core.class.ClassCollaborators, {
      attachedTo: { $in: ancestors }
    } as DocumentQuery<ClassCollaborators<Doc>>)
    const ccByClass = new Map(ccs.map((c) => [c.attachedTo, c]))
    // Closest-ancestor wins: iterate ancestors in order, take the first match.
    for (const ancestor of ancestors) {
      const cc = ccByClass.get(ancestor)
      if (cc?.provideSecurity === true && cc.mentionsGrantAccess === true) {
        return cur
      }
    }
    const attached = cur as AttachedDoc
    if (attached.attachedTo == null || attached.attachedToClass == null) {
      return null
    }
    const parent = (await findAll(attached.attachedToClass, {
      _id: attached.attachedTo
    } as DocumentQuery<Doc>))[0]
    cur = parent
  }
  return null
}
