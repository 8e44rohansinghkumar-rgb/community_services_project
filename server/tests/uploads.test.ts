/**
 * File upload restrictions and authorised image delivery.
 *
 * Uploads are the classic remote-code-execution vector, so the checks here are
 * about what the server REFUSES as much as what it accepts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  app,
  Session,
  cleanupRun,
  createIssue,
  fakeImageFixture,
  pngFixture,
  signedInAs,
  type TestUser,
} from './helpers';
import { pool } from '../src/db/pool';
import { config } from '../src/config/env';

let citizen: { session: Session; user: TestUser };
let otherCitizen: { session: Session; user: TestUser };
let admin: { session: Session; user: TestUser };
let issueId: string;

beforeAll(async () => {
  citizen = await signedInAs('CITIZEN', 'upload-citizen');
  otherCitizen = await signedInAs('CITIZEN', 'upload-other');
  admin = await signedInAs('ADMIN', 'upload-admin');
  issueId = (await createIssue(citizen.session, { title: 'Upload test issue with photographs' })).id;
});

afterAll(async () => {
  await cleanupRun();
  await pool.end();
});

describe('Accepted uploads', () => {
  it('accepts a valid PNG', async () => {
    const response = await citizen.session
      .post(`/api/issues/${issueId}/images`)
      .field('type', 'ADDITIONAL')
      .attach('images', pngFixture(), 'photo.png');

    expect(response.status).toBe(201);
    expect(response.body.data.images).toHaveLength(1);
  });

  it('stores a server-generated name, never the client filename', async () => {
    const response = await citizen.session
      .post(`/api/issues/${issueId}/images`)
      .field('type', 'ADDITIONAL')
      .attach('images', pngFixture(), '../../etc/passwd.png');

    expect(response.status).toBe(201);
    const imageId = response.body.data.images[0].id;

    const { rows } = await pool.query<{ storage_key: string }>(
      `SELECT storage_key FROM issue_images WHERE id = $1`,
      [imageId],
    );
    const key = rows[0]!.storage_key;
    // A traversal sequence surviving into the storage key would let an
    // attacker write outside the upload directory.
    expect(key).not.toContain('..');
    expect(key).not.toContain('etc/passwd');
    expect(key).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$/);
  });
});

describe('Rejected uploads', () => {
  it('rejects a non-image MIME type', async () => {
    const response = await citizen.session
      .post(`/api/issues/${issueId}/images`)
      .field('type', 'ADDITIONAL')
      .attach('images', Buffer.from('plain text content'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body.success).toBe(false);
  });

  it('rejects a script disguised with an image extension and MIME type', async () => {
    const response = await citizen.session
      .post(`/api/issues/${issueId}/images`)
      .field('type', 'ADDITIONAL')
      .attach('images', fakeImageFixture(), {
        filename: 'shell.png',
        contentType: 'image/png',
      });

    // Magic-number inspection is what catches this; the declared type is a lie.
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body.success).toBe(false);
  });

  it('rejects a double extension such as .php.png', async () => {
    const response = await citizen.session
      .post(`/api/issues/${issueId}/images`)
      .field('type', 'ADDITIONAL')
      .attach('images', fakeImageFixture(), {
        filename: 'payload.php.png',
        contentType: 'image/png',
      });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects an SVG (it can carry script)', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const response = await citizen.session
      .post(`/api/issues/${issueId}/images`)
      .field('type', 'ADDITIONAL')
      .attach('images', svg, { filename: 'vector.svg', contentType: 'image/svg+xml' });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects a file larger than the configured limit', async () => {
    const oversized = Buffer.alloc(config.MAX_FILE_SIZE + 50_000, 0x41);
    const response = await citizen.session
      .post(`/api/issues/${issueId}/images`)
      .field('type', 'ADDITIONAL')
      .attach('images', oversized, { filename: 'huge.png', contentType: 'image/png' });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body.success).toBe(false);
  });

  it('rejects more files than the per-request maximum', async () => {
    let req = citizen.session.post(`/api/issues/${issueId}/images`).field('type', 'ADDITIONAL');
    for (let i = 0; i < config.MAX_FILES_PER_ISSUE + 3; i += 1) {
      req = req.attach('images', pngFixture(), `photo-${i}.png`);
    }
    const response = await req;

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects an upload from a user with no rights over the issue', async () => {
    const response = await otherCitizen.session
      .post(`/api/issues/${issueId}/images`)
      .field('type', 'ADDITIONAL')
      .attach('images', pngFixture(), 'intruder.png');

    expect([403, 404]).toContain(response.status);
  });
});

describe('Authorised image delivery', () => {
  let publicImageId: string;
  let privateIssueId: string;
  let privateImageId: string;

  beforeAll(async () => {
    const upload = await citizen.session
      .post(`/api/issues/${issueId}/images`)
      .field('type', 'ADDITIONAL')
      .attach('images', pngFixture(), 'public-photo.png');
    publicImageId = upload.body.data.images[0].id;

    const privateIssue = await createIssue(citizen.session, {
      title: 'Private issue with a confidential photo',
      isPublic: false,
    });
    privateIssueId = privateIssue.id;
    const privateUpload = await citizen.session
      .post(`/api/issues/${privateIssueId}/images`)
      .field('type', 'ADDITIONAL')
      .attach('images', pngFixture(), 'private-photo.png');
    privateImageId = privateUpload.body.data.images[0].id;
  });

  it('serves an image with hardening headers, never as a static file', async () => {
    const response = await citizen.session.get(`/api/issues/${issueId}/images/${publicImageId}`);

    expect(response.status).toBe(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    // The sandbox CSP means that even if a polyglot slipped through, the
    // browser will not execute it.
    expect(response.headers['content-security-policy']).toContain('sandbox');
    expect(response.headers['content-disposition']).toContain('inline');
  });

  it("refuses another user's private image", async () => {
    const response = await otherCitizen.session.get(`/api/issues/${privateIssueId}/images/${privateImageId}`);
    expect(response.status).toBe(404);
  });

  it('refuses an image id that belongs to a different issue', async () => {
    // Even with a valid image id, the issue in the path must own it.
    const response = await citizen.session.get(`/api/issues/${privateIssueId}/images/${publicImageId}`);
    expect(response.status).toBe(404);
  });

  it('refuses a random image id', async () => {
    const response = await citizen.session.get(
      `/api/issues/${issueId}/images/00000000-0000-4000-8000-000000000000`,
    );
    expect(response.status).toBe(404);
  });

  it('lets an admin read any image', async () => {
    const response = await admin.session.get(`/api/issues/${privateIssueId}/images/${privateImageId}`);
    expect(response.status).toBe(200);
  });

  it('has no static route exposing the upload directory', async () => {
    // Storage lives outside the web root; there must be no path that serves it.
    for (const path of ['/uploads', '/var/uploads', '/uploads/', '/static/uploads']) {
      const response = await request(app).get(path);
      expect(response.status).toBe(404);
    }
  });
});
