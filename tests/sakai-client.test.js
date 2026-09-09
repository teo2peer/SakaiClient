import { describe, expect, test } from 'bun:test';

import { courseFolderName, resourcePathPlan, resourcePathSegments, sanitizePathSegment } from '../src/lib/paths.ts';
import { SakaiClient, parseContentResources, parseWebDavResources } from '../src/lib/sakai-client.ts';

const casLoginUrl = 'https://cas.upv.es/cas/login?service=https%3A%2F%2Fpoliformat.upv.es%2Fsakai-login-tool%2Fcontainer';
const casForm = '<form id="fm1" action="login"><input name="execution" value="flow&amp;token" /></form>';

function loginResponses(form = casForm) {
  return [
    new Response('', { status: 403 }),
    Response.redirect('https://poliformat.upv.es/sakai-login-tool/container'),
    Response.redirect(casLoginUrl),
    new Response(form),
  ];
}

async function withFetchResponses(responses, run) {
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const requests = [];
  const logs = [];
  console.info = (message) => logs.push(message);
  let previousResponse;
  globalThis.fetch = async (input, init) => {
    if (previousResponse?.body) expect(previousResponse.bodyUsed).toBe(true);
    requests.push({ url: String(input), init });
    previousResponse = responses.shift();
    if (!previousResponse) throw new Error('Unexpected request');
    return previousResponse;
  };
  try {
    await run(requests, logs);
    expect(responses).toHaveLength(0);
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
  }
}

