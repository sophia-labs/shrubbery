/** A second kind, for tests only: a paper (title, authors, year) over a de:DocumentEdition whose de:docType is "paper". Not shipped. */
import type { FileKind } from '../../files-kinds/index.js'

export const paperKind: FileKind = {
  id: 'paper',
  captions: ['PDF'],
  recognize: '{ed} a de:DocumentEdition ; de:docType "paper"',
  fields: { title: 'de:title', authors: 'de:authors', year: 'de:year', venue: 'de:venue', state: 'de:readState' },
  card: {
    title: r => r.f.title ?? '',
    subtitle: r => [{ text: r.f.authors ?? '' }, ...(r.f.year ? [{ text: `· ${r.f.year}`, fixed: true }] : [])],
    values: r => r.f.venue ? [{ label: 'Venue', text: r.f.venue, mark: 'medium' }] : [],
    doneBadge: () => 'Read',
  },
  columns: [
    { header: 'Title', width: 'minmax(8rem, 1fr)', cell: r => ({ text: r.f.title ?? '', strong: true }) },
    { header: 'Authors', width: '10rem', cell: r => ({ text: r.f.authors ?? '' }) },
    { header: 'Year', width: '4rem', cell: r => ({ text: r.f.year ?? '' }) },
  ],
  lookable: () => false,
  summary: r => r.f.title ?? '',
  status: { state: 'state' },
}
