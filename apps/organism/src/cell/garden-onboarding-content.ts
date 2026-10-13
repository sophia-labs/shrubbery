/**
 * The editable hosted Garden tour. New editions get new IDs; published editions
 * are never used to rewrite a person's copy. This is authored source, not an
 * export of a user's graph or the historical desktop onboarding archive.
 */
export const GARDEN_ONBOARDING_EDITION = '2026-09-06'
export const GARDEN_ONBOARDING_TITLE = 'Garden tour — A small question'

export interface GardenOnboardingBlock {
  readonly type: 'paragraph' | 'heading'
  readonly text: string
}

export interface GardenOnboardingPage {
  readonly documentId: string
  readonly title: string
  readonly blocks: readonly GardenOnboardingBlock[]
}

const p = (text: string): GardenOnboardingBlock => ({ type: 'paragraph', text })
const h = (text: string): GardenOnboardingBlock => ({ type: 'heading', text })

export const GARDEN_ONBOARDING_PAGES: readonly GardenOnboardingPage[] = [
  {
    documentId: 'garden-tour-20260906-start',
    title: '01 · Start here — a small question',
    blocks: [
      p('Welcome to Garden. Bring one question you would like to understand a little better: a place to visit, something you are learning, or a decision you keep postponing. You do not need a complete system before you begin.'),
      h('Make this small project yours'),
      p('Open “02 · My field notes” in the Documents sidebar. Replace the sample question with your own, then add one observation. “03 · One useful finding” shows the difference between an observation, an interpretation, and a next question.'),
      p('Next, try finding a phrase from your note with Search. Then use “07 · Connect two ideas” to make one meaningful wire. Finally leave yourself a next step and return to it later. Those are the whole first visit; the other pages are companions when you need them.'),
      h('A graph is a place for related work'),
      p('Garden Home lists the workspaces you can access; the interface also calls them graphs. Inside a graph, documents hold your writing, folders organize the sidebar, and wires give relationships their own meaning. A folder is not a separate sharing boundary: access roles belong to the graph.'),
      p('This tour is a separate editable workspace, not a layer over your existing notes. Rename it or keep it as a reference. Creating it uses one workspace slot; opening Home or reading the tour does not silently create another.'),
      h('A guide that can change without changing your work'),
      p('Edition 2026-09-06, authored by the First Companion for Garden. Your copy belongs to you. Future help is offered as an explicit new tour edition in a separate workspace; it does not replace these pages or your older onboarding graph. Keep the useful parts, and ignore the rest.'),
    ],
  },
  {
    documentId: 'garden-tour-20260906-notes',
    title: '02 · My field notes',
    blocks: [
      p('This is your practice page. Edit the prompts below; there is no form to submit.'),
      h('My question'),
      p('What makes a place good for an unhurried conversation? Replace this example with a question of your own.'),
      h('One observation'),
      p('Write something specific you noticed, read, or heard. Keep the source or context beside it so your future self can tell what the observation rests on.'),
      h('What I think it might mean'),
      p('Separate your interpretation from the observation. It is fine to write “I am not sure yet.”'),
      h('Next time'),
      p('Choose one small next action: find a second example, ask a friend, or revisit the original source. A useful note gives you somewhere to return.'),
      p('Next: open “03 · One useful finding”, then “07 · Connect two ideas”. You will make the relationship yourself rather than inherit an unexplained web of links.'),
    ],
  },
  {
    documentId: 'garden-tour-20260906-finding',
    title: '03 · One useful finding',
    blocks: [
      p('Example, not an imported source: “The quiet table was beside a window, away from the counter.” This is an observation. “Perhaps distance from interruptions matters more than silence” is an interpretation.'),
      p('A useful finding keeps both, along with where they came from. Replace this example with a finding related to your own question, or create a new document from the sidebar and give it a title you will recognize.'),
      p('Use a folder when several documents belong together. Keep the first project small: a question, a few notes, and the sources that support them are enough.'),
      p('Next: connect this finding to “02 · My field notes”. A wire can say that it supports, challenges, or simply relates to your question; choose the relationship you actually mean.'),
    ],
  },
  {
    documentId: 'garden-tour-20260906-return',
    title: '04 · Leave a good return',
    blocks: [
      p('Before leaving, put one concrete next action at the end of your field notes. Return through Garden Home and open the same graph and document. Check the last sentence you wrote before you continue.'),
      p('A connected session, a local copy, a cloud acknowledgement, and a confirmed return are different observations. Read the workspace and document status cues; “saved locally” is not a promise that cloud creation or synchronization has completed.'),
      h('When the editor will not let you continue'),
      p('If a document is read-only, waiting for authority, or shows recovery work, keep that state visible. Check your current graph and role, and inspect the offered recovery information. Do not delete a local copy or force an old snapshot over newer work just to make the warning disappear.'),
      p('An unconfirmed or refused workspace creation can retain local work without being openable as a hosted graph. Refresh the workspace list to inspect the current result; do not keep creating replacements to escape an unclear status.'),
      h('Make the room comfortable'),
      p('Settings exposes the controls available to this host and account. Appearance and account settings are separate from graph-specific operations. Embeddings are explained in “05 · Find the thread again”. A desktop option being absent on the hosted service does not mean your data has disappeared.'),
    ],
  },
  {
    documentId: 'garden-tour-20260906-search',
    title: '05 · Find the thread again',
    blocks: [
      p('First search for a distinctive phrase you wrote in your field notes. Open the returned document or block and inspect the surrounding text. A result is a route back to evidence, not a substitute for reading it.'),
      p('Semantic search is a different way to find related meaning. It uses the prepared embedding index for the graph, so an empty or out-of-date index can miss material that still exists in your documents. Try a paraphrase of your question after checking index status.'),
      h('Hosted embeddings'),
      p('Open Settings → Embeddings for the selected graph. The hosted page shows the effective model, provider, and index returned by the service. The remote pool chooses its configuration here: this is not a desktop model picker, local model download, or per-user batch-size control.'),
      p('The status API admits Viewer reads, but the full hosted Viewer workspace and Settings journey is not yet available end to end. An admitted Editor or Owner can request index refresh where the control is enabled. Submission starts a job; wait for its matching terminal result before treating the refresh as complete. Reading status does not itself rebuild the index.'),
      p('Next: compare a phrase search and a semantic query against one note you know exists. If either fails, keep the query and index status with your observation instead of assuming the note was lost.'),
    ],
  },
  {
    documentId: 'garden-tour-20260906-sources',
    title: '06 · Bring one source',
    blocks: [
      p('Bring one modest source that helps answer your question. Use the available file-import action, or the supported archive import in Settings → Imports, and check the result in the document list. Start small enough that you can inspect the whole return.'),
      p('An original file, its extracted document, and your own interpretation are different things. Keep a source name or URL in your note, open the imported content, and check a passage against the original before building on it. A queued import or extraction is not yet a finished document.'),
      p('Some imported documents begin read-only. Use the offered editable-copy or “Make editable” action when appropriate; changing the role label does not turn an original source into an ordinary editable note.'),
      p('Available imports depend on the host. Hosted Garden does not configure a local filesystem importer merely because the desktop has one. Do not place passwords, API keys, or private access tokens into the content of a graph to make an import work.'),
      p('Next: write one sentence in your field notes saying what this source changes about your question. Then connect the note and source with a relationship you can explain.'),
    ],
  },
  {
    documentId: 'garden-tour-20260906-wires',
    title: '07 · Connect two ideas',
    blocks: [
      p('Open your field notes and use the Wires panel or wire controls offered by the document surface to connect it to “03 · One useful finding”. Select the source and target you mean; a block-level wire points to a passage, while a document-level wire relates the pages.'),
      p('Choose a relationship deliberately. “Supports” says more than “related to”; use a weaker relationship when that is all the evidence warrants. Direction matters: a finding supporting a question is not automatically the reverse claim.'),
      p('After creating the wire, inspect it from the document and follow its target. Check the graph, document, and any selected block. Writing a title in prose or putting documents in the same folder does not create a semantic wire.'),
      p('Next: return through the wire and add a question to the finding. One useful connection is a better first project than a large diagram whose edges you cannot explain.'),
    ],
  },
  {
    documentId: 'garden-tour-20260906-sharing',
    title: '08 · Share deliberately',
    blocks: [
      p('When you are ready to share the project, the graph Owner can open Share or Manage workspace access. The current hosted dialog accepts an existing typed user ID in the form user:<subject>, with Viewer or Editor role. Obtain the intended person’s correct ID before changing access.'),
      p('This is a direct access grant, not an email lookup, an invitation inbox, or a public-link workflow. The Owner is the graph’s authority and need not appear as a separate membership row. Only the Owner manages access; an Editor role does not grant ownership.'),
      p('Viewer expresses read access, not permission to edit. Editor permits authorized content changes. The full hosted Viewer workspace and Settings journey is not yet available end to end. A successful Viewer grant does not make that shell available; check the actual recipient experience before relying on it.'),
      p('Loading or an access error is not an empty member list. After an accepted change, the dialog reloads membership. If it says the change is unconfirmed, use the offered refresh and inspect the result rather than repeat the mutation. Canceling removal should leave the grant alone.'),
      p('Next: agree on the smallest role the other person needs, and check the actual recipient experience together. You do not need to grant anyone access just to finish this tour.'),
    ],
  },
  {
    documentId: 'garden-tour-20260906-agents',
    title: '09 · Give an agent a useful question',
    blocks: [
      p('If your account has an available chat or agent connection, start with a bounded request: “Read my field notes and one supporting source. Tell me what is observed, what is inferred, and one question worth pursuing. Cite the documents or blocks you used; do not edit yet.”'),
      p('Garden’s graph tool surface includes context_bundle, list_documents, read_document, search_documents, semantic_search, get_wires, and create_wires. An actual connection discovers the tools and schemas it has; its authenticated graph access still determines what it may read or change. A tool name in this guide does not install or authorize a connection.'),
      p('Ask for a proposed change before approving a write. Keep the target graph and document explicit, especially when more than one workspace is open. Agent access, model/provider configuration, and a completed response are separate from a durable content change.'),
      p('Finish by checking the cited passage yourself and leaving a next action in “02 · My field notes”. The aim is a project you can understand and return to, whether your next companion is another person, an agent, or your future self.'),
    ],
  },
]

/** Canonical simple blocks keep both authored text and stable block IDs reviewable. */
export function gardenOnboardingDocument(page: GardenOnboardingPage): Record<string, unknown> {
  return {
    type: 'doc',
    content: page.blocks.map((block, index) => ({
      type: block.type,
      attrs: {
        'data-block-id': `${page.documentId}-b${index + 1}`,
        ...(block.type === 'heading' ? { level: 2 } : {}),
      },
      content: [{ type: 'text', text: block.text }],
    })),
  }
}
