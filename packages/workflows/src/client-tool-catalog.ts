import type { SupportedLocale } from '@binflow/contracts';
import { capabilityRegistry } from '@binflow/policies';

export type ClientToolCatalogEntry = Readonly<{
  capabilityId: string;
  command: string;
  detail: Readonly<Record<SupportedLocale, string>>;
  startHint: Readonly<Record<SupportedLocale, string>>;
  summary: Readonly<Record<SupportedLocale, string>>;
  title: Readonly<Record<SupportedLocale, string>>;
}>;

const entry = (
  capabilityId: string,
  command: string,
  title: Record<SupportedLocale, string>,
  summary: Record<SupportedLocale, string>,
  startHint: Record<SupportedLocale, string>,
  detail: Record<SupportedLocale, string>,
): ClientToolCatalogEntry =>
  Object.freeze({
    capabilityId,
    command,
    detail: Object.freeze(detail),
    startHint: Object.freeze(startHint),
    summary: Object.freeze(summary),
    title: Object.freeze(title),
  });

/** Code-owned client-facing tool copy (ADR-0054). */
export const clientToolCatalog: readonly ClientToolCatalogEntry[] =
  Object.freeze([
    entry(
      'create_blog_draft',
      '/create_blog',
      {
        de: 'Blogbeitrag erstellen',
        en: 'Create blog post',
        es: 'Crear artículo de blog',
      },
      {
        de: 'Erstellt einen zweisprachigen Blogbeitrag mit Vorschau vor der Veröffentlichung.',
        en: 'Creates a bilingual blog post with a preview before publishing.',
        es: 'Crea un artículo de blog bilingüe con vista previa antes de publicar.',
      },
      {
        de: 'Starte mit /create_blog <Thema> oder schreibe „Blog über …“.',
        en: 'Start with /create_blog <topic> or say “blog about …”.',
        es: 'Empieza con /create_blog <tema> o di “blog sobre …”.',
      },
      {
        de: 'Was es macht: Plant und erzeugt einen Blogbeitrag, zeigt eine Vorschau und veröffentlicht erst nach deiner Freigabe (und ggf. Admin).\nWas es nicht macht: Keine Menü-PDFs, keine Seitenbilder und keinen Portfolio-Eintrag.\nAblauf: Thema bestätigen → Entwurf → Vorschau → Freigabe → Veröffentlichung.\nBeispiel: /create_blog KI für kleine Restaurants',
        en: 'What it does: Plans and writes a blog post, shows a preview, and publishes only after your approval (and admin when required).\nWhat it does not do: Menu PDFs, page images, or portfolio projects.\nFlow: confirm topic → draft → preview → approve → publish.\nExample: /create_blog AI tips for small restaurants',
        es: 'Qué hace: Planifica y redacta un artículo, muestra vista previa y publica solo tras tu aprobación (y admin si aplica).\nQué no hace: PDFs de menú, imágenes de página ni proyectos de portafolio.\nFlujo: confirmar tema → borrador → preview → aprobar → publicar.\nEjemplo: /create_blog tips de IA para restaurantes',
      },
    ),
    entry(
      'create_blog_orbitype',
      '/create_blog',
      {
        de: 'Blogbeitrag erstellen',
        en: 'Create blog post',
        es: 'Crear artículo de blog',
      },
      {
        de: 'Erstellt einen Blogbeitrag (GitHub + CMS) mit Vorschau vor der Veröffentlichung.',
        en: 'Creates a blog post (GitHub + CMS) with a preview before publishing.',
        es: 'Crea un artículo de blog (GitHub + CMS) con vista previa antes de publicar.',
      },
      {
        de: 'Starte mit /create_blog <Thema> oder schreibe „Blog über …“.',
        en: 'Start with /create_blog <topic> or say “blog about …”.',
        es: 'Empieza con /create_blog <tema> o di “blog sobre …”.',
      },
      {
        de: 'Was es macht: Erzeugt den Beitrag und schreibt parallel nach GitHub und CMS; Vorschau vor Veröffentlichung.\nWas es nicht macht: Keine Menü-Updates und keine Text-/Bildbearbeitung bestehender Seiten.\nAblauf: Thema → Entwurf → Vorschau → Freigabe → Merge/Publish.\nBeispiel: /create_blog Saisonale Speisekarte erklären',
        en: 'What it does: Creates the post and dual-writes GitHub plus CMS; preview before publish.\nWhat it does not do: Menu updates or editing existing page text/images.\nFlow: topic → draft → preview → approve → merge/publish.\nExample: /create_blog explain the seasonal menu',
        es: 'Qué hace: Crea el artículo y escribe en GitHub y CMS; preview antes de publicar.\nQué no hace: Actualizar menús ni editar texto/imagen de páginas existentes.\nFlujo: tema → borrador → preview → aprobar → merge/publish.\nEjemplo: /create_blog explicar el menú de temporada',
      },
    ),
    entry(
      'create_project_astro',
      '/create_project',
      {
        de: 'Portfolio-Projekt anlegen',
        en: 'Create portfolio project',
        es: 'Crear proyecto de portafolio',
      },
      {
        de: 'Legt eine neue zweisprachige Portfolio-Fallstudie an.',
        en: 'Creates a new bilingual portfolio case study.',
        es: 'Crea un nuevo caso de estudio de portafolio bilingüe.',
      },
      {
        de: 'Starte mit /create_project <Kurzbrief> oder schreibe „neues Projekt …“.',
        en: 'Start with /create_project <brief> or say “new project …”.',
        es: 'Empieza con /create_project <brief> o di “nuevo proyecto …”.',
      },
      {
        de: 'Was es macht: Sammelt Projektdaten, erzeugt die Fallstudie und zeigt eine Vorschau vor Veröffentlichung.\nWas es nicht macht: Keine Blogposts und keine Menü-PDFs.\nAblauf: fehlende Fakten nachreichen → Plan bestätigen → Vorschau → Freigabe.\nBeispiel: /create_project Buchungsplattform für Sprachkurse',
        en: 'What it does: Collects project facts, generates the case study, and shows a preview before publish.\nWhat it does not do: Blog posts or menu PDFs.\nFlow: supply missing facts → confirm plan → preview → approve.\nExample: /create_project booking platform for language courses',
        es: 'Qué hace: Reúne datos del proyecto, genera el caso y muestra preview antes de publicar.\nQué no hace: Artículos de blog ni PDFs de menú.\nFlujo: completar datos → confirmar plan → preview → aprobar.\nEjemplo: /create_project plataforma de reservas para cursos',
      },
    ),
    entry(
      'delete_blog_draft',
      '/delete_blog',
      {
        de: 'Blogbeitrag löschen',
        en: 'Delete blog post',
        es: 'Eliminar artículo de blog',
      },
      {
        de: 'Entfernt einen bestehenden Blogbeitrag nach Bestätigung.',
        en: 'Removes an existing blog post after confirmation.',
        es: 'Elimina un artículo de blog existente tras confirmar.',
      },
      {
        de: 'Starte mit /delete_blog oder nenne den Beitragstitel/URL.',
        en: 'Start with /delete_blog or name the post title/URL.',
        es: 'Empieza con /delete_blog o indica el título/URL del artículo.',
      },
      {
        de: 'Was es macht: Findet den Beitrag, zeigt den Löschplan und entfernt ihn erst nach Freigabe.\nWas es nicht macht: Keine Portfolio-Projekte und keine Seiten-Texte.\nAblauf: Ziel wählen → Plan bestätigen → ggf. Admin → Löschung.\nAchtung: destruktiv; danach ist der Beitrag weg.',
        en: 'What it does: Finds the post, shows a delete plan, and removes it only after approval.\nWhat it does not do: Portfolio projects or page copy.\nFlow: pick target → confirm plan → admin if required → delete.\nWarning: destructive; the post is gone afterward.',
        es: 'Qué hace: Encuentra el artículo, muestra el plan de borrado y lo elimina solo tras aprobación.\nQué no hace: Proyectos de portafolio ni textos de página.\nFlujo: elegir destino → confirmar plan → admin si aplica → borrar.\nAtención: es destructivo; el artículo desaparece.',
      },
    ),
    entry(
      'delete_project_astro',
      '/delete_project',
      {
        de: 'Portfolio-Projekt löschen',
        en: 'Delete portfolio project',
        es: 'Eliminar proyecto de portafolio',
      },
      {
        de: 'Entfernt ein bestehendes Portfolio-Projekt nach Bestätigung.',
        en: 'Removes an existing portfolio project after confirmation.',
        es: 'Elimina un proyecto de portafolio existente tras confirmar.',
      },
      {
        de: 'Starte mit /delete_project oder nenne Projektname/URL.',
        en: 'Start with /delete_project or name the project/URL.',
        es: 'Empieza con /delete_project o indica el proyecto/URL.',
      },
      {
        de: 'Was es macht: Findet das Projekt, zeigt den Löschplan und entfernt es erst nach Freigabe.\nWas es nicht macht: Keine Blogposts und keine Menü-Dateien.\nAblauf: Ziel wählen → Plan bestätigen → ggf. Admin → Löschung.\nAchtung: destruktiv.',
        en: 'What it does: Finds the project, shows a delete plan, and removes it only after approval.\nWhat it does not do: Blog posts or menu files.\nFlow: pick target → confirm plan → admin if required → delete.\nWarning: destructive.',
        es: 'Qué hace: Encuentra el proyecto, muestra el plan de borrado y lo elimina solo tras aprobación.\nQué no hace: Artículos de blog ni archivos de menú.\nFlujo: elegir destino → confirmar plan → admin si aplica → borrar.\nAtención: es destructivo.',
      },
    ),
    entry(
      'edit_text',
      '/edit_text',
      {
        de: 'Seitentext ändern',
        en: 'Edit page text',
        es: 'Editar texto de página',
      },
      {
        de: 'Ersetzt eine erlaubte Textstelle wortgetreu und zeigt vorher eine Vorschau.',
        en: 'Replaces one allowed text spot literally and shows a preview first.',
        es: 'Sustituye un texto permitido de forma literal y muestra preview antes.',
      },
      {
        de: 'Starte mit /edit_text oder schreibe „Text ändern …“.',
        en: 'Start with /edit_text or say “edit text …”.',
        es: 'Empieza con /edit_text o di “cambiar texto …”.',
      },
      {
        de: 'Was es macht: Sucht eine Textstelle, ersetzt sie 1:1, Vorschau, dann deine und Admin-Freigabe.\nWas es nicht macht: Keine Stiländerungen (Größe/Farbe) und keine Bildwechsel.\nGrenzen: eine Stelle pro Anfrage; H1/CTA/Nav sind gesperrt.\nBeispiel: „Ändere den Absatz über Öffnungszeiten“',
        en: 'What it does: Finds one text spot, replaces it literally, preview, then your approval and admin.\nWhat it does not do: Style changes (size/color) or image swaps.\nLimits: one spot per request; H1/CTA/nav blocked.\nExample: “Change the paragraph about opening hours”',
        es: 'Qué hace: Busca un texto, lo sustituye literalmente, preview, luego tu aprobación y admin.\nQué no hace: Cambiar estilo (tamaño/color) ni imágenes.\nLímites: un texto por solicitud; H1/CTA/nav bloqueados.\nEjemplo: “Cambia el párrafo de horarios”',
      },
    ),
    entry(
      'edit_text_style',
      '/edit_text_style',
      {
        de: 'Textstil ändern',
        en: 'Edit text style',
        es: 'Cambiar estilo del texto',
      },
      {
        de: 'Ändert Gewicht, Größe oder Farbe — der Wortlaut bleibt gleich.',
        en: 'Changes weight, size, or color — the wording stays the same.',
        es: 'Cambia peso, tamaño o color — el texto no se reescribe.',
      },
      {
        de: 'Starte mit /edit_text_style oder schreibe „Schriftgröße / Farbe …“.',
        en: 'Start with /edit_text_style or say “make this text bold / larger …”.',
        es: 'Empieza con /edit_text_style o di “más grande / negrita / color …”.',
      },
      {
        de: 'Was es macht: Wählt eine Textstelle und stellt Gewicht/Größe/Farbe ein; Vorschau + Freigaben.\nWas es nicht macht: Keinen neuen Wortlaut und keine Bilder.\nGrenzen: eine Feldart pro Anfrage; HEX maximal zwei Fehlversuche.\nBeispiel: „Mach die Unterüberschrift fetter und dunkler“',
        en: 'What it does: Picks a text spot and sets weight/size/color; preview + approvals.\nWhat it does not do: Rewriting copy or changing images.\nLimits: one field kind per request; HEX at most two retries.\nExample: “Make the subtitle bolder and darker”',
        es: 'Qué hace: Elige un texto y ajusta peso/tamaño/color; preview + aprobaciones.\nQué no hace: Reescribir el copy ni cambiar imágenes.\nLímites: un tipo de campo por solicitud; HEX máximo dos reintentos.\nEjemplo: “Haz el subtítulo más negrita y más oscuro”',
      },
    ),
    entry(
      'edit_image',
      '/edit_image',
      {
        de: 'Bild ersetzen',
        en: 'Replace site image',
        es: 'Cambiar imagen del sitio',
      },
      {
        de: 'Ersetzt ein erlaubtes Seiten- oder Blogbild und zeigt eine Vorschau.',
        en: 'Replaces an allowed page or blog image and shows a preview.',
        es: 'Reemplaza una imagen permitida de página o blog y muestra preview.',
      },
      {
        de: 'Starte mit /edit_image oder schreibe „Bild ändern …“.',
        en: 'Start with /edit_image or say “change image …”.',
        es: 'Empieza con /edit_image o di “cambiar imagen …”.',
      },
      {
        de: 'Was es macht: Findet einen Bildplatz, zeigt das aktuelle Bild, nimmt Ersatzfoto/URL, Vorschau + Freigaben.\nWas es nicht macht: Keine Logos/Seiten-Heroes und keinen Text.\nGrenzen: ein Bildplatz pro Anfrage; alle Sprachen erhalten dasselbe Asset.\nBeispiel: „Ändere das Cover des letzten Blogposts“',
        en: 'What it does: Finds an image slot, shows the current photo, takes a replacement photo/URL, preview + approvals.\nWhat it does not do: Logos/page heroes or text edits.\nLimits: one slot per request; all locales get the same asset.\nExample: “Change the cover of the latest blog post”',
        es: 'Qué hace: Encuentra un hueco de imagen, muestra la actual, recibe foto/URL de reemplazo, preview + aprobaciones.\nQué no hace: Logos/heroes de página ni editar texto.\nLímites: un hueco por solicitud; todos los idiomas reciben el mismo asset.\nEjemplo: “Cambia la portada del último post”',
      },
    ),
    entry(
      'update_menu',
      '/update_menu',
      {
        de: 'Speisekarte aktualisieren',
        en: 'Update menu',
        es: 'Actualizar menú',
      },
      {
        de: 'Aktualisiert Menü-PDFs und sichtbare Menü-CTAs.',
        en: 'Updates menu PDFs and visible menu CTAs.',
        es: 'Actualiza PDFs del menú y CTAs visibles del menú.',
      },
      {
        de: 'Starte mit /update_menu oder schreibe „Menü aktualisieren“.',
        en: 'Start with /update_menu or say “update menu”.',
        es: 'Empieza con /update_menu o di “actualizar menú”.',
      },
      {
        de: 'Was es macht: Nimmt ein neues PDF und/oder schaltet Menü-Buttons um; veröffentlicht nach Bestätigung.\nWas es nicht macht: Keine Blogposts und keine freie Seitenbearbeitung.\nAblauf: PDF/CTAs wählen → Plan bestätigen → Veröffentlichung (ohne Vorschau-Schritt wie bei Text).\nBeispiel: Lade die neue Speisekarte als PDF.',
        en: 'What it does: Accepts a new PDF and/or toggles menu buttons; publishes after confirmation.\nWhat it does not do: Blog posts or free-form page editing.\nFlow: choose PDF/CTAs → confirm plan → publish (no text-style preview step).\nExample: Upload the new menu PDF.',
        es: 'Qué hace: Recibe un PDF nuevo y/o activa CTAs del menú; publica tras confirmar.\nQué no hace: Artículos de blog ni edición libre de páginas.\nFlujo: elegir PDF/CTAs → confirmar plan → publicar (sin el paso de preview de texto).\nEjemplo: Sube el PDF nuevo de la carta.',
      },
    ),
  ]);

