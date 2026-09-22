/**
 * @shrubbery/atelier-vtuber — glb-inspect: the deterministic GLB/VRM oracle.
 *
 * A PURE binary-parsing module: no `three`, no DOM, no VRM loader. It reads
 * the raw GLB container (a length-prefixed binary chunk followed by a JSON
 * chunk and an optional BIN chunk) and the glTF/VRM JSON inside it by hand,
 * with a plain `DataView` over the caller's `ArrayBuffer`. This is what lets
 * it run byte-identically in Node (the Atelier ingestion factory) and in a
 * browser worker, with no rendering dependency to go stale.
 *
 * Every VRM field name is passed through EXACTLY as the spec (or, for VRM
 * 0.x, the widely-shipped implementation) writes it — including 0.x's
 * canonical misspellings (`violentUssageName`, `sexualUssageName`,
 * `commercialUssageName`). This module never "corrects" a spec field name;
 * doing so would silently break byte-exact comparison against real assets.
 *
 * Semantics mirror the Python reference dissection this module was ported
 * from (scratch dissect_vrm.py) field-for-field.
 */

// ---------------------------------------------------------------------------
// GLB container
// ---------------------------------------------------------------------------

/** One length-prefixed chunk of a GLB container (its type tag, trimmed of
 * NUL padding, and its declared byte length). */
export interface GlbChunkInfo {
  type: string
  byteLength: number
}

export interface GlbHeaderInfo {
  magic: number
  version: number
  fileByteLength: number
  chunks: GlbChunkInfo[]
}

// ---------------------------------------------------------------------------
// glTF document (only the shape this module reads)
// ---------------------------------------------------------------------------

interface GltfAccessor {
  count: number
  /** The rest are only read for JOINTS_0/WEIGHTS_0/indices decoding (see
   * readAccessorElement) — every other consumer in this module only ever
   * needed `count`. */
  componentType?: number
  type?: string
  bufferView?: number
  byteOffset?: number
}

interface GltfPrimitive {
  attributes?: Record<string, number>
  indices?: number
  targets?: unknown[]
  /** Index into gltf.materials — read for garment/coverage-part
   * classification (see mesh-classify.ts), not by glb-inspect itself. */
  material?: number
}

interface GltfMesh {
  name?: string
  primitives?: GltfPrimitive[]
}

/** A glTF texture reference (`{ index, texCoord? }`) — only the `index` (into
 * `gltf.textures`) matters here; texture-transform/UV fields are irrelevant
 * to image-count recovery. */
interface GltfTextureRef {
  index?: number
}

interface GltfMaterial {
  name?: string
  alphaMode?: string
  extensions?: Record<string, unknown>
  /** The "well-known" glTF core + VRMC_materials_mtoon texture slots — read
   * only to recover which `images` a material touches (materialImageIndices
   * below). Not an exhaustive re-implementation of the material spec: any
   * texture slot outside this list (a future/unknown extension's own
   * texture-valued field) is invisible to that count, a documented gap, not
   * a silent undercount of a KNOWN slot. */
  pbrMetallicRoughness?: {
    baseColorTexture?: GltfTextureRef
    metallicRoughnessTexture?: GltfTextureRef
  }
  normalTexture?: GltfTextureRef
  occlusionTexture?: GltfTextureRef
  emissiveTexture?: GltfTextureRef
}

interface GltfImage {
  name?: string
  mimeType?: string
  bufferView?: number
}

interface GltfTexture {
  source?: number
}

interface GltfBufferView {
  byteLength: number
  byteOffset?: number
  /** Present only for interleaved vertex attributes; honored by
   * readAccessorElement so a JOINTS_0/WEIGHTS_0/indices accessor sharing a
   * bufferView with other attributes decodes correctly. Absent (the common,
   * tightly-packed case — true of both this module's fixtures) means each
   * element is packed back-to-back with no gap. */
  byteStride?: number
}

interface GltfSkin {
  joints?: number[]
}

/** The fields this module reads off a glTF node: its display name (used to
 * resolve aux/twist/accessory skin-joint node indices to human-readable
 * names — see auxBoneJointNodeIndices/auxBoneJointNames below), and which
 * mesh/skin it instances (used to resolve a mesh's own bound bones — see
 * buildMeshesSummary). */
interface GltfNode {
  name?: string
  mesh?: number
  skin?: number
}

