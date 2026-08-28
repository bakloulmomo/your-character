/** Formatta un conteggio come fa character.ai: 1420 → "1.4k". */
export function formatCount(value?: number): string {
  const n = value ?? 0;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace('.0', '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
}

/** Iniziali usate come avatar di ripiego quando l'immagine non carica. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Colore stabile derivato dal nome, per gli avatar di ripiego. */
export function tintFor(seed: string): string {
  const palette = ['#2563EB', '#7C3AED', '#0891B2', '#059669', '#D97706', '#DC2626'];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

const RELATIVE = new Intl.RelativeTimeFormat('it', { numeric: 'auto' });

/** "3 minuti fa", "ieri", … */
export function relativeTime(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const minutes = Math.round(diffMs / 60000);
  if (Math.abs(minutes) < 60) return RELATIVE.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return RELATIVE.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return RELATIVE.format(days, 'day');
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Raggruppa le chat per fascia temporale, come la cronologia di character.ai. */
export function groupByRecency<T extends { lastMessageAt: string }>(items: T[]) {
  const now = Date.now();
  const day = 86_400_000;
  const groups: { label: string; items: T[] }[] = [
    { label: 'Oggi', items: [] },
    { label: 'Ieri', items: [] },
    { label: 'Ultimi 7 giorni', items: [] },
    { label: 'Precedenti', items: [] }
  ];

  for (const item of items) {
    const age = now - new Date(item.lastMessageAt).getTime();
    if (age < day) groups[0].items.push(item);
    else if (age < 2 * day) groups[1].items.push(item);
    else if (age < 7 * day) groups[2].items.push(item);
    else groups[3].items.push(item);
  }

  return groups.filter((g) => g.items.length > 0);
}

/**
 * Rende il testo di un messaggio: preserva gli a-capo e mette in corsivo le
 * *azioni narrative* fra asterischi — la convenzione centrale del roleplay che
 * prima veniva mostrata come asterischi letterali su una riga sola.
 */
export function parseMessage(content: string): Array<{ text: string; italic: boolean }> {
  const parts: Array<{ text: string; italic: boolean }> = [];
  const pattern = /\*([^*\n]+)\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > cursor) {
      parts.push({ text: content.slice(cursor, match.index), italic: false });
    }
    parts.push({ text: match[1], italic: true });
    cursor = match.index + match[0].length;
  }

  if (cursor < content.length) {
    parts.push({ text: content.slice(cursor), italic: false });
  }

  return parts.length > 0 ? parts : [{ text: content, italic: false }];
}
