import { afterEach, expect, it, vi } from 'vitest'
import type { IdeFile } from '@shrubbery/nucleus'
import { FileTree } from '@pierre/trees'
import { repositoryTreeGitStatus, type WfRepositoryTree } from '../wf-repository-tree.js'
import '../wf-repository-tree.js'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })
const file = (path: string, fileId = path): IdeFile => ({ path, fileId, bytes: 10, mode: '100644', tracked: true, gitStatus: '', kind: 'text', editable: true, diskVersion: 'disk:1' })
const root = (element: WfRepositoryTree) => element.shadowRoot!.querySelector('file-tree-container')!.shadowRoot!
async function mount(files = [file('a.ts'), file('b.ts')]) {
  const element = document.createElement('wf-repository-tree')
  element.riftId = 'alpha'; element.files = files
  document.body.append(element); await element.updateComplete
  await vi.waitFor(() => expect(root(element).querySelector('[role="treeitem"]')).not.toBeNull())
  return element
}

it('opens through an intent and follows stable identity through a remote rename without another open', async () => {
  const element = await mount(), open = vi.fn()
  element.addEventListener('repository-file-open', open)
  ;(root(element).querySelector('[data-item-path="a.ts"]') as HTMLElement).click()
  expect(open).toHaveBeenCalledOnce()
  expect((open.mock.calls[0]![0] as CustomEvent).detail).toEqual({ path: 'a.ts', fileId: 'a.ts', riftId: 'alpha' })
  element.activeFileId = 'a.ts'
  element.files = [file('renamed.ts', 'a.ts'), file('b.ts')]
  await element.updateComplete
  await vi.waitFor(() => expect(root(element).querySelector('[data-item-path="renamed.ts"]')?.getAttribute('aria-selected')).toBe('true'))
  expect(root(element).querySelector('[data-item-path="a.ts"]')).toBeNull()
  expect(open).toHaveBeenCalledOnce()
})

it('disposes the previous Rift tree, clears selection and releases the final instance on removal', async () => {
  const clean = vi.spyOn(FileTree.prototype, 'cleanUp')
  const element = await mount(); element.activeFileId = 'a.ts'; await element.updateComplete
  const previous = element.shadowRoot!.querySelector('file-tree-container')!
  element.riftId = 'beta'; element.files = [file('beta.ts', 'different-id')]; element.activeFileId = ''
  await element.updateComplete
  await vi.waitFor(() => expect(root(element).querySelector('[data-item-path="beta.ts"]')).not.toBeNull())
  expect(previous.isConnected).toBe(false); expect(clean).toHaveBeenCalledOnce()
  expect(root(element).querySelector('[aria-selected="true"]')).toBeNull()
  element.remove(); expect(clean).toHaveBeenCalledTimes(2)
})

it('keeps viewport rendering bounded for a large complete metadata tree', async () => {
  const element = await mount(Array.from({ length: 25000 }, (_, i) => file(`file-${String(i).padStart(5, '0')}.ts`)))
  const rows = root(element).querySelectorAll('[role="treeitem"]')
  expect(rows.length).toBeGreaterThan(0); expect(rows.length).toBeLessThan(100)
  expect(rows[0]!.getAttribute('aria-setsize')).toBe('25000')
})

it('preserves the distinction between Git conflicts and ordinary status badges', () => {
  expect(repositoryTreeGitStatus(' M')).toBe('modified')
  expect(repositoryTreeGitStatus('R ')).toBe('renamed')
  expect(repositoryTreeGitStatus('??')).toBe('untracked')
  expect(repositoryTreeGitStatus('!!')).toBe('ignored')
  expect(repositoryTreeGitStatus('UU')).toBeNull()
  expect(repositoryTreeGitStatus('AA')).toBeNull()
  expect(repositoryTreeGitStatus('')).toBeNull()
})

it('reapplies an active filter when metadata changes without showing unrelated paths', async () => {
  const element = await mount()
  element.filter = 'a.ts'; await element.updateComplete
  await vi.waitFor(() => expect(root(element).querySelector('[data-item-path="b.ts"]')).toBeNull())
  element.files = [file('a.ts'), file('b.ts'), file('c.ts')]; await element.updateComplete
  await vi.waitFor(() => {
    expect(root(element).querySelector('[data-item-path="a.ts"]')).not.toBeNull()
    expect(root(element).querySelector('[data-item-path="b.ts"]')).toBeNull()
    expect(root(element).querySelector('[data-item-path="c.ts"]')).toBeNull()
  })
  element.filter = 'missing-in-this-rift'; await element.updateComplete; await element.updateComplete
  expect(element.shadowRoot!.querySelector('.mount')!.hasAttribute('hidden')).toBe(true)
  await vi.waitFor(() => expect(element.shadowRoot!.querySelector('[role="status"]')?.textContent).toBe('No matching files'))
  expect(element.shadowRoot!.querySelector('[role="status"]')!.hasAttribute('hidden')).toBe(false)
  element.filter = ''; await element.updateComplete; await element.updateComplete
  expect(element.shadowRoot!.querySelector('.mount')!.hasAttribute('hidden')).toBe(false)
})