interface GltfDocument {
  asset?: { version?: string; generator?: string }
  extensionsUsed?: string[]
  extensions?: Record<string, unknown>
  nodes?: GltfNode[]
  skins?: GltfSkin[]
  meshes?: GltfMesh[]
  materials?: GltfMaterial[]
  images?: GltfImage[]
  textures?: GltfTexture[]
  bufferViews?: GltfBufferView[]
  accessors?: GltfAccessor[]
}

export interface GltfSummary {
  topLevelKeys: string[]
  extensionsUsed: string[]
  /** glTF `asset.generator` / `asset.version` — e.g. "UniGLTF-1.28" for
   * VRoid-authored 0.x exports. */
  generator?: string
  assetVersion?: string
}

// ---------------------------------------------------------------------------
// VRM 1.0 (VRMC_vrm)
// ---------------------------------------------------------------------------

/** VRMC_vrm `meta`, field names verbatim per the VRM 1.0 spec. */
export interface VrmMetaV1 {
  name?: string
  version?: string
  authors?: string[]
  copyrightInformation?: string
  contactInformation?: string
  references?: string[]
  thirdPartyLicenses?: string
  thumbnailImage?: number
  licenseUrl?: string
  avatarPermission?: string
  allowExcessivelyViolentUsage?: boolean
  allowExcessivelySexualUsage?: boolean
  commercialUsage?: string
  allowPoliticalOrReligiousUsage?: boolean
  allowAntisocialOrHateUsage?: boolean
  creditNotation?: string
  allowRedistribution?: boolean
  modification?: string
  otherLicenseUrl?: string
  [key: string]: unknown
}

interface VrmcVrmExtension {
  specVersion?: string
  meta?: VrmMetaV1
  humanoid?: { humanBones?: Record<string, { node: number }> }
  expressions?: { preset?: Record<string, unknown>; custom?: Record<string, unknown> }
}

interface VrmcSpringBoneExtension {
  springs?: { joints?: unknown[] }[]
  colliders?: unknown[]
  colliderGroups?: unknown[]
}

export interface HumanoidSummary {
  boneCount: number
  boneNames: string[]
}

export interface Vrm1ExpressionSummary {
  presetNames: string[]
  customNames: string[]
}

export interface Vrm1SpringBoneSummary {
  springCount: number
  jointCount: number
  colliderCount: number
  colliderGroupCount: number
}

export interface Vrm1Summary {
  specVersion: string | undefined
  meta: VrmMetaV1
  humanoid: HumanoidSummary
  expressions: Vrm1ExpressionSummary
  springBone: Vrm1SpringBoneSummary | null
}

// ---------------------------------------------------------------------------
// VRM 0.x (VRM)
// ---------------------------------------------------------------------------

/** Legacy VRM 0.x `meta`, field names verbatim — INCLUDING the spec's own
 * canonical misspellings of the usage-permission fields. Do not "fix" these;
 * every real 0.x asset in the wild carries the typo. */
export interface VrmMetaV0 {
  title?: string
  version?: string
  author?: string
  contactInformation?: string
  reference?: string
  texture?: number
  allowedUserName?: string
  violentUssageName?: string
  sexualUssageName?: string
  commercialUssageName?: string
  otherPermissionUrl?: string
  licenseName?: string
  otherLicenseUrl?: string
  [key: string]: unknown
}

interface Vrm0Extension {
  meta?: VrmMetaV0
  humanoid?: { humanBones?: { bone?: string; node: number }[] }
  blendShapeMaster?: { blendShapeGroups?: unknown[] }
  secondaryAnimation?: { boneGroups?: unknown[]; colliderGroups?: unknown[] }
}

export interface Vrm0BlendShapeSummary {
  groupCount: number
}

export interface Vrm0SecondaryAnimationSummary {
  boneGroupCount: number
  colliderGroupCount: number
}

export interface Vrm0Summary {
  meta: VrmMetaV0
  humanoid: HumanoidSummary
  blendShape: Vrm0BlendShapeSummary
  secondaryAnimation: Vrm0SecondaryAnimationSummary | null
}

// ---------------------------------------------------------------------------
// Scene graph, meshes, materials, images
// ---------------------------------------------------------------------------

export interface SkinSummary {
  jointCount: number
}

