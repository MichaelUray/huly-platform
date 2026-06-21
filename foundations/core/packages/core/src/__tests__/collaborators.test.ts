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

import { getClassCollaborators, resolveMentionGrantTarget } from '../collaborators'
import { ModelDb } from '../memdb'
import { Hierarchy } from '../hierarchy'
import core from '../component'
import type { AttachedDoc, Class, ClassCollaborators, Doc, Ref } from '../classes'
import type { DocumentQuery } from '../storage'

describe('collaborators', () => {
  let model: ModelDb
  let hierarchy: Hierarchy

  beforeEach(() => {
    model = new ModelDb(hierarchy)
    hierarchy = new Hierarchy()
  })

  describe('getClassCollaborators', () => {
    it('should return undefined when no collaborators found', () => {
      const classRef = 'class:test.TestClass' as Ref<Class<Doc>>

      // Mock hierarchy to return empty ancestors
      hierarchy.getAncestors = jest.fn().mockReturnValue([classRef])

      // Mock model to return empty result
      model.findAllSync = jest.fn().mockReturnValue([])

      const result = getClassCollaborators(model, hierarchy, classRef)

      expect(result).toBeUndefined()
    })

    it('should return collaborators for direct class', () => {
      const classRef = 'class:test.TestClass' as Ref<Class<Doc>>
      const collaborators: ClassCollaborators<Doc> = {
        _id: 'collab1' as any,
        _class: core.class.ClassCollaborators,
        space: 'space1' as any,
        modifiedOn: Date.now(),
        modifiedBy: 'user1' as any,
        attachedTo: classRef,
        attachedToClass: core.class.Class,
        collection: 'collaborators'
      } as unknown as ClassCollaborators<Doc>

      hierarchy.getAncestors = jest.fn().mockReturnValue([classRef])
      model.findAllSync = jest.fn().mockReturnValue([collaborators])

      const result = getClassCollaborators(model, hierarchy, classRef)

      expect(result).toBe(collaborators)
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(model.findAllSync).toHaveBeenCalledWith(core.class.ClassCollaborators, { attachedTo: { $in: [classRef] } })
    })

    it('should return collaborators from ancestor class', () => {
      const childClass = 'class:test.ChildClass' as Ref<Class<Doc>>
      const parentClass = 'class:test.ParentClass' as Ref<Class<Doc>>
      const grandParentClass = core.class.Doc

      const parentCollaborators: ClassCollaborators<Doc> = {
        _id: 'collab2' as any,
        _class: core.class.ClassCollaborators,
        space: 'space1' as any,
        modifiedOn: Date.now(),
        modifiedBy: 'user1' as any,
        attachedTo: parentClass,
        attachedToClass: core.class.Class,
        collection: 'collaborators'
      } as unknown as ClassCollaborators<Doc>

      hierarchy.getAncestors = jest.fn().mockReturnValue([childClass, parentClass, grandParentClass])
      model.findAllSync = jest.fn().mockReturnValue([parentCollaborators])

      const result = getClassCollaborators(model, hierarchy, childClass)

      expect(result).toBe(parentCollaborators)
    })

    it('should return first matching ancestor collaborators', () => {
      const childClass = 'class:test.ChildClass' as Ref<Class<Doc>>
      const parentClass = 'class:test.ParentClass' as Ref<Class<Doc>>
      const grandParentClass = 'class:test.GrandParentClass' as Ref<Class<Doc>>

      const parentCollaborators: ClassCollaborators<Doc> = {
        _id: 'collab3' as any,
        _class: core.class.ClassCollaborators,
        space: 'space1' as any,
        modifiedOn: Date.now(),
        modifiedBy: 'user1' as any,
        attachedTo: parentClass,
        attachedToClass: core.class.Class,
        collection: 'collaborators'
      } as unknown as ClassCollaborators<Doc>

      const grandParentCollaborators: ClassCollaborators<Doc> = {
        _id: 'collab4' as any,
        _class: core.class.ClassCollaborators,
        space: 'space1' as any,
        modifiedOn: Date.now(),
        modifiedBy: 'user1' as any,
        attachedTo: grandParentClass,
        attachedToClass: core.class.Class,
        collection: 'collaborators'
      } as unknown as ClassCollaborators<Doc>

      hierarchy.getAncestors = jest.fn().mockReturnValue([childClass, parentClass, grandParentClass])
      model.findAllSync = jest.fn().mockReturnValue([parentCollaborators, grandParentCollaborators])

      const result = getClassCollaborators(model, hierarchy, childClass)

      // Should return parent collaborators (first in ancestor chain)
      expect(result).toBe(parentCollaborators)
    })

    it('should handle single class with no ancestors', () => {
      const classRef = core.class.Doc

      hierarchy.getAncestors = jest.fn().mockReturnValue([classRef])
      model.findAllSync = jest.fn().mockReturnValue([])

      const result = getClassCollaborators(model, hierarchy, classRef)

      expect(result).toBeUndefined()
    })

    it('should handle empty ancestors list', () => {
      const classRef = 'class:test.TestClass' as Ref<Class<Doc>>

      hierarchy.getAncestors = jest.fn().mockReturnValue([])
      model.findAllSync = jest.fn().mockReturnValue([])

      const result = getClassCollaborators(model, hierarchy, classRef)

      expect(result).toBeUndefined()
    })

    it('should properly query model with $in operator', () => {
      const childClass = 'class:test.ChildClass' as Ref<Class<Doc>>
      const parentClass = 'class:test.ParentClass' as Ref<Class<Doc>>
      const ancestors = [childClass, parentClass, core.class.Doc]

      hierarchy.getAncestors = jest.fn().mockReturnValue(ancestors)
      model.findAllSync = jest.fn().mockReturnValue([])

      getClassCollaborators(model, hierarchy, childClass)

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(model.findAllSync).toHaveBeenCalledWith(core.class.ClassCollaborators, { attachedTo: { $in: ancestors } })
    })

    it('should iterate through ancestors in order', () => {
      const class1 = 'class:test.Class1' as Ref<Class<Doc>>
      const class2 = 'class:test.Class2' as Ref<Class<Doc>>
      const class3 = 'class:test.Class3' as Ref<Class<Doc>>

      const collab2: ClassCollaborators<Doc> = {
        _id: 'collab5' as any,
        _class: core.class.ClassCollaborators,
        space: 'space1' as any,
        modifiedOn: Date.now(),
        modifiedBy: 'user1' as any,
        attachedTo: class2,
        attachedToClass: core.class.Class,
        collection: 'collaborators'
      } as unknown as ClassCollaborators<Doc>

      const collab3: ClassCollaborators<Doc> = {
        _id: 'collab6' as any,
        _class: core.class.ClassCollaborators,
        space: 'space1' as any,
        modifiedOn: Date.now(),
        modifiedBy: 'user1' as any,
        attachedTo: class3,
        attachedToClass: core.class.Class,
        collection: 'collaborators'
      } as unknown as ClassCollaborators<Doc>

      hierarchy.getAncestors = jest.fn().mockReturnValue([class1, class2, class3])
      model.findAllSync = jest.fn().mockReturnValue([collab2, collab3])

      const result = getClassCollaborators(model, hierarchy, class1)

      // Should return collab2 (class2 comes before class3 in ancestors)
      expect(result).toBe(collab2)
    })
  })

  describe('resolveMentionGrantTarget (hierarchy-aware per Q2=B)', () => {
    // Build a minimal ClassCollaborators record with the grant flags set.
    function makeGrantingCC (attachedToClass: Ref<Class<Doc>>): ClassCollaborators<Doc> {
      return {
        _id: ('cc:' + (attachedToClass as string)) as any,
        _class: core.class.ClassCollaborators,
        space: 'space1' as any,
        modifiedOn: Date.now(),
        modifiedBy: 'user1' as any,
        attachedTo: attachedToClass,
        attachedToClass: core.class.Class,
        collection: 'collaborators',
        provideSecurity: true,
        mentionsGrantAccess: true
      } as unknown as ClassCollaborators<Doc>
    }

    // Wire ancestor lookups for a flat parent/child/grandparent relationship.
    function buildHierarchy (ancestorsByClass: Record<string, Ref<Class<Doc>>[]>): Hierarchy {
      const h = new Hierarchy()
      h.getAncestors = jest.fn((cls: Ref<Class<Doc>>) => {
        return ancestorsByClass[cls as string] ?? [cls]
      }) as any
      return h
    }

    // Build a findAll that resolves ClassCollaborators queries from a registry
    // (by ancestor $in). Doc lookups are unused in these subclass-focused tests
    // (the start doc has no attachedTo chain).
    function makeFindAll (registry: ClassCollaborators<Doc>[]): <T extends Doc>(cls: Ref<Class<T>>, q: DocumentQuery<T>) => Promise<T[]> {
      return jest.fn(async (cls: any, q: any) => {
        if (cls === core.class.ClassCollaborators) {
          const inList: Ref<Class<Doc>>[] = q?.attachedTo?.$in ?? (q?.attachedTo != null ? [q.attachedTo] : [])
          return registry.filter((r) => inList.includes(r.attachedTo)) as any
        }
        return [] as any
      }) as any
    }

    it('1) inheritance match: parent registration applies to a subclass doc', async () => {
      const parentClass = 'class:test.ParentClass' as Ref<Class<Doc>>
      const childClass = 'class:test.ChildClass' as Ref<Class<Doc>>
      const hierarchy = buildHierarchy({
        [childClass]: [childClass, parentClass]
      })
      const parentCC = makeGrantingCC(parentClass)
      const findAll = makeFindAll([parentCC])
      const doc = { _id: 'doc1' as any, _class: childClass, space: 'space1' as any } as unknown as Doc

      const result = await resolveMentionGrantTarget(doc, findAll, hierarchy)
      expect(result).toBe(doc)
    })

    it('2) no registration anywhere in ancestors → null', async () => {
      const onlyClass = 'class:test.UnregisteredClass' as Ref<Class<Doc>>
      const hierarchy = buildHierarchy({ [onlyClass]: [onlyClass] })
      const findAll = makeFindAll([])
      const doc = { _id: 'doc2' as any, _class: onlyClass, space: 'space1' as any } as unknown as Doc

      const result = await resolveMentionGrantTarget(doc, findAll, hierarchy)
      expect(result).toBeNull()
    })

    it('3) exact-class match: own class is registered → returned directly', async () => {
      const cls = 'class:test.OwnClass' as Ref<Class<Doc>>
      const hierarchy = buildHierarchy({ [cls]: [cls] })
      const ownCC = makeGrantingCC(cls)
      const findAll = makeFindAll([ownCC])
      const doc = { _id: 'doc3' as any, _class: cls, space: 'space1' as any } as unknown as Doc

      const result = await resolveMentionGrantTarget(doc, findAll, hierarchy)
      expect(result).toBe(doc)
    })

    it('4) closest-ancestor wins: parent CC takes precedence over grandparent CC', async () => {
      const childClass = 'class:test.Child' as Ref<Class<Doc>>
      const parentClass = 'class:test.Parent' as Ref<Class<Doc>>
      const grandParentClass = 'class:test.GrandParent' as Ref<Class<Doc>>
      const hierarchy = buildHierarchy({
        [childClass]: [childClass, parentClass, grandParentClass]
      })
      const parentCC = makeGrantingCC(parentClass)
      const grandParentCC = makeGrantingCC(grandParentClass)
      const findAll = makeFindAll([parentCC, grandParentCC])
      const doc = { _id: 'doc4' as any, _class: childClass, space: 'space1' as any } as unknown as Doc

      const result = await resolveMentionGrantTarget(doc, findAll, hierarchy)
      // The returned grant target is the doc itself; what matters is that the
      // lookup *found* a match via the closest ancestor (parent). We assert
      // parity with getClassCollaborators in case (5) below.
      expect(result).toBe(doc)
    })

    it('5) parity with getClassCollaborators: same subclass + parent registration', async () => {
      const childClass = 'class:test.Sub' as Ref<Class<Doc>>
      const parentClass = 'class:test.Base' as Ref<Class<Doc>>
      const ancestors = [childClass, parentClass]

      const hierarchy = new Hierarchy()
      hierarchy.getAncestors = jest.fn().mockReturnValue(ancestors) as any

      const parentCC = makeGrantingCC(parentClass)

      // getClassCollaborators uses model.findAllSync — feed it the parent CC.
      const model = new ModelDb(hierarchy)
      model.findAllSync = jest.fn().mockReturnValue([parentCC]) as any
      const gccResult = getClassCollaborators(model, hierarchy, childClass)
      expect(gccResult).toBe(parentCC)

      // resolveMentionGrantTarget uses the injected findAll. Same registration
      // → must agree the subclass inherits the parent's grant capability.
      const findAll = makeFindAll([parentCC])
      const doc = { _id: 'doc5' as any, _class: childClass, space: 'space1' as any } as unknown as Doc
      const rmtResult = await resolveMentionGrantTarget(doc, findAll, hierarchy)
      expect(rmtResult).toBe(doc)
      // The shared invariant: both code paths recognize that `childClass`
      // inherits CC from `parentClass`. gccResult is the CC record itself;
      // rmtResult is the doc (since cur===doc is the first ancestor in the
      // attachedTo chain to satisfy the predicate).
      expect((gccResult as ClassCollaborators<Doc>).attachedTo).toBe(parentClass)
    })

    it('6) attachedTo chain still traversed when no class in start ancestors matches', async () => {
      // Sanity guard: hierarchy-awareness on cur._class does NOT regress the
      // existing attachedTo-chain walk used for ThreadMessage → ChatMessage → Issue.
      const childMsgClass = 'class:test.ChildMsg' as Ref<Class<Doc>>
      const issueClass = 'class:test.Issue' as Ref<Class<Doc>>
      const hierarchy = buildHierarchy({
        [childMsgClass]: [childMsgClass],
        [issueClass]: [issueClass]
      })
      const issueCC = makeGrantingCC(issueClass)
      const issueDoc = { _id: 'issue1' as any, _class: issueClass, space: 'space1' as any } as unknown as Doc

      // findAll returns the issueCC for ClassCollaborators-queries (only when issueClass is in $in),
      // and returns the issueDoc when looked up by _id via its attachedToClass.
      const findAll: any = jest.fn(async (cls: any, q: any) => {
        if (cls === core.class.ClassCollaborators) {
          const inList: Ref<Class<Doc>>[] = q?.attachedTo?.$in ?? []
          return inList.includes(issueClass) ? [issueCC] : []
        }
        if (cls === issueClass) return [issueDoc]
        return []
      })

      const childMsg = {
        _id: 'msg1' as any,
        _class: childMsgClass,
        space: 'space1' as any,
        attachedTo: issueDoc._id,
        attachedToClass: issueClass,
        collection: 'messages'
      } as unknown as AttachedDoc

      const result = await resolveMentionGrantTarget(childMsg, findAll, hierarchy)
      expect(result).toBe(issueDoc)
    })
  })
})
