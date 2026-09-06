export {
  EditImageExecutor,
  applyImageFieldPatch,
  applyImageFieldPatchAllLocales,
  assertImageStillMatches,
  buildImageEditGithubDraftFiles,
  buildImageEditKey,
  buildNewPublicImagePath,
  discoverEditableImages,
  fallbackImageEditGithubPath,
  previewOriginFromDeployment,
  resolveImageEditCandidate,
  restoreOrbitypeImagePreview,
  searchEditableImages,
  snapshotOrbitypeImageRestore,
  verifyProductionImageVisible,
  type ImageEditCandidate,
  type ImageEditGithubDraftFile,
  type ImageEditKind,
  type ImageEditPatchArtifact,
  type ImageEditPreviewResult,
  type ImageEditPublishResult,
  type OrbitypeImagePreviewState,
  type OrbitypeImageRestoreSnapshot,
  type OrbitypeImagesPort,
  type OrbitypePostSnapshot,
} from './edit-image.js';

export {
  EditThemeImageExecutor,
  isThemeAssetPath,
  resolveThemeImagePublishPath,
  type ThemeImagePatchArtifact,
  type ThemeImagePreviewResult,
  type ThemeImagePublishResult,
  type ThemeImageReadPort,
} from './edit-theme-image.js';

export {
  buildGitHubRawThemeAssetUrl,
  findThemeAssetUrlInHtml,
  resolveThemeAssetPreviewUrl,
  resolveThemeAssetPreviewUrlFromManifest,
  type ResolveThemeAssetPreviewUrlInput,
} from './theme-asset-preview-url.js';

export {
  DEFAULT_SURFACE_INVENTORY_PATH,
  inventoryImagesForArea,
  inventoryRowToImageEditCandidate,
  listInventoryImageAreas,
  parseSurfaceInventoryImages,
  resolveInventoryImageCandidate,
  searchInventoryImages,
  type SurfaceInventoryImageRow,
} from './surface-inventory.js';

export {
  extractSurfaceMarkersFromSource,
  mergeSurfaceInventoryYaml,
  remapSurfaceInventoryFromSources,
  type ExtractedSurfaceMarker,
  type RemapSurfaceInventoryResult,
  type SurfaceInventoryRow,
  type SurfaceMarkerKind,
} from './remap-surface-inventory.js';

export {
  assertRemapSucceeded,
  runThemeInventoryRemap,
  type RunThemeInventoryRemapInput,
  type RunThemeInventoryRemapResult,
  type ThemeInventoryTreePort,
} from './run-theme-inventory-remap.js';

export type { OrbitypePageSnapshot } from '@binflow/menu';