/** One primitive of a mesh — the granularity garment carving actually needs
 * (see mesh-classify.ts/ingest-garment.ts): a VRoid "baked" mesh routinely
 * mixes body-skin and cloth primitives in the SAME mesh, sharing one vertex
 * buffer (avatar-sample-a.vrm's 'Body.baked' is exactly this — 4 `_SKIN`
 * primitives alongside 3 `_CLOTH` ones), so a whole-mesh verdict can't
 * separate them; per-primitive material + bound-bone facts can. */
export interface MeshPrimitiveSummary {
  /** Index into the report's top-level `materials[]`, or null if this
   * primitive has no material assigned at all (rare but glTF-legal). */
  materialIndex: number | null
  /** materials[materialIndex]?.name, or null when materialIndex is null —
   * mirrors materialIndex's own null case rather than defaulting to ''
   * (unlike MaterialSummary.name), so a caller can tell "no material" apart
   * from "material with an empty name". */
  materialName: string | null
  vertexCount: number
  triangleCount: number
  /** Humanoid-mapped bone names this ONE primitive's own vertices bind
   * (JOINTS_0, restricted to the vertex indices this primitive's own
   * `indices` accessor actually draws — see primitiveLocalJointIndices),
   * sorted. Generation-agnostic: resolved against whichever of VRM1/VRM0's
   * humanoid map the document declares (see humanoidBoneNameByNode) — same
   * "carry both, judge neither" stance as auxBoneJointNames; a caller
   * deciding whether a VRM0 name is trustworthy for its own closed
   * vocabulary makes that call itself (see ingest-garment.ts). Empty for an
   * unskinned primitive or one with no JOINTS_0 attribute. */
  boundHumanBoneNames: string[]
  /** The same resolution as boundHumanBoneNames, for bound joints NOT in the
   * humanoid map — this primitive's own subset of the document-level
   * auxBoneJointNames, sorted. */
  boundAuxBoneNames: string[]
}

export interface MeshSummary {
  name: string
  primitiveCount: number
  vertexCount: number
  triangleCount: number
  maxMorphTargetCount: number
  /** Per-primitive breakdown — see MeshPrimitiveSummary. */
  primitives: MeshPrimitiveSummary[]
  /** This mesh's bound humanoid bone names — the union of all its
   * primitives' own boundHumanBoneNames, sorted. Empty for an unskinned
   * mesh. */
  boundHumanBoneNames: string[]
  /** This mesh's bound aux bone names — the union of all its primitives' own
   * boundAuxBoneNames, sorted. */
  boundAuxBoneNames: string[]
}

export interface MeshesSummary {
  meshes: MeshSummary[]
  totalVertexCount: number
  totalTriangleCount: number
}

export interface MaterialSummary {
  name: string
  alphaMode: string
  hasMtoon: boolean
  /** Distinct indices into the report's top-level `images[]` this material
   * references through a "well-known" texture slot (see GltfMaterial) —
   * sorted, deduplicated (two slots commonly share one texture, e.g. MToon's
   * shadeMultiplyTexture reusing the same texture as baseColorTexture).
   * Counts IMAGES (matching how MeshesSummary/ImageSummary already count at
   * the image level, not the raw glTF `textures[]` level) so a Garment's
   * stats.textureCount is directly comparable to a Base's budgets.textureCount. */
  imageIndices: number[]
}

export interface ImageSummary {
  name: string
  mimeType: string
  byteLength: number
  width: number | null
  height: number | null
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** Which VRM extension the document declares — the two generations are
 * mutually exclusive in practice, so this is a detection, not a guess. */
export type VrmDetection = 'VRMC_vrm' | 'VRM' | null

export interface VrmInspectionReport {
  glb: GlbHeaderInfo
  gltf: GltfSummary
  vrmDetection: VrmDetection
  vrm1: Vrm1Summary | null
  vrm0: Vrm0Summary | null
  nodeCount: number
  skins: SkinSummary[]
  meshes: MeshesSummary
  materials: MaterialSummary[]
  images: ImageSummary[]
  /** Skin joint nodes NOT covered by the humanoid bone map — hair, skirts,
   * accessories, robo-arms, whatever the rig adds beyond the standard
   * skeleton. Computed for whichever VRM generation is present. */
  auxBoneJointCount: number
  /** Node names for exactly the joints counted in auxBoneJointCount, sorted
   * alphabetically — the names a wardrobe:Base publishes for its
   * ungoverned/aux bone coverage. Falls back to `#<nodeIndex>` for a joint
   * node with no `name` field (rare, but the glTF spec doesn't require one).
   * `auxBoneJointNames.length === auxBoneJointCount` always, by construction
   * (same underlying node-index set; see auxBoneJointNodeIndices). */
  auxBoneJointNames: string[]
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Parse PNG width/height out of an IHDR chunk, given the first bytes of a
 * PNG stream. Returns null if the bytes don't start with the PNG signature. */
function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) }
}