describe('Sakai authentication', () => {
  test.each([301, 302, 303])('follows CAS %i redirects with GET after a DNI login', async (status) => {
    const responses = [
      ...loginResponses(),
      new Response('', { status, headers: { Location: 'https://poliformat.upv.es/sakai-login-tool/container?ticket=ST-test' } }),
      new Response('', { status: 302, headers: { Location: '/portal' } }),
      new Response('', { status: 302, headers: { Location: '/portal/site/~user' } }),
      new Response('<html>Authenticated portal</html>'),
      Response.json({ id: 'session-id', userId: 'user-id', userEid: 'user-eid' }),
    ];

    await withFetchResponses(responses, async (requests) => {
      const client = new SakaiClient('https://poliformat.upv.es');
      const session = await client.login('12345678Z', 'secret');

      expect(session).toEqual({ id: 'session-id', userId: 'user-id', userEid: 'user-eid' });
      expect(requests.map((request) => request.url.replace(/\?_=[0-9]+$/, ''))).toEqual([
        'https://poliformat.upv.es/direct/session',
        'https://poliformat.upv.es/portal/login',
        'https://poliformat.upv.es/sakai-login-tool/container',
        `${casLoginUrl}&renew=true`,
        `${casLoginUrl}&renew=true`,
        'https://poliformat.upv.es/sakai-login-tool/container?ticket=ST-test',
        'https://poliformat.upv.es/portal',
        'https://poliformat.upv.es/portal/site/~user',
        'https://poliformat.upv.es/direct/session/current.json',
      ]);
      expect(requests[4].init.body).toContain('username=12345678Z');
      expect(requests[4].init.body).toContain('execution=flow%26token');
      expect(requests[4].init.body).toContain('submitBtn=');
      for (const { init } of requests.slice(1, -1)) {
        expect(init.redirect).toBe('manual');
        expect(init.credentials).toBe('include');
        expect(new Headers(init.headers).has('cookie')).toBe(false);
      }
      for (const { init } of requests.slice(5, -1)) {
        expect(init.method).toBe('GET');
        expect(init.body).toBeUndefined();
        expect(new Headers(init.headers).has('content-type')).toBe(false);
      }
    });
  });

  test('does not accept another account from cookies without verifying explicit credentials', async () => {
    await withFetchResponses([
      new Response('', { status: 403 }),
      new Response('', { status: 302, headers: { Location: '/portal' } }),
      new Response('<html>Authenticated portal</html>'),
    ], async (requests) => {
      await expect(new SakaiClient().login('12345678Z', 'secret')).rejects.toThrow('verificar las credenciales');
      expect(requests).toHaveLength(3);
    });
  });

  test.each([307, 308])('keeps the POST for a same-origin %i redirect', async (status) => {
    await withFetchResponses([
      ...loginResponses(),
      new Response('', { status, headers: { Location: '/cas/continue' } }),
      new Response('<html>Login completed</html>'),
      Response.json({ id: null, userId: 'user-id', userEid: 'user-eid' }),
    ], async (requests) => {
      await new SakaiClient().login('12345678Z', 'secret');
      expect(requests[5].init.method).toBe('POST');
      expect(requests[5].init.body).toBe(requests[4].init.body);
    });
  });

  test.each([307, 308])('blocks credential forwarding on a cross-origin %i redirect', async (status) => {
    await withFetchResponses([
      ...loginResponses(),
      new Response('', { status, headers: { Location: 'https://poliformat.upv.es/sakai-login-tool/container' } }),
    ], async (requests) => {
      await expect(new SakaiClient().login('12345678Z', 'secret')).rejects.toThrow('reenviaba credenciales');
      expect(requests).toHaveLength(5);
    });
  });

  test.each([
    'https://untrusted.example/cas/login',
    'http://cas.upv.es/cas/login',
    'https://untrusted.example@cas.upv.es/cas/login',
  ])('rejects an unsafe CAS form action: %s', async (action) => {
    await withFetchResponses(loginResponses(casForm.replace('action="login"', `action="${action}"`)), async (requests) => {
      await expect(new SakaiClient().login('12345678Z', 'secret')).rejects.toThrow();
      expect(requests).toHaveLength(4);
    });
  });

  test('blocks off-site redirects without requesting the destination', async () => {
    await withFetchResponses([
      ...loginResponses(),
      Response.redirect('https://untrusted.example/?ticket=ST-private'),
    ], async (requests) => {
      await expect(new SakaiClient().login('12345678Z', 'secret')).rejects.toThrow('servidores permitidos');
      expect(requests).toHaveLength(5);
    });
  });

  test('does not mistake a CAS form returned with HTTP 200 for authentication', async () => {
    await withFetchResponses([...loginResponses(), new Response(casForm)], async (requests) => {
      await expect(new SakaiClient().login('12345678Z', 'secret')).rejects.toThrow('CAS volvio a mostrar el formulario');
      expect(requests).toHaveLength(5);
    });
  });

  test('reports an anonymous gateway without disclosing tickets or URL session identifiers', async () => {
    await withFetchResponses([
      ...loginResponses(),
      Response.redirect('https://poliformat.upv.es/sakai-login-tool/container;jsessionid=private-cookie?ticket=ST-private'),
      new Response('', { status: 302, headers: { Location: '/portal/site/!gateway-es/tool/public-tool' } }),
      new Response('<html>Public gateway</html>'),
      Response.json({ id: null, userId: null, userEid: null, active: true }),
    ], async (requests, logs) => {
      const error = await new SakaiClient().login('12345678Z', 'private-password').catch((error) => error);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('no devolvio una sesion autenticada');
      expect(error.message).toContain('GET 302 poliformat.upv.es/sakai-login-tool/container [ticket presente]');
      expect(error.message).toContain('GET 200 poliformat.upv.es/portal/site/!gateway-es/tool/public-tool');
      for (const sensitive of ['12345678Z', 'private-password', 'ST-private', 'private-cookie', 'flow&token', '?service=']) {
        expect(error.message).not.toContain(sensitive);
        expect(logs.join('\n')).not.toContain(sensitive);
      }
      expect(logs).toContain('Sakai login: authenticated=false');
      expect(requests.filter(({ url }) => new URL(url).pathname.endsWith('/current.json'))).toHaveLength(1);
    });
  });

  test('bounds redirect loops', async () => {
    await withFetchResponses([
      new Response('', { status: 403 }),
      ...Array.from({ length: 12 }, () => new Response('', { status: 302, headers: { Location: '/portal/login' } })),
    ], async (requests) => {
      await expect(new SakaiClient().login('12345678Z', 'secret')).rejects.toThrow('limite de redirecciones');
      expect(requests).toHaveLength(13);
    });
  });

  test('rejects redirects without a Location header', async () => {
    await withFetchResponses([
      new Response('', { status: 403 }),
      new Response('', { status: 302 }),
    ], async () => {
      await expect(new SakaiClient().login('12345678Z', 'secret')).rejects.toThrow('sin destino');
    });
  });
});

