import { strFromU8, Unzip, UnzipInflate } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { SakaiResource } from '@/types/sakai';

export const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
export type DocumentKind = 'pdf' | 'docx' | 'odt' | 'pptx' | 'text' | 'unsupported';
export type DocumentBlock = { kind: 'heading' | 'paragraph' | 'table'; text: string };

export function documentKind(resource: SakaiResource): DocumentKind {
  const type = resource.contentType?.toLowerCase() ?? '';
  const extension = resource.remotePath.split('.').pop()?.toLowerCase();
  if (type === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (type.includes('wordprocessingml') || extension === 'docx') return 'docx';
  if (type.includes('opendocument.text') || extension === 'odt') return 'odt';
  if (type.includes('presentationml') || extension === 'pptx') return 'pptx';
  if (type === 'text/plain' || ['txt', 'md', 'csv'].includes(extension ?? '')) return 'text';
  return 'unsupported';
}

type XmlNode = Record<string, unknown>;
const nodes = (value: unknown): XmlNode[] => Array.isArray(value) ? value : [];

export function readOfficeDocument(bytes: Uint8Array, kind: DocumentKind): DocumentBlock[] {
  if (bytes.byteLength > MAX_PREVIEW_BYTES) throw new Error('El archivo supera el limite de 32 MB del visor. Abre el original.');
  if (kind === 'text') {
    const text = strFromU8(bytes);
    if (text.length > 2_000_000) throw new Error('El texto es demasiado grande para esta vista.');
    return text.split(/\n\s*\n/).map((text) => ({ kind: 'paragraph', text }));
  }
  if (!['docx', 'odt', 'pptx'].includes(kind)) throw new Error('Formato no compatible con la vista de lectura.');
  let expandedSize = 0;
  let entries = 0;
  const files: Record<string, Uint8Array> = Object.create(null);
  const selected = new Set<string>();
  const archive = new Unzip((file) => {
    if (++entries > 4000) throw new Error('El documento contiene demasiados elementos.');
    const wanted = file.name === 'META-INF/manifest.xml' ||
      (kind === 'docx' && file.name === 'word/document.xml') ||
      (kind === 'odt' && file.name === 'content.xml') ||
      (kind === 'pptx' && (/^ppt\/slides\/[^/]+\.xml$/.test(file.name) || ['ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels'].includes(file.name)));
    if (!wanted) return;
    if (selected.has(file.name)) throw new Error('El documento contiene entradas duplicadas.');
    selected.add(file.name);
    if ((file.originalSize ?? 0) > 4 * 1024 * 1024) {
      throw new Error('El contenido descomprimido supera el limite del visor.');
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      size += chunk.length;
      expandedSize += chunk.length;
      if (size > 4 * 1024 * 1024 || expandedSize > 12 * 1024 * 1024) {
        file.terminate();
        throw new Error('El contenido descomprimido supera el limite del visor.');
      }
      chunks.push(chunk.slice());
      if (final) {
        const content = new Uint8Array(size);
        let offset = 0;
        for (const part of chunks) { content.set(part, offset); offset += part.length; }
        files[file.name] = content;
      }
    };
    file.start();
  });
  archive.register(UnzipInflate);
  // Small input chunks bound expansion before checking the actual decoded byte count.
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    archive.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  }
  const manifest = files['META-INF/manifest.xml'];
  if (manifest && /encryption-data/i.test(strFromU8(manifest))) throw new Error('El documento esta cifrado. Abre el original.');
  let names = Object.keys(files).filter((name) => ['word/document.xml', 'content.xml'].includes(name) || /^ppt\/slides\/[^/]+\.xml$/.test(name));
  if (!names.length) throw new Error('No se encontro contenido legible en el documento.');
  const blocks: DocumentBlock[] = [];
  let characters = 0;
  let textBudget = 2_000_000;
  const consume = (length: number) => {
    textBudget -= length;
    if (textBudget < 0) throw new Error('El documento es demasiado grande para esta vista.');
  };
  const append = (text: string, kind: DocumentBlock['kind']) => {
    if (!text.trim()) return;
    characters += text.length;
    if (characters > 2_000_000 || blocks.length >= 5000) throw new Error('El documento es demasiado grande para esta vista.');
    blocks.push({ text: text.trim(), kind });
  };
  const textOf = (children: XmlNode[], depth = 0): string => {
    if (depth > 64) throw new Error('Estructura de documento demasiado profunda.');
    return children.map((node) => Object.entries(node).map(([tag, value]) => {
      if (tag === '#text') { const text = String(value); consume(text.length); return text; }
      if (tag === ':@' || tag.endsWith('Pr')) return '';
      if (tag === 'text:s') {
        const count = Number((node[':@'] as Record<string, string> | undefined)?.['text:c'] ?? 1);
        const spaces = Math.max(1, Math.min(Number.isFinite(count) ? count : 1, 1000));
        consume(spaces);
        return ' '.repeat(spaces);
      }
      if (['w:tab', 'text:tab'].includes(tag)) return '\t';
      if (['w:br', 'text:line-break'].includes(tag)) return '\n';
      return textOf(nodes(value), depth + 1) + (['w:p', 'text:p'].includes(tag) ? '\n' : '');
    }).join('')).join('');
  };
  const visit = (children: XmlNode[], depth = 0) => {
    if (depth > 64) throw new Error('Estructura de documento demasiado profunda.');
    for (const node of children) for (const [tag, value] of Object.entries(node)) {
      if (['w:p', 'text:p', 'text:h', 'a:p'].includes(tag)) {
        append(textOf(nodes(value)), tag === 'text:h' ? 'heading' : 'paragraph');
      } else if (tag === 'w:tbl' || tag === 'table:table') {
        append(textOf(nodes(value)), 'table');
      } else if (tag !== ':@') visit(nodes(value), depth + 1);
    }
  };
  const parseXml = (name: string): XmlNode[] => {
    if (!files[name]) throw new Error('Falta una parte necesaria del documento.');
    const xml = strFromU8(files[name]);
    if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('El documento contiene XML no permitido o no valido.');
    const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', trimValues: false, parseTagValue: false, ignoreDeclaration: true });
    return nodes(parser.parse(xml));
  };
  if (kind === 'pptx') {
    const find = (children: XmlNode[], name: string): XmlNode[] => {
      const found: XmlNode[] = [];
      const queue = [...children].reverse();
      while (queue.length) {
        const node = queue.pop()!;
        for (const [tag, value] of Object.entries(node)) {
          if (tag.split(':').pop() === name) found.push(node);
          else if (tag !== ':@') queue.push(...nodes(value).slice().reverse());
        }
      }
      return found;
    };
    const relations = new Map(find(parseXml('ppt/_rels/presentation.xml.rels'), 'Relationship').map((node) => {
      const attributes = node[':@'] as Record<string, string>;
      return [attributes.Id, attributes];
    }));
    names = find(parseXml('ppt/presentation.xml'), 'sldId')
      .filter((node) => typeof (node[':@'] as Record<string, string> | undefined)?.['r:id'] === 'string')
      .map((node) => {
      const id = (node[':@'] as Record<string, string>)['r:id'];
      const relation = relations.get(id);
      if (!relation || relation.TargetMode === 'External') throw new Error('Relacion de diapositiva no valida.');
      const target = new URL(relation.Target, 'https://preview.invalid/ppt/');
      const name = decodeURIComponent(target.pathname.slice(1));
      if (target.origin !== 'https://preview.invalid' || !/^ppt\/slides\/[^/]+\.xml$/.test(name) || !files[name]) throw new Error('Diapositiva no disponible en el archivo.');
      return name;
    });
  }
  for (const [index, name] of names.entries()) {
    if (kind === 'pptx') append(`Diapositiva ${index + 1}`, 'heading');
    visit(parseXml(name));
  }
  if (!blocks.length) throw new Error('No hay texto para esta vista. El contenido puede estar compuesto por imagenes.');
  return blocks;
}