interface InternalChunk {
  type: string
  byteLength: number
  dataOffset: number
}

function readChunks(buffer: ArrayBuffer, view: DataView): InternalChunk[] {
  const chunks: InternalChunk[] = []
  let offset = 12
  const decoder = new TextDecoder()
  while (offset < buffer.byteLength) {
    const byteLength = view.getUint32(offset, true)
    const typeBytes = new Uint8Array(buffer, offset + 4, 4)
    const type = decoder.decode(typeBytes).replace(/\0+$/, '')
    const dataOffset = offset + 8
    chunks.push({ type, byteLength, dataOffset })
    offset = dataOffset + byteLength
  }
  return chunks
}

function buildVrm1Summary(vrmc: VrmcVrmExtension, extensions: Record<string, unknown>): Vrm1Summary {
  const humanBones = vrmc.humanoid?.humanBones ?? {}
  const boneNames = Object.keys(humanBones).sort()
  const presetNames = Object.keys(vrmc.expressions?.preset ?? {}).sort()
  const customNames = Object.keys(vrmc.expressions?.custom ?? {}).sort()

  const springBoneExt = extensions.VRMC_springBone as VrmcSpringBoneExtension | undefined
  const springBone: Vrm1SpringBoneSummary | null = springBoneExt
    ? {
        springCount: springBoneExt.springs?.length ?? 0,
        jointCount: (springBoneExt.springs ?? []).reduce((sum, spring) => sum + (spring.joints?.length ?? 0), 0),
        colliderCount: springBoneExt.colliders?.length ?? 0,
        colliderGroupCount: springBoneExt.colliderGroups?.length ?? 0,
      }
    : null

  return {
    specVersion: vrmc.specVersion,
    meta: vrmc.meta ?? {},
    humanoid: { boneCount: boneNames.length, boneNames },
    expressions: { presetNames, customNames },
    springBone,
  }
}

function buildVrm0Summary(vrm0: Vrm0Extension): Vrm0Summary {
  const humanBones = vrm0.humanoid?.humanBones ?? []
  const boneNames = humanBones.map((bone) => bone.bone ?? '?').sort()

  const secondaryAnimation: Vrm0SecondaryAnimationSummary | null = vrm0.secondaryAnimation
    ? {
        boneGroupCount: vrm0.secondaryAnimation.boneGroups?.length ?? 0,
        colliderGroupCount: vrm0.secondaryAnimation.colliderGroups?.length ?? 0,
      }
    : null

  return {
    meta: vrm0.meta ?? {},
    humanoid: { boneCount: humanBones.length, boneNames },
    blendShape: { groupCount: vrm0.blendShapeMaster?.blendShapeGroups?.length ?? 0 },
    secondaryAnimation,
  }
}

// ---------------------------------------------------------------------------
// Accessor byte-reading for JOINTS_0 / WEIGHTS_0 / indices — needed to
// resolve which humanoid/aux bones a mesh or, more precisely, a single
// PRIMITIVE actually binds. Only the glTF component types the spec allows
// for these attribute kinds are supported (UNSIGNED_BYTE/UNSIGNED_SHORT for
// JOINTS_0; those plus UNSIGNED_INT for indices; FLOAT for WEIGHTS_0 — both
// this module's fixtures store weights as FLOAT, not normalized integers).
// Sparse accessors are not supported — neither of this module's fixtures use
// them; a sparse accessor here would need its own decode path, left as a
// documented gap rather than silently wrong should one ever appear.
// ---------------------------------------------------------------------------

const ACCESSOR_COMPONENT_BYTE_SIZES: Record<number, number> = {
  5121: 1, // UNSIGNED_BYTE
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
}

const ACCESSOR_TYPE_COMPONENT_COUNTS: Record<string, number> = {
  SCALAR: 1,
  VEC4: 4,
}