describe('Sakai resource discovery', () => {
  test('reads the recursive Sakai resourceChildren tree including empty folders', () => {
    const resources = parseContentResources({ content_collection: [{
      resourceId: '/group/course/', type: 'org.sakaiproject.content.types.folder', name: 'Resources',
      resourceChildren: [{
        resourceId: '/group/course/Empty/', type: 'org.sakaiproject.content.types.folder', name: 'Empty', resourceChildren: [],
      }, {
        resourceId: '/group/course/Topic/', type: 'org.sakaiproject.content.types.folder', name: 'Topic',
        resourceChildren: [{
          resourceId: '/group/course/Topic/notes.pdf', name: 'notes.pdf',
          type: 'org.sakaiproject.content.types.fileUpload', mimeType: 'application/pdf',
          resourceChildren: [],
        }],
      }],
    }] }, 'course', 'https://poliformat.upv.es');
    expect(resources.map(({ remotePath }) => remotePath)).toEqual(['Empty', 'Topic', 'Topic/notes.pdf']);
    expect(resources[0].isFolder).toBe(true);
    expect(resources[2]).toMatchObject({ contentType: 'application/pdf' });
    expect(resources[2].isFolder).toBeUndefined();
  });

  test('reads flat ContentItem entries without IDs or boolean containers', () => {
    const resources = parseContentResources({ content_collection: [{
      title: 'Notes', type: 'application/pdf', container: '/content/group/course/',
      url: 'https://poliformat.upv.es/access/content/group/course/notes.pdf',
    }] }, 'course', 'https://poliformat.upv.es');
    expect(resources[0]).toMatchObject({ name: 'Notes', remotePath: 'notes.pdf', contentType: 'application/pdf' });
    expect(resources[0].isFolder).toBeUndefined();
  });

  test('keeps nested EntityBroker paths', () => {
    const resources = parseContentResources(
      {
        content_collection: [
          {
            id: '/group/course-1/Topic 1/',
            container: true,
            children: [
              {
                resourceId: '/group/course-1/Topic 1/notes.pdf',
                name: 'notes.pdf',
                url: '/access/content/group/course-1/Topic%201/notes.pdf',
                contentType: 'application/pdf',
                size: 4096,
              },
            ],
          },
        ],
      },
      'course-1',
      'https://poliformat.upv.es',
    );

    expect(resources).toHaveLength(2);
    expect(resources[0]).toMatchObject({ remotePath: 'Topic 1', isFolder: true });
    expect(resources[1].remotePath).toBe('Topic 1/notes.pdf');
    expect(resourcePathSegments(resources[1])).toEqual(['Topic 1', 'notes.pdf']);
  });

  test('uses WebDAV as a recursive fallback', () => {
    const resources = parseWebDavResources(
      `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:">
        <d:response><d:href>/dav/group/course-1/Folder/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
        <d:response><d:href>/dav/group/course-1/Folder/slides.pptx</d:href><d:propstat><d:prop><d:getcontentlength>2048</d:getcontentlength><d:getcontenttype>application/vnd.openxmlformats-officedocument.presentationml.presentation</d:getcontenttype></d:prop></d:propstat></d:response>
      </d:multistatus>`,
      'course-1',
      'https://poliformat.upv.es',
    );

    expect(resources).toHaveLength(2);
    expect(resources[0]).toMatchObject({ remotePath: 'Folder', isFolder: true });
    expect(resources[1].remotePath).toBe('Folder/slides.pptx');
    expect(resources[1].size).toBe(2048);
  });
});

describe('local paths', () => {
  test('sanitizes platform-reserved path characters', () => {
    expect(sanitizePathSegment('Unit: 1 / intro?.pdf')).toBe('Unit_ 1 _ intro_.pdf');
    expect(sanitizePathSegment('CON')).toBe('_CON');
    expect(sanitizePathSegment('CON.txt')).toBe('_CON.txt');
    expect(sanitizePathSegment('.gitignore')).toBe('_.gitignore');
  });

  test('only adds an id when course titles collide', () => {
    const courses = [
      { id: 'abcdefgh-1', title: 'Mathematics', description: '' },
      { id: 'abcdefgh-2', title: 'Mathematics', description: '' },
    ];
    expect(courseFolderName(courses[0], courses)).not.toBe(courseFolderName(courses[1], courses));
    expect(courseFolderName(courses[0], courses).startsWith('Mathematics (abcdefgh-')).toBe(true);
    expect(courseFolderName({ id: 'physics', title: 'Physics', description: '' }, courses)).toBe(
      'Physics',
    );
  });

  test('keeps case-only course folders and sanitized resource paths distinct', () => {
    const courses = [
      { id: 'upper', title: 'Physics', description: '' },
      { id: 'lower', title: 'PHYSICS', description: '' },
    ];
    expect(courseFolderName(courses[0], courses)).not.toBe(courseFolderName(courses[1], courses));
    const resources = [
      { id: 'colon', courseId: 'upper', name: 'a:b.pdf', remotePath: 'Topic/a:b.pdf', downloadUrl: '' },
      { id: 'question', courseId: 'upper', name: 'a?b.pdf', remotePath: 'Topic/a?b.pdf', downloadUrl: '' },
      { id: 'case', courseId: 'upper', name: 'A_B.pdf', remotePath: 'Topic/A_B.pdf', downloadUrl: '' },
      { id: 'folder-upper', courseId: 'upper', name: 'x.pdf', remotePath: 'Folder/x.pdf', downloadUrl: '' },
      { id: 'folder-lower', courseId: 'upper', name: 'y.pdf', remotePath: 'folder/y.pdf', downloadUrl: '' },
    ];
    const plan = resourcePathPlan(resources);
    const destinations = resources.map((resource) => plan.get(resource).join('/').toLocaleLowerCase('en-US'));
    expect(new Set(destinations).size).toBe(resources.length);
    expect(destinations.every((destination) => destination.endsWith('.pdf'))).toBe(true);
    expect(plan.get(resources[3])[0]).not.toBe(plan.get(resources[4])[0]);
  });
});
