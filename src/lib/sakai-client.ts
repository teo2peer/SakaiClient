import { SAKAI_BASE_URL } from '@/lib/constants';
import { sakaiFetch } from '@/lib/network';
import { decodeHtml } from '@/lib/text';
import type {
  SakaiAnnouncement,
  SakaiCourse,
  SakaiResource,
  SakaiSession,
} from '@/types/sakai';

type UnknownRecord = Record<string, unknown>;

export class SakaiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SakaiError';
  }
}

export class SakaiClient {
  private sessionId?: string;
  private resourceRequests = new Map<string, Promise<SakaiResource[]>>();

  constructor(
    readonly baseUrl = SAKAI_BASE_URL,
    sessionId?: string,
  ) {
    this.sessionId = sessionId;
  }

  get currentSessionId(): string | undefined {
    return this.sessionId;
  }

  async login(username: string, password: string, signal?: AbortSignal): Promise<SakaiSession> {
    console.info('Sakai login: started');
    const identifier = username.trim();
    const body = new URLSearchParams({
      _username: identifier,
      _password: password,
    }).toString();
    const response = await sakaiFetch(`${this.baseUrl}/direct/session`, {
      signal,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      credentials: 'include',
    });
    console.info(`Sakai login: direct status=${response.status}`);

    const loginTrace: string[] = [];
    if (response.ok) {
      const responseText = await response.text();
      const location = response.headers.get('location');
      const locationId = location?.split('/').filter(Boolean).pop();
      const bodyId = parseSessionId(responseText);
      this.sessionId = locationId ? decodeURIComponent(locationId) : bodyId;
    } else if (response.status === 401 || response.status === 403) {
      await response.text();
      this.sessionId = undefined;
      const loginPage = await this.followLoginRedirects(
        new URL('/portal/login', this.baseUrl).toString(),
        loginTrace,
        undefined,
        signal,
      );
      const form = loginPage.html.match(
        /<form\b[^>]*\bid=["']fm1["'][^>]*>[\s\S]*?<\/form>/i,
      )?.[0];
      if (!form) {
        throw new SakaiError(
          `La UPV no mostro el formulario para verificar las credenciales. Recorrido:\n${loginTrace.join('\n')}`,
        );
      }
      const executionTag = form.match(/<input\b[^>]*\bname=["']execution["'][^>]*>/i)?.[0];
      const execution = executionTag?.match(/\bvalue=["']([^"']*)["']/i)?.[1];
      const formTag = form.match(/<form\b[^>]*>/i)?.[0];
      const formAction = formTag?.match(/\baction=["']([^"']*)["']/i)?.[1];
      let casUrl: URL;
      try {
        casUrl = new URL(decodeHtml(formAction || loginPage.url.toString()), loginPage.url);
      } catch {
        throw new SakaiError('El formulario de acceso de la UPV tiene una URL no valida.');
      }
      if (
        !execution ||
        loginPage.url.origin !== 'https://cas.upv.es' ||
        casUrl.origin !== loginPage.url.origin
      ) {
        throw new SakaiError('El acceso de la UPV ha cambiado y no se pudo iniciar la sesion.');
      }
      if (!casUrl.search) casUrl.search = loginPage.url.search;
      casUrl.searchParams.set('renew', 'true');
      const casPage = await this.followLoginRedirects(
        casUrl.toString(),
        loginTrace,
        new URLSearchParams({
          username: identifier,
          password,
          execution: decodeHtml(execution),
          _eventId: 'submit',
          geolocation: '',
          submitBtn: '',
        }).toString(),
        signal,
      );
      if (/<form\b[^>]*\bid=["']fm1["']/i.test(casPage.html)) {
        console.info('Sakai login: CAS returned the login form');
        throw new SakaiError(
          `CAS volvio a mostrar el formulario sin confirmar el acceso. Recorrido:\n${loginTrace.join('\n')}`,
        );
      }
    } else {
      throw new SakaiError(
        `PoliformaT rechazo el acceso (${response.status}).`,
        response.status,
      );
    }

    const session = await this.getCurrentSession(signal);
    console.info(`Sakai login: authenticated=${Boolean(session?.userId)}`);
    if (!session || !session.userId) {
      throw new SakaiError(
        loginTrace.length
          ? `PoliformaT no devolvio una sesion autenticada. Recorrido:\n${loginTrace.join('\n')}`
          : 'PoliformaT no devolvio una sesion utilizable. Puede que el acceso directo este desactivado.',
      );
    }

    this.sessionId = session.id || this.sessionId;
    return { ...session, id: this.sessionId ?? session.id };
  }

  private async followLoginRedirects(
    target: string,
    trace: string[],
    body?: string,
    signal?: AbortSignal,
  ): Promise<{ url: URL; html: string }> {
    let previousUrl = new URL(this.baseUrl);
    try {
      for (let hop = 0; hop < 12; hop += 1) {
        const url = new URL(target, previousUrl);
        if (
          url.protocol !== 'https:' ||
          url.username || url.password ||
          ![new URL(this.baseUrl).origin, 'https://cas.upv.es'].includes(url.origin)
        ) {
          throw new SakaiError('El acceso intento redirigir fuera de los servidores permitidos.');
        }
        // Explicit credentials must not silently reuse another account's CAS SSO cookie.
        if (body === undefined && url.origin === 'https://cas.upv.es' && url.pathname === '/cas/login') {
          url.searchParams.set('renew', 'true');
        }
        const method = body === undefined ? 'GET' : 'POST';
        // Each hop lets the native cookie store select cookies for the destination host.
        const response = await sakaiFetch(url.toString(), {
          signal,
          method,
          headers: {
            Accept: 'text/html',
            ...(body === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
          },
          body,
          credentials: 'include',
          redirect: 'manual',
        });
        trace.push(
          `${method} ${response.status} ${safeResponseLocation(url.toString())}${
            url.searchParams.has('ticket') ? ' [ticket presente]' : ''
          }`,
        );
        console.info(`Sakai login: ${trace[trace.length - 1]}`);
        const html = await response.text();
        if (![301, 302, 303, 307, 308].includes(response.status)) {
          if (!response.ok) throw new SakaiError(`El acceso de la UPV fallo (${response.status}).`);
          if (/<meta\b[^>]*http-equiv=["']refresh["']/i.test(html)) {
            trace.push('HTML con redireccion meta refresh');
            console.info('Sakai login: HTML meta refresh present');
          }
          return { url, html };
        }
        const location = response.headers.get('location');
        if (!location) throw new SakaiError('El acceso devolvio una redireccion sin destino.');
        const nextUrl = new URL(location, url);
        if (response.status === 301 || response.status === 302 || response.status === 303) {
          body = undefined;
        } else if (body !== undefined && nextUrl.origin !== url.origin) {
          throw new SakaiError('Se bloqueo una redireccion que reenviaba credenciales a otro servidor.');
        }
        target = nextUrl.toString();
        previousUrl = url;
      }
      throw new SakaiError('El acceso supero el limite de redirecciones.');
    } catch (error) {
      const message = error instanceof SakaiError
        ? error.message
        : 'No se pudo completar la navegacion de acceso.';
      console.info(`Sakai login: ${message}`);
      throw new SakaiError(`${message} Recorrido:\n${trace.join('\n')}`);
    }
  }

  async getCurrentSession(signal?: AbortSignal): Promise<SakaiSession | null> {
    // PoliformaT caches this endpoint for 600 seconds without varying on the session cookie.
    const response = await this.request(`/direct/session/current.json?_=${Date.now()}`, {
      allowUnauthorized: true,
      signal,
    });
    if (!response.ok) return null;

    const value = (await response.json()) as UnknownRecord;
    const userId = stringValue(value.userId);
    if (!userId) return null;

    return {
      id: stringValue(value.id) || this.sessionId || '',
      userId,
      userEid: stringValue(value.userEid) || userId,
    };
  }

  async logout(): Promise<void> {
    const response = await this.request(
      this.sessionId ? `/direct/session/${encodeURIComponent(this.sessionId)}` : '/portal/logout',
      {
        method: this.sessionId ? 'DELETE' : 'GET',
        redirect: 'manual',
        allowUnauthorized: true,
      },
    );
    await response.text();
    if (response.status >= 400 && response.status !== 401 && response.status !== 403) {
      throw new SakaiError(`No se pudo cerrar la sesion (${response.status}).`, response.status);
    }
    this.sessionId = undefined;
  }

  async getCourses(signal?: AbortSignal): Promise<SakaiCourse[]> {
    const payload = await this.getJson('/direct/site.json?_limit=0', { signal });
    const rows = collection(payload, 'site');

    return uniqueBy(
      rows
        .map((row): SakaiCourse | null => {
          const id = stringValue(row.id) || stringValue(row.entityId);
          if (!id) return null;
          const props = recordValue(row.props);
          const term =
            stringValue(props?.term) ||
            stringValue(props?.term_eid) ||
            stringValue(props?.academicSession);
          return {
            id,
            title: decodeHtml(stringValue(row.title) || id),
            description: stringValue(row.shortDescription) || stringValue(row.description),
            ...(term ? { term } : {}),
          };
        })
        .filter((course): course is SakaiCourse => course !== null)
        .sort((a, b) => a.title.localeCompare(b.title, 'es')),
      (course) => course.id,
    );
  }

  async getAnnouncements(): Promise<SakaiAnnouncement[]> {
    const payload = await this.getJson('/direct/announcement/user.json?n=1000&d=3650');
    const rows = collection(payload, 'announcement');

    return uniqueBy(
      rows.map((row, index) => {
        const id =
          stringValue(row.announcementId) ||
          stringValue(row.id) ||
          `${stringValue(row.siteId)}-${stringValue(row.createdOn)}-${index}`;
        return {
          id,
          courseId: stringValue(row.siteId) || undefined,
          courseTitle: decodeHtml(stringValue(row.siteTitle) || 'PoliformaT'),
          title: decodeHtml(stringValue(row.title) || 'Anuncio'),
          body: stringValue(row.body),
          author: decodeHtml(stringValue(row.createdByDisplayName) || 'PoliformaT'),
          createdAt: dateValue(row.createdOn),
          attachments: attachmentList(row.attachments, this.baseUrl),
        };
      }),
      (announcement) => announcement.id,
    ).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }

  getCourseResources(courseId: string, signal?: AbortSignal): Promise<SakaiResource[]> {
    if (signal) return this.fetchCourseResources(courseId, signal);
    const pending = this.resourceRequests.get(courseId);
    if (pending) return pending;
    const request = this.fetchCourseResources(courseId).finally(() => this.resourceRequests.delete(courseId));
    this.resourceRequests.set(courseId, request);
    return request;
  }

  private async fetchCourseResources(courseId: string, signal?: AbortSignal): Promise<SakaiResource[]> {
    const encodedId = encodeURIComponent(courseId);
    const [apiResult, davResult] = await Promise.allSettled([
      this.getJson(`/direct/content/resources/group/${encodedId}.json?depth=all`, { signal }).then((payload) =>
        parseContentResources(payload, courseId, this.baseUrl),
      ),
      this.getWebDavResources(courseId, signal),
    ]);
    for (const [source, result] of [['api', apiResult], ['dav', davResult]] as const) {
      const status = result.status === 'fulfilled' ? 200
        : result.reason instanceof SakaiError ? result.reason.status ?? 0 : 0;
      console.info(`Sakai sync: discovery ${source} status=${status} entries=${result.status === 'fulfilled' ? result.value.length : 0}`);
    }
    if (apiResult.status === 'rejected' && davResult.status === 'rejected') throw apiResult.reason;
    const apiResources = apiResult.status === 'fulfilled' ? apiResult.value : [];
    const davResources = davResult.status === 'fulfilled' ? davResult.value : [];
    return uniqueBy([...apiResources, ...davResources], (resource) => resource.remotePath);
  }

  async downloadResource(
    resource: SakaiResource,
    destination: WritableStream<Uint8Array>,
    signal?: AbortSignal,
    onProgress?: (received: number, total?: number) => void,
  ): Promise<void> {
    const origin = new URL(this.baseUrl).origin;
    let target = resource.downloadUrl;
    for (let hop = 0; hop < 6; hop += 1) {
      let url: URL;
      try {
        url = new URL(target, this.baseUrl);
      } catch {
        throw new SakaiError('El documento tiene una URL no valida.');
      }
      if (url.origin === 'https://cas.upv.es' || /^\/(portal|sakai-login-tool)(\/|$)/.test(url.pathname)) {
        throw new SakaiError('La sesion ha caducado al descargar documentos.', 401);
      }
      if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password) {
        throw new SakaiError('Se bloqueo una descarga fuera del servidor de PoliformaT.');
      }
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) controller.abort();
      try {
        const response = await this.request(url.toString(), {
          headers: { Accept: '*/*' },
          redirect: 'manual',
          signal: controller.signal,
          allowUnauthorized: true,
        });
        console.info(`Sakai sync: download status=${response.status}`);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location) throw new SakaiError('La descarga devolvio una redireccion sin destino.');
          try {
            target = new URL(location, url).toString();
          } catch {
            throw new SakaiError('La descarga devolvio una redireccion no valida.');
          }
          continue;
        }
        if (!response.ok) {
          throw new SakaiError(`PoliformaT rechazo la descarga (${response.status}).`, response.status);
        }
        if (
          /text\/html/i.test(response.headers.get('content-type') ?? '') &&
          resource.contentType && !/html/i.test(resource.contentType)
        ) {
          throw new SakaiError('PoliformaT devolvio una pagina HTML en lugar del documento.');
        }
        if (!response.body) throw new SakaiError('PoliformaT no devolvio el contenido del documento.');
        const reader = response.body.getReader();
        const writer = destination.getWriter();
        const declared = response.headers.get('content-length');
        const total = resource.size ?? (declared && /^\d+$/.test(declared) ? Number(declared) : undefined);
        let received = 0;
        onProgress?.(0, total);
        try {
          for (;;) {
            signal?.throwIfAborted();
            const { done, value } = await reader.read();
            if (done) break;
            await writer.write(value);
            received += value.byteLength;
            onProgress?.(received, total);
          }
          await writer.close();
        } catch (cause) {
          await reader.cancel(cause).catch(() => undefined);
          await writer.abort(cause).catch(() => undefined);
          throw cause;
        } finally {
          reader.releaseLock();
          writer.releaseLock();
        }
        return;
      } finally {
        // Cancelling an unread Response body alone does not stop Expo's native request.
        controller.abort();
        signal?.removeEventListener('abort', cancel);
      }
    }
    throw new SakaiError('La descarga supero el limite de redirecciones.');
  }

  private async getWebDavResources(courseId: string, signal?: AbortSignal): Promise<SakaiResource[]> {
    const davPath = `/dav/group/${encodeURIComponent(courseId)}/`;
    const response = await this.request(davPath, {
      method: 'PROPFIND',
      signal,
      headers: {
        Accept: 'application/xml',
        Depth: 'infinity',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: '<?xml version="1.0"?><propfind xmlns="DAV:"><allprop/></propfind>',
    });
    const xml = await response.text();
    return parseWebDavResources(xml, courseId, this.baseUrl);
  }

  private async getJson(path: string, options?: RequestInit): Promise<unknown> {
    const response = await this.request(path, options);
    return response.json();
  }

  private async request(
    path: string,
    options: RequestInit & { allowUnauthorized?: boolean } = {},
  ): Promise<Response> {
    const { allowUnauthorized = false, headers, ...init } = options;
    const response = await sakaiFetch(new URL(path, this.baseUrl).toString(), {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store',
        ...(this.sessionId ? { Cookie: `JSESSIONID=${this.sessionId}` } : {}),
        ...headers,
      },
    });

    if (!response.ok && !allowUnauthorized) {
      if (response.status === 401 || response.status === 403) {
        throw new SakaiError('La sesion de PoliformaT ha caducado.', response.status);
      }
      throw new SakaiError(`Error de PoliformaT (${response.status}).`, response.status);
    }
    return response;
  }
}

function collection(payload: unknown, prefix: string): UnknownRecord[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];

  const candidates = [payload[`${prefix}_collection`], payload.data, payload.results, payload.items];
  return candidates.find(Array.isArray)?.filter(isRecord) ?? [];
}

export function parseContentResources(
  payload: unknown,
  courseId: string,
  baseUrl: string,
): SakaiResource[] {
  const result: SakaiResource[] = [];

  const visit = (row: UnknownRecord) => {
    const id =
      stringValue(row.resourceId) ||
      stringValue(row.id) ||
      stringValue(row.reference) ||
      stringValue(row.entityReference);
    const rawUrl =
      stringValue(row.accessUrl) || stringValue(row.resourceUrl) || stringValue(row.url);
    const remotePath = extractRemotePath(id || rawUrl, courseId);
    const name =
      decodeHtml(stringValue(row.name) || stringValue(row.title)) ||
      remotePath.split('/').filter(Boolean).pop() ||
      'documento';
    const type = stringValue(row.type) || stringValue(row.resourceType);
    const contentType = stringValue(row.contentType) || stringValue(row.mimeType) ||
      (type.includes('/') ? type : '');
    const isFolder =
      row.container === true ||
      row.collection === true ||
      row.isCollection === true ||
      /collection|folder/i.test(type) ||
      /x-sakai-collection/i.test(contentType) ||
      id.endsWith('/');

    if (remotePath) {
      result.push({
        id: id || `${courseId}:${remotePath}`,
        courseId,
        name,
        remotePath,
        downloadUrl: resourceDownloadUrl(rawUrl, id, courseId, baseUrl),
        ...(isFolder ? { isFolder: true } : {}),
        contentType: contentType || undefined,
        size: numberValue(row.size) ?? numberValue(row.contentLength),
        modifiedAt:
          dateValue(row.modifiedDate) ||
          dateValue(row.lastModified) ||
          dateValue(row.modifiedTime),
      });
    }

    for (const key of ['resourceChildren', 'children', 'resources', 'items', 'content_collection']) {
      const children = row[key];
      if (Array.isArray(children)) children.filter(isRecord).forEach(visit);
    }
  };

  collection(payload, 'content').forEach(visit);
  return result.filter((resource) => Boolean(resource.downloadUrl));
}

export function parseWebDavResources(
  xml: string,
  courseId: string,
  baseUrl: string,
): SakaiResource[] {
  const responses = xml.match(/<(?:[a-z]+:)?response\b[\s\S]*?<\/(?:[a-z]+:)?response>/gi) ?? [];
  return responses.flatMap((response) => {
    const isFolder = /<(?:[a-z]+:)?collection\s*\/?\s*>/i.test(response);
    const href = response.match(/<(?:[a-z]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?href>/i)?.[1];
    if (!href) return [];
    const decodedHref = decodeHtml(href.trim());
    const remotePath = extractRemotePath(decodedHref, courseId);
    if (!remotePath) return [];
    const name = remotePath.split('/').filter(Boolean).pop() || 'documento';
    const sizeMatch = response.match(
      /<(?:[a-z]+:)?getcontentlength\b[^>]*>(\d+)<\/(?:[a-z]+:)?getcontentlength>/i,
    );
    const typeMatch = response.match(
      /<(?:[a-z]+:)?getcontenttype\b[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?getcontenttype>/i,
    );
    const modifiedMatch = response.match(
      /<(?:[a-z]+:)?getlastmodified\b[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?getlastmodified>/i,
    );
    const downloadUrl = new URL(decodedHref, baseUrl).toString();
    return [
      {
        id: decodedHref,
        courseId,
        name,
        remotePath,
        downloadUrl,
        ...(isFolder ? { isFolder: true } : {}),
        contentType: typeMatch ? decodeHtml(typeMatch[1].trim()) : undefined,
        size: sizeMatch ? Number(sizeMatch[1]) : undefined,
        modifiedAt: modifiedMatch ? dateValue(decodeHtml(modifiedMatch[1].trim())) : undefined,
      },
    ];
  });
}

function extractRemotePath(value: string, courseId: string): string {
  if (!value) return '';
  let pathname = value;
  try {
    pathname = new URL(value, SAKAI_BASE_URL).pathname;
  } catch {}

  try {
    pathname = decodeURIComponent(pathname);
  } catch {}

  const escapedId = courseId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return pathname
    .replace(new RegExp(`^.*?/(?:access/content/|content/|dav/)?group/${escapedId}/?`), '')
    .replace(/^\/+/, '')
    .replace(/\/$/, '');
}

function resourceDownloadUrl(rawUrl: string, id: string, courseId: string, baseUrl: string): string {
  if (rawUrl && !rawUrl.includes('/direct/content/')) return new URL(rawUrl, baseUrl).toString();
  const remotePath = extractRemotePath(id, courseId);
  return new URL(
    `/access/content/group/${encodeURIComponent(courseId)}/${remotePath
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`,
    baseUrl,
  ).toString();
}

function attachmentList(value: unknown, baseUrl: string): SakaiAnnouncement['attachments'] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((attachment) => {
    const url = stringValue(attachment.url) || stringValue(attachment.accessUrl);
    if (!url) return [];
    return [
      {
        name:
          decodeHtml(stringValue(attachment.name) || stringValue(attachment.title)) ||
          url.split('/').pop() ||
          'Adjunto',
        url: new URL(url, baseUrl).toString(),
      },
    ];
  });
}

function parseSessionId(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as UnknownRecord;
    return stringValue(parsed.id) || stringValue(parsed.sessionId) || undefined;
  } catch {
    const trimmed = value.trim();
    return /^[a-z0-9._-]+$/i.test(trimmed) ? trimmed : undefined;
  }
}

function safeResponseLocation(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname.replace(/;[^/]*/g, '')}`;
  } catch {
    return 'destino desconocido';
  }
}

function uniqueBy<T>(values: T[], getKey: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [getKey(value), value])).values()];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown): UnknownRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function numberValue(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function dateValue(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  const date = new Date(typeof value === 'number' ? value : String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