/** Read one element (SCALAR or VEC4, per the accessor's own `type`) out of a
 * glTF accessor at logical element index `elementIndex`, honoring the
 * accessor's own byteOffset and the bufferView's byteOffset/byteStride.
 * Returns [] for an accessor this module doesn't know how to decode (missing
 * bufferView, unsupported/absent componentType or type) rather than
 * throwing — this is a best-effort bone-binding recovery, not a general
 * glTF accessor decoder. */
function readAccessorElement(
  gltf: GltfDocument,
  view: DataView,
  binChunk: InternalChunk | undefined,
  accessorIndex: number | undefined,
  elementIndex: number,
): number[] {
  if (accessorIndex === undefined || !binChunk) return []
  const accessor = gltf.accessors?.[accessorIndex]
  const bufferView = accessor?.bufferView !== undefined ? gltf.bufferViews?.[accessor.bufferView] : undefined
  const componentByteSize = accessor?.componentType !== undefined ? ACCESSOR_COMPONENT_BYTE_SIZES[accessor.componentType] : undefined
  const componentCount = ACCESSOR_TYPE_COMPONENT_COUNTS[accessor?.type ?? '']
  if (!accessor || !bufferView || !componentByteSize || !componentCount) return []

  const elementByteSize = componentByteSize * componentCount
  const stride = bufferView.byteStride ?? elementByteSize
  const start = binChunk.dataOffset + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + elementIndex * stride

  const out: number[] = []
  for (let c = 0; c < componentCount; c++) {
    const byteOffset = start + c * componentByteSize
    out.push(
      accessor.componentType === 5121
        ? view.getUint8(byteOffset)
        : accessor.componentType === 5123
          ? view.getUint16(byteOffset, true)
          : accessor.componentType === 5126
            ? view.getFloat32(byteOffset, true)
            : view.getUint32(byteOffset, true),
    )
  }
  return out
}

/** The vertex indices a primitive's geometry actually draws: its own
 * `indices` accessor if present, else every vertex of its POSITION accessor
 * in document order (the non-indexed case). This is the set JOINTS_0 gets
 * restricted to when resolving which bones a SPECIFIC primitive — not its
 * whole mesh's possibly-shared vertex buffer — binds (see
 * primitiveLocalJointIndices). This is exactly what separates a garment
 * carved out of a shared "baked" mesh (avatar-sample-a's Body.baked) from
 * the rest of that mesh: the CLOTH primitive's own index buffer only
 * touches the vertices that are actually the garment. */
function primitiveVertexIndices(
  gltf: GltfDocument,
  view: DataView,
  binChunk: InternalChunk | undefined,
  primitive: GltfPrimitive,
): number[] {
  const accessors = gltf.accessors ?? []
  if (primitive.indices !== undefined) {
    const count = accessors[primitive.indices]?.count ?? 0
    const out: number[] = []
    for (let i = 0; i < count; i++) {
      const [index] = readAccessorElement(gltf, view, binChunk, primitive.indices, i)
      if (index !== undefined) out.push(index)
    }
    return out
  }
  const positionIndex = primitive.attributes?.POSITION
  const count = positionIndex !== undefined ? accessors[positionIndex]?.count ?? 0 : 0
  return Array.from({ length: count }, (_, i) => i)
}

/** Local joint indices (indices INTO a skin's `joints` array, per glTF's
 * JOINTS_0 semantics — NOT node indices) a primitive's own vertices (see
 * primitiveVertexIndices) actually bind WITH NONZERO WEIGHT, deduplicated.
 * glTF pads JOINTS_0 to 4 slots per vertex regardless of how many bones
 * really influence it; a slot whose matching WEIGHTS_0 component is zero is
 * filler, not a real binding (avatar-sample-a's own `_CLOTH` primitives all
 * carry `Root` in exactly such a zero-weight slot — every one of its
 * ~4700 JOINTS_0 references across the three `_CLOTH` primitives has
 * WEIGHTS_0 0, confirmed against the real fixture), so it is excluded here
 * rather than counted as a bound bone. A primitive with JOINTS_0 but no
 * WEIGHTS_0 at all (glTF-illegal but defended against, same "don't throw on
 * a shape we don't expect" stance as readAccessorElement) counts every slot,
 * same as before this distinction existed. */
