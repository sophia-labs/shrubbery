export const KOCH_FACE_IDS = Object.freeze({
  curriculum: 'koch.curriculum.v1',
  practice: 'koch.practice.v1',
  progress: 'koch.progress.v1',
})

export type KochFaceId = (typeof KOCH_FACE_IDS)[keyof typeof KOCH_FACE_IDS]

export const KOCH_FACE_ID_SET: ReadonlySet<string> = new Set(Object.values(KOCH_FACE_IDS))

export function isKochFaceId(faceId: string): faceId is KochFaceId {
  return KOCH_FACE_ID_SET.has(faceId)
}
