import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { documentKind, readOfficeDocument } from '../src/lib/document-reader.ts';

test('detects formats using MIME type even when the display name has no extension', () => {
  expect(documentKind({ remotePath: 'notes', contentType: 'application/pdf' })).toBe('pdf');
  expect(documentKind({ remotePath: 'notes.docx' })).toBe('docx');
  expect(documentKind({ remotePath: 'notes.odt' })).toBe('odt');
  expect(documentKind({ remotePath: 'slides.pptx' })).toBe('pptx');
});

test('reads DOCX paragraphs and line breaks locally', () => {
  const bytes = zipSync({ 'word/document.xml': strToU8('<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Hello &amp; world</w:t><w:br/><w:t>Second line</w:t></w:r></w:p></w:body></w:document>') });
  expect(readOfficeDocument(bytes, 'docx')).toEqual([{ kind: 'paragraph', text: 'Hello & world\nSecond line' }]);
});

test('reads ODT headings, spaces and paragraphs without interpreting HTML', () => {
  const bytes = zipSync({ 'content.xml': strToU8('<office:document-content xmlns:office="urn:office" xmlns:text="urn:text"><office:body><office:text><text:h>Title</text:h><text:p>Hello<text:s text:c="2"/>world &lt;script&gt;</text:p></office:text></office:body></office:document-content>') });
  expect(readOfficeDocument(bytes, 'odt')).toEqual([{ kind: 'heading', text: 'Title' }, { kind: 'paragraph', text: 'Hello  world <script>' }]);
});

test('uses the actual presentation order rather than slide filenames', () => {
  const slide = (text) => strToU8(`<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`);
  const bytes = zipSync({
    'ppt/slides/slide10.xml': slide('Ten'), 'ppt/slides/slide2.xml': slide('Two'),
    'ppt/presentation.xml': strToU8('<p:presentation xmlns:p="urn:p" xmlns:r="urn:r" xmlns:p14="urn:p14"><p:sldIdLst><p:sldId r:id="first"/><p:sldId r:id="second"/></p:sldIdLst><p:extLst><p14:section><p14:sldId id="256"/></p14:section></p:extLst></p:presentation>'),
    'ppt/_rels/presentation.xml.rels': strToU8('<Relationships><Relationship Id="first" Target="slides/slide10.xml"/><Relationship Id="second" Target="slides/slide2.xml"/></Relationships>'),
  });
  expect(readOfficeDocument(bytes, 'pptx').filter((block) => block.kind === 'paragraph').map((block) => block.text)).toEqual(['Ten', 'Two']);
});

test('enforces the actual expansion limit even when ZIP metadata lies', () => {
  const bytes = zipSync({ 'content.xml': strToU8(`<p>${'a'.repeat(4 * 1024 * 1024 + 1)}</p>`) });
  new DataView(bytes.buffer, bytes.byteOffset).setUint32(22, 1, true);
  expect(() => readOfficeDocument(bytes, 'odt')).toThrow('descomprimido');
});

test('bounds ODT space expansion before constructing an oversized paragraph', () => {
  const bytes = zipSync({ 'content.xml': strToU8(`<text:p xmlns:text="urn:text">${'<text:s text:c="1000"/>'.repeat(2100)}</text:p>`) });
  expect(() => readOfficeDocument(bytes, 'odt')).toThrow('demasiado grande');
});

test('rejects XML entities, encrypted packages and oversized decompressed content', () => {
  expect(() => readOfficeDocument(zipSync({ 'content.xml': strToU8('<!DOCTYPE x [<!ENTITY x "test">]><x>&x;</x>') }), 'odt')).toThrow('XML');
  expect(() => readOfficeDocument(zipSync({ 'content.xml': strToU8('<x/>'), 'META-INF/manifest.xml': strToU8('<manifest:encryption-data/>') }), 'odt')).toThrow('cifrado');
  expect(() => readOfficeDocument(zipSync({ 'content.xml': new Uint8Array(4 * 1024 * 1024 + 1) }), 'odt')).toThrow('descomprimido');
});