function primitiveLocalJointIndices(
  gltf: GltfDocument,
  view: DataView,
  binChunk: InternalChunk | undefined,
  primitive: GltfPrimitive,
): Set<number> {
  const out = new Set<number>()
  const jointsAccessor = primitive.attributes?.JOINTS_0
  if (jointsAccessor === undefined) return out
  const weightsAccessor = primitive.attributes?.WEIGHTS_0
  for (const vertexIndex of new Set(primitiveVertexIndices(gltf, view, binChunk, primitive))) {
    const joints = readAccessorElement(gltf, view, binChunk, jointsAccessor, vertexIndex)
    const weights = weightsAccessor !== undefined ? readAccessorElement(gltf, view, binChunk, weightsAccessor, vertexIndex) : []
    joints.forEach((joint, slot) => {
      if (weights.length > 0 && weights[slot] === 0) return
      out.add(joint)
    })
  }
  return out
}

/** node index -> humanoid bone name, for whichever VRM generation the
 * document declares (VRM1's humanoid.humanBones keys, or VRM0's
 * humanoid.humanBones[].bone) — the reverse of the Set
 * auxBoneJointNodeIndices builds. Generation-agnostic and byte-exact, same
 * "carry both, judge neither" stance as the rest of this oracle. */
function humanoidBoneNameByNode(vrmc: VrmcVrmExtension | undefined, vrm0: Vrm0Extension | undefined): Map<number, string> {
  const map = new Map<number, string>()
  for (const [name, bone] of Object.entries(vrmc?.humanoid?.humanBones ?? {})) map.set(bone.node, name)
  for (const bone of vrm0?.humanoid?.humanBones ?? []) {
    if (bone.bone !== undefined) map.set(bone.node, bone.bone)
  }
  return map
}

/** Resolve a primitive's bound local joint indices (primitiveLocalJointIndices)
 * through its mesh's skin to node indices, then split those into
 * humanoid-mapped bone names vs plain node names (aux) — exactly mirroring
 * auxBoneJointNames' own humanoid/aux split at document scope, here scoped
 * to one primitive. */
function primitiveBoneBinding(
  gltf: GltfDocument,
  view: DataView,
  binChunk: InternalChunk | undefined,
  primitive: GltfPrimitive,
  skin: GltfSkin | undefined,
  boneNameByNode: Map<number, string>,
): { humanBoneNames: string[]; auxBoneNames: string[] } {
  if (!skin) return { humanBoneNames: [], auxBoneNames: [] }
  const nodes = gltf.nodes ?? []
  const joints = skin.joints ?? []
  const humanBoneNames = new Set<string>()
  const auxBoneNames = new Set<string>()
  for (const localIndex of primitiveLocalJointIndices(gltf, view, binChunk, primitive)) {
    const nodeIndex = joints[localIndex]
    if (nodeIndex === undefined) continue
    const humanName = boneNameByNode.get(nodeIndex)
    if (humanName !== undefined) humanBoneNames.add(humanName)
    else auxBoneNames.add(nodes[nodeIndex]?.name ?? `#${nodeIndex}`)
  }
  return { humanBoneNames: [...humanBoneNames].sort(), auxBoneNames: [...auxBoneNames].sort() }
}

/** Distinct `images[]` indices a material references through a well-known
 * texture slot (glTF core + VRMC_materials_mtoon) — see MaterialSummary
 * .imageIndices. */
function materialImageIndices(gltf: GltfDocument, material: GltfMaterial): number[] {
  const textures = gltf.textures ?? []
  const images = new Set<number>()
  const consider = (ref: GltfTextureRef | undefined) => {
    if (ref?.index === undefined) return
    const source = textures[ref.index]?.source
    if (source !== undefined) images.add(source)
  }
  consider(material.pbrMetallicRoughness?.baseColorTexture)
  consider(material.pbrMetallicRoughness?.metallicRoughnessTexture)
  consider(material.normalTexture)
  consider(material.occlusionTexture)
  consider(material.emissiveTexture)
  const mtoon = material.extensions?.VRMC_materials_mtoon as Record<string, GltfTextureRef> | undefined
  if (mtoon) {
    for (const key of [
      'shadeMultiplyTexture',
      'shadingShiftTexture',
      'matcapTexture',
      'rimMultiplyTexture',
      'outlineWidthMultiplyTexture',
      'uvAnimationMaskTexture',
    ]) {
      consider(mtoon[key])
    }
  }
  return [...images].sort((a, b) => a - b)
}

