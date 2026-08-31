import { capabilityRegistry } from '@binflow/policies';

import { editImageNaturalLanguage } from './edit-image-ingress.js';
import { editTextNaturalLanguage } from './edit-text-ingress.js';

export type CapabilityIngressHandlerKind =
  | 'blog'
  | 'delete_blog'
  | 'delete_project'
  | 'edit_image'
  | 'edit_text'
  | 'project'
  | 'update_menu';

export type CapabilityIngressRoute = Readonly<{
  capabilityId: string;
  command: string;
  commandPattern: RegExp;
  handlerKind: CapabilityIngressHandlerKind;
  naturalLanguage?: (text: string) => boolean;
}>;

const escapeCommand = (command: string): string =>
  command.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const blogNaturalLanguage = (text: string): boolean =>
  /\b(blog|article|artículo|articulo|beitrag|post)\b/iu.test(text);

export const deleteBlogVerbPattern =
  /\b(borr\w*|elimin\w*|delet\w*|remov\w*|quit\w*)\b/iu;

const deleteBlogNaturalLanguage = (text: string): boolean =>
  deleteBlogVerbPattern.test(text) && blogNaturalLanguage(text);

export { deleteBlogNaturalLanguage };

const naturalProjectKeywordPattern =
  /\b(proyecto|portafolio|portfolio|projekt|referenz|case study|case-study|caso de estudio)\b/iu;

const naturalProjectCuePatterns = [
  /\bstack\s*:/iu,
  /\brol\s*:/iu,
  /\bestado\s*:/iu,
  /\bconfidencial\b/iu,
  /\bdestacad[oa]\b/iu,
  /\btipo\s*:/iu,
] as const;

/** Detect portfolio-project intent from conversational Telegram text. */
export const matchesNaturalProject = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (naturalProjectKeywordPattern.test(trimmed)) return true;
  let cues = 0;
  for (const pattern of naturalProjectCuePatterns) {
    if (pattern.test(trimmed)) cues += 1;
  }
  return cues >= 2;
};

export const deleteProjectNaturalLanguage = (text: string): boolean =>
  deleteBlogVerbPattern.test(text) && matchesNaturalProject(text);

export const updateMenuNaturalLanguage = (text: string): boolean =>
  /\b(actualiz\w*\s+men[uú]|subir\s+(?:la\s+)?carta|menu\s+pdf|update\s+menu|upload\s+menu|speisekarte\s+aktualisieren|men[uü]\s+hochladen)\b/iu.test(
    text,
  );

export { editImageNaturalLanguage, editTextNaturalLanguage };

const handlerKindForExecutor = (
  executorId: string,
): CapabilityIngressHandlerKind => {
  if (executorId === 'workflow.create_project@1') return 'project';
  if (
    executorId === 'workflow.create_blog@1' ||
    executorId === 'workflow.create_blog_orbitype@1'
  )
    return 'blog';
  if (executorId === 'workflow.delete_blog@1') return 'delete_blog';
  if (executorId === 'workflow.delete_project@1') return 'delete_project';
  if (executorId === 'workflow.update_menu@1') return 'update_menu';
  if (executorId === 'workflow.edit_text@1') return 'edit_text';
  if (executorId === 'workflow.edit_image@1') return 'edit_image';
  throw new Error(`Unsupported ingress executor ${executorId}.`);
};

const naturalLanguageForCapability = (
  capabilityId: string,
): ((text: string) => boolean) | undefined => {
  if (
    capabilityId === 'create_blog_draft' ||
    capabilityId === 'create_blog_orbitype'
  )
    return blogNaturalLanguage;
  if (capabilityId === 'delete_blog_draft') return deleteBlogNaturalLanguage;
  if (capabilityId === 'delete_project_astro') return deleteProjectNaturalLanguage;
  if (capabilityId === 'create_project_astro') return matchesNaturalProject;
  if (capabilityId === 'update_menu') return updateMenuNaturalLanguage;
  if (capabilityId === 'edit_text') return editTextNaturalLanguage;
  if (capabilityId === 'edit_image') return editImageNaturalLanguage;
  return undefined;
};

export const capabilityIngressRoutes: readonly CapabilityIngressRoute[] =
  Object.freeze(
    capabilityRegistry.map((definition) => {
      const naturalLanguage = naturalLanguageForCapability(definition.id);
      return Object.freeze({
        capabilityId: definition.id,
        command: definition.command,
        commandPattern: new RegExp(
          `^${escapeCommand(definition.command)}(?:@\\w+)?(?:\\s+([\\s\\S]+))?$`,
          'u',
        ),
        handlerKind: handlerKindForExecutor(definition.executorId),
        ...(naturalLanguage === undefined ? {} : { naturalLanguage }),
      });
    }),
  );

export const collectionCapabilityIds = Object.freeze(
  new Set([
    'create_project_astro',
    'delete_blog_draft',
    'delete_project_astro',
    'edit_image',
    'edit_text',
    'update_menu',
  ]),
);