const normalize = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/^\/+/u, '')
    .replace(/[^a-z0-9_\s-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

export const catalogEntryByCapabilityId = (
  capabilityId: string,
): ClientToolCatalogEntry | undefined =>
  clientToolCatalog.find((item) => item.capabilityId === capabilityId);

export const resolveClientToolCatalogEntry = (
  query: string,
  enabledIds: ReadonlySet<string>,
): ClientToolCatalogEntry | undefined => {
  const needle = normalize(query);
  if (needle.length === 0) return undefined;
  const enabled = clientToolCatalog.filter((item) =>
    enabledIds.has(item.capabilityId),
  );
  const byId = enabled.find((item) => item.capabilityId === needle);
  if (byId !== undefined) return byId;
  const byCommand = enabled.find(
    (item) => normalize(item.command) === needle || item.command === `/${needle}`,
  );
  if (byCommand !== undefined) return byCommand;
  return enabled.find((item) =>
    (['de', 'en', 'es'] as const).some(
      (locale) => normalize(item.title[locale]) === needle,
    ),
  );
};

export const formatToolsListMessage = (
  locale: SupportedLocale,
  enabled: ReadonlyArray<
    Readonly<{ command: string; displayName: string; id: string }>
  >,
): string => {
  const heading =
    locale === 'es'
      ? 'Tools disponibles:'
      : locale === 'de'
        ? 'Verfügbare Tools:'
        : 'Available tools:';
  const footer =
    locale === 'es'
      ? 'Más detalle de una tool: /info edit_text'
      : locale === 'de'
        ? 'Mehr Details zu einem Tool: /info edit_text'
        : 'More detail on a tool: /info edit_text';
  const lines = enabled.map(
    (item) => `${item.command} — ${item.displayName}`,
  );
  const openTicketLine =
    locale === 'es'
      ? '/open_ticket — Petición personalizada (ticket al admin)'
      : locale === 'de'
        ? '/open_ticket — Individuelle Anfrage (Ticket an Admin)'
        : '/open_ticket — Custom request (ticket to admin)';
  return `${heading}\n${lines.join('\n')}\n${openTicketLine}\n\n${footer}`;
};

export const formatInfoChooserMessage = (
  locale: SupportedLocale,
  enabled: ReadonlyArray<Readonly<{ id: string; command: string }>>,
): string => {
  const intro =
    locale === 'es'
      ? 'Elige una tool para ver su alcance. Ejemplo: /info edit_text'
      : locale === 'de'
        ? 'Wähle ein Tool für Details. Beispiel: /info edit_text'
        : 'Pick a tool to see its scope. Example: /info edit_text';
  const lines = enabled.map((item) => {
    const entry = catalogEntryByCapabilityId(item.id);
    if (entry === undefined) return `• ${item.command}`;
    return `• ${entry.title[locale]} — /info ${entry.command.replace(/^\//u, '')}`;
  });
  return `${intro}\n\n${lines.join('\n')}`;
};

export const formatInfoDetailMessage = (
  locale: SupportedLocale,
  entry: ClientToolCatalogEntry,
): string => {
  const label =
    locale === 'es' ? 'Comando' : locale === 'de' ? 'Befehl' : 'Command';
  return `${entry.title[locale]}\n${label}: ${entry.command}\n\n${entry.summary[locale]}\n\n${entry.detail[locale]}\n\n${entry.startHint[locale]}`;
};

export const formatInfoMissMessage = (locale: SupportedLocale): string =>
  locale === 'es'
    ? 'No encontré esa tool en tu proyecto. Usa /tools para ver las disponibles.'
    : locale === 'de'
      ? 'Dieses Tool ist für dein Projekt nicht verfügbar. Nutze /tools für die Liste.'
      : 'That tool is not available on your project. Use /tools to see what you have.';

/** Meta + enabled capability commands for Telegram setMyCommands. */
export const buildTelegramClientCommands = (
  locale: SupportedLocale,
  enabledCapabilityIds: ReadonlyArray<string>,
): ReadonlyArray<Readonly<{ command: string; description: string }>> => {
  const enabled = new Set(enabledCapabilityIds);
  const capabilityCommands = clientToolCatalog
    .filter((item) => enabled.has(item.capabilityId))
    .map((item) => ({
      command: item.command,
      description: item.summary[locale].slice(0, 256),
    }));
  const seen = new Set<string>();
  const deduped = capabilityCommands.filter((item) => {
    if (seen.has(item.command)) return false;
    seen.add(item.command);
    return true;
  });
  const meta: ReadonlyArray<Readonly<{ command: string; description: string }>> =
    locale === 'es'
      ? [
          { command: '/tools', description: 'Ver herramientas disponibles' },
          { command: '/info', description: 'Detalle y alcance de una tool' },
          { command: '/help', description: 'Cómo usar el bot' },
          { command: '/status', description: 'Estado de tu última solicitud' },
          { command: '/cancel', description: 'Cancelar la solicitud activa' },
        ]
      : locale === 'de'
        ? [
            { command: '/tools', description: 'Verfügbare Tools anzeigen' },
            { command: '/info', description: 'Details und Umfang eines Tools' },
            { command: '/help', description: 'Hilfe zur Bot-Nutzung' },
            { command: '/status', description: 'Status der letzten Anfrage' },
            { command: '/cancel', description: 'Aktive Anfrage abbrechen' },
          ]
        : [
            { command: '/tools', description: 'List available tools' },
            { command: '/info', description: 'Tool detail and scope' },
            { command: '/help', description: 'How to use the bot' },
            { command: '/status', description: 'Status of your latest request' },
            { command: '/cancel', description: 'Cancel the active request' },
          ];
  return [...meta, ...deduped];
};

export const assertClientToolCatalogComplete = (): void => {
  const catalogIds = new Set(
    clientToolCatalog.map((item) => item.capabilityId),
  );
  for (const definition of capabilityRegistry) {
    if (!catalogIds.has(definition.id))
      throw new Error(
        `Missing client tool catalog copy for capability ${definition.id}`,
      );
  }
};