function buildMeshesSummary(
  gltf: GltfDocument,
  view: DataView,
  binChunk: InternalChunk | undefined,
  vrmc: VrmcVrmExtension | undefined,
  vrm0: Vrm0Extension | undefined,
): MeshesSummary {
  const accessors = gltf.accessors ?? []
  const materials = gltf.materials ?? []
  const skins = gltf.skins ?? []
  const boneNameByNode = humanoidBoneNameByNode(vrmc, vrm0)

  // A mesh's skin is a NODE-level property in glTF (not mesh-level), so
  // resolving "this mesh's skin" means finding the node(s) that instance it.
  // Both this module's fixtures instance each mesh from exactly one node;
  // the first node found covers that common case. A mesh instanced by
  // multiple nodes with genuinely different skins (rare — most exporters
  // never do this) would only see the first one's bone bindings here.
  const skinIndexByMesh = new Map<number, number>()
  for (const node of gltf.nodes ?? []) {
    if (node.mesh !== undefined && node.skin !== undefined && !skinIndexByMesh.has(node.mesh)) {
      skinIndexByMesh.set(node.mesh, node.skin)
    }
  }

  const meshes: MeshSummary[] = (gltf.meshes ?? []).map((mesh, meshIndex) => {
    const primitives = mesh.primitives ?? []
    const skinIndex = skinIndexByMesh.get(meshIndex)
    const skin = skinIndex !== undefined ? skins[skinIndex] : undefined

    const primitiveSummaries: MeshPrimitiveSummary[] = primitives.map((prim) => {
      const positionIndex = prim.attributes?.POSITION
      const vertexCount = positionIndex === undefined ? 0 : accessors[positionIndex]?.count ?? 0
      const triangleCount = prim.indices === undefined ? 0 : Math.floor((accessors[prim.indices]?.count ?? 0) / 3)
      const materialIndex = prim.material ?? null
      const materialName = materialIndex !== null ? materials[materialIndex]?.name ?? '' : null
      const binding = primitiveBoneBinding(gltf, view, binChunk, prim, skin, boneNameByNode)
      return {
        materialIndex,
        materialName,
        vertexCount,
        triangleCount,
        boundHumanBoneNames: binding.humanBoneNames,
        boundAuxBoneNames: binding.auxBoneNames,
      }
    })

    const vertexCount = primitiveSummaries.reduce((sum, prim) => sum + prim.vertexCount, 0)
    const triangleCount = primitiveSummaries.reduce((sum, prim) => sum + prim.triangleCount, 0)
    const maxMorphTargetCount = primitives.reduce((max, prim) => Math.max(max, prim.targets?.length ?? 0), 0)
    const boundHumanBoneNames = [...new Set(primitiveSummaries.flatMap((prim) => prim.boundHumanBoneNames))].sort()
    const boundAuxBoneNames = [...new Set(primitiveSummaries.flatMap((prim) => prim.boundAuxBoneNames))].sort()

    return {
      name: mesh.name ?? '',
      primitiveCount: primitives.length,
      vertexCount,
      triangleCount,
      maxMorphTargetCount,
      primitives: primitiveSummaries,
      boundHumanBoneNames,
      boundAuxBoneNames,
    }
  })

  return {
    meshes,
    totalVertexCount: meshes.reduce((sum, mesh) => sum + mesh.vertexCount, 0),
    totalTriangleCount: meshes.reduce((sum, mesh) => sum + mesh.triangleCount, 0),
  }
}

function buildImageSummaries(gltf: GltfDocument, buffer: ArrayBuffer, binChunk: InternalChunk | undefined): ImageSummary[] {
  const bufferViews = gltf.bufferViews ?? []
  return (gltf.images ?? []).map((image) => {
    const bufferView = image.bufferView !== undefined ? bufferViews[image.bufferView] : undefined
    const byteLength = bufferView?.byteLength ?? 0

    let width: number | null = null
    let height: number | null = null
    if (image.mimeType === 'image/png' && bufferView && binChunk) {
      const start = binChunk.dataOffset + (bufferView.byteOffset ?? 0)
      const available = Math.max(0, Math.min(24, buffer.byteLength - start))
      const dims = readPngDimensions(new Uint8Array(buffer, start, available))
      if (dims) {
        width = dims.width
        height = dims.height
      }
    }

    return { name: image.name ?? '', mimeType: image.mimeType ?? '', byteLength, width, height }
  })
}

