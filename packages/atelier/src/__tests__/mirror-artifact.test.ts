import { describe, expect, it } from 'vitest'
import { buildArtifactArchiveRequests } from '../mirror-artifact.js'

describe('buildArtifactArchiveRequests', () => {
  it('keeps bytes in the revision request and emits SHACL-conforming navigation metadata', () => {
    const requests = buildArtifactArchiveRequests('mirror-1', {
      label: 'Atelier mirror portrait',
      originalFilename: 'portrait.png',
      mimeType: 'image/png',
      dataBase64: 'iVBORw0KGgo=',
    })

    expect(requests.revision).toEqual({
      dataBase64: 'iVBORw0KGgo=',
      mimeType: 'image/png',
      filename: 'portrait.png',
      label: 'Atelier mirror portrait',
    })
    expect(requests.navigation).toEqual({
      label: 'Atelier mirror portrait',
      originalFilename: 'portrait.png',
      mimeType: 'image/png',
      status: 'ready',
      storageKey: 'local://artifacts/mirror-1/original/portrait.png',
    })

    // Garden's current workspace SHACL contract declares nfo:fileSize as an
    // optional xsd:string, while workspace.putArtifact materializes any size
    // supplied here as xsd:integer. Omission is the only truthful conforming
    // client payload; read_artifact reports the measured manifest size.
    expect(requests.navigation).not.toHaveProperty('dataBase64')
    expect(requests.navigation).not.toHaveProperty('size')
    expect(requests.navigation).not.toHaveProperty('sizeBytes')
  })
})