/** Skin joint node indices not covered by the humanoid bone map, for
 * whichever VRM generation the document declares. The single source of truth
 * for both auxBoneJointCount and auxBoneJointNames — computing the latter as
 * a name-resolution over these exact indices is what keeps the two fields
 * provably in sync (no separately-recomputed count to drift). */
function auxBoneJointNodeIndices(gltf: GltfDocument, vrmc: VrmcVrmExtension | undefined, vrm0: Vrm0Extension | undefined): number[] {
  const humanoidNodes = new Set<number>()
  for (const bone of Object.values(vrmc?.humanoid?.humanBones ?? {})) humanoidNodes.add(bone.node)
  for (const bone of vrm0?.humanoid?.humanBones ?? []) humanoidNodes.add(bone.node)

  const jointNodes = new Set<number>()
  for (const skin of gltf.skins ?? []) for (const joint of skin.joints ?? []) jointNodes.add(joint)

  const aux: number[] = []
  for (const joint of jointNodes) if (!humanoidNodes.has(joint)) aux.push(joint)
  return aux
}

/** Resolve aux bone joint node indices to display names — see
 * auxBoneJointNames on VrmInspectionReport. */
function auxBoneJointNames(gltf: GltfDocument, indices: readonly number[]): string[] {
  const nodes = gltf.nodes ?? []
  return indices.map((idx) => nodes[idx]?.name ?? `#${idx}`).sort()
}

/** Dissect a VRM/GLB buffer into the spec-grade report the Atelier ingestion
 * factory validates every wardrobe asset against. Pure binary parsing — no
 * `three`, no DOM, no VRM loader; safe to run in Node or a worker. */
export function inspectGlb(buffer: ArrayBuffer): VrmInspectionReport {
  const view = new DataView(buffer)
  const magic = view.getUint32(0, true)
  const version = view.getUint32(4, true)
  const fileByteLength = view.getUint32(8, true)

  const chunks = readChunks(buffer, view)
  const jsonChunk = chunks.find((chunk) => chunk.type === 'JSON')
  if (!jsonChunk) throw new Error('GLB buffer has no JSON chunk.')
  const jsonText = new TextDecoder().decode(new Uint8Array(buffer, jsonChunk.dataOffset, jsonChunk.byteLength))
  const gltf = JSON.parse(jsonText) as GltfDocument
  const binChunk = chunks.find((chunk) => chunk.type === 'BIN')

  const extensions = gltf.extensions ?? {}
  const vrmc = extensions.VRMC_vrm as VrmcVrmExtension | undefined
  const vrm0 = extensions.VRM as Vrm0Extension | undefined
  const vrmDetection: VrmDetection = vrmc ? 'VRMC_vrm' : vrm0 ? 'VRM' : null
  const auxIndices = auxBoneJointNodeIndices(gltf, vrmc, vrm0)

  return {
    glb: {
      magic,
      version,
      fileByteLength,
      chunks: chunks.map((chunk) => ({ type: chunk.type, byteLength: chunk.byteLength })),
    },
    gltf: {
      topLevelKeys: Object.keys(gltf).sort(),
      extensionsUsed: gltf.extensionsUsed ?? [],
      generator: gltf.asset?.generator,
      assetVersion: gltf.asset?.version,
    },
    vrmDetection,
    vrm1: vrmc ? buildVrm1Summary(vrmc, extensions) : null,
    vrm0: vrm0 ? buildVrm0Summary(vrm0) : null,
    nodeCount: gltf.nodes?.length ?? 0,
    skins: (gltf.skins ?? []).map((skin) => ({ jointCount: skin.joints?.length ?? 0 })),
    meshes: buildMeshesSummary(gltf, view, binChunk, vrmc, vrm0),
    materials: (gltf.materials ?? []).map((material) => ({
      name: material.name ?? '',
      alphaMode: material.alphaMode ?? 'OPAQUE',
      hasMtoon: Boolean(material.extensions?.VRMC_materials_mtoon),
      imageIndices: materialImageIndices(gltf, material),
    })),
    images: buildImageSummaries(gltf, buffer, binChunk),
    auxBoneJointCount: auxIndices.length,
    auxBoneJointNames: auxBoneJointNames(gltf, auxIndices),
  }
}
