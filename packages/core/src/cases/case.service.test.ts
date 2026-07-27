/**
 * Integration tests for case.service — run against the real dev Postgres
 * (DATABASE_URL loaded via `dotenv -e ../../.env.local -e ../../.env` in the
 * package's `test` script; see packages/core/package.json). This establishes
 * the test-DB harness pattern later domain tasks (T3–T8) reuse.
 *
 * Each test that mutates data creates its own rows and cleans them up
 * (create → assert → delete) rather than relying on transaction rollback,
 * since case.service's own functions each open/commit their own Prisma
 * calls (no ambient transaction to hook into from the test).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@docjob/db';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../shared/errors';
import type { Actor } from '../shared/actor';
import * as caseService from './case.service';

describe('case.service (integration, real Postgres)', () => {
  let adminUserId: string;
  let adminActor: Actor;
  const nonAdminActor: Actor = { id: 'not-a-real-user', role: 'DOCTOR', approvedAt: new Date() };
  const createdCaseIds: string[] = [];
  const createdSubmissionIds: string[] = [];
  const createdAttachmentIds: string[] = [];

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: {
        email: `core-case-service-test-${Date.now()}@test.local`,
        passwordHash: 'unused-in-tests',
        name: 'Core Test Admin',
        role: 'ADMIN',
        approvedAt: new Date(),
      },
      select: { id: true },
    });
    adminUserId = admin.id;
    adminActor = { id: admin.id, role: 'ADMIN', approvedAt: new Date() };
  });

  afterAll(async () => {
    if (createdCaseIds.length) {
      await prisma.case.deleteMany({ where: { id: { in: createdCaseIds } } });
    }
    if (createdSubmissionIds.length) {
      await prisma.caseSubmission.deleteMany({ where: { id: { in: createdSubmissionIds } } });
    }
    if (createdAttachmentIds.length) {
      await prisma.caseAttachment.deleteMany({ where: { id: { in: createdAttachmentIds } } });
    }
    await prisma.user.delete({ where: { id: adminUserId } });
  });

  it('getCase throws NotFoundError for a missing id', async () => {
    await expect(caseService.getCase(adminActor, 'does-not-exist')).rejects.toThrow(NotFoundError);
  });

  it('getCase throws UnauthorizedError for no actor', async () => {
    await expect(caseService.getCase(null, 'does-not-exist')).rejects.toThrow(UnauthorizedError);
  });

  it('createCase throws ForbiddenError for a non-admin actor', async () => {
    await expect(
      caseService.createCase(nonAdminActor, { name: 'Should never be created' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('createCase as admin persists and returns a SerializedCase with no solution/taskQuestions', async () => {
    const result = await caseService.createCase(adminActor, {
      name: 'Core Test Case',
      subgroup: 'clinical',
      specialty: 'Cardiology',
    });
    createdCaseIds.push(result.id);

    expect(result.id).toBeTruthy();
    expect(result.name).toBe('Core Test Case');
    expect(result.subgroup).toBe('clinical');
    expect(result).not.toHaveProperty('solution');
    expect(result).not.toHaveProperty('taskQuestions');

    // Confirm it actually persisted (not just returned in-memory).
    const fetched = await caseService.getCase(adminActor, result.id);
    expect(fetched.id).toBe(result.id);
  });

  it('updateCase throws ForbiddenError for a non-admin actor', async () => {
    const created = await caseService.createCase(adminActor, { name: 'Core Test Update-Gate Case' });
    createdCaseIds.push(created.id);

    await expect(
      caseService.updateCase(nonAdminActor, { id: created.id, name: 'should not apply' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('updateCase as admin persists a field change', async () => {
    const created = await caseService.createCase(adminActor, { name: 'Core Test Update Case' });
    createdCaseIds.push(created.id);

    const updated = await caseService.updateCase(adminActor, {
      id: created.id,
      name: 'Core Test Update Case (updated)',
    });
    expect(updated.name).toBe('Core Test Update Case (updated)');
  });

  it('cannot claim a submission message attachment for a catalog case', async () => {
    const submission = await prisma.caseSubmission.create({
      data: {
        authorUserId: adminUserId,
        title: 'Attachment ownership test',
        description: 'Submission used to test mutually exclusive ownership.',
      },
    });
    createdSubmissionIds.push(submission.id);
    const message = await prisma.caseSubmissionMessage.create({
      data: {
        submissionId: submission.id,
        senderId: adminUserId,
        body: 'Opening message.',
      },
    });
    const attachment = await prisma.caseAttachment.create({
      data: {
        uploaderId: adminUserId,
        submissionMessageId: message.id,
        filename: `claimed-${Date.now()}.pdf`,
        originalName: 'claimed.pdf',
        mimeType: 'application/pdf',
        size: 123,
        kind: 'pdf',
      },
    });
    createdAttachmentIds.push(attachment.id);

    await expect(
      caseService.createCase(adminActor, {
        name: 'Must roll back when attachment is already claimed',
        attachmentIds: [attachment.id],
      }),
    ).rejects.toThrow(ValidationError);

    expect(
      await prisma.case.count({
        where: { name: 'Must roll back when attachment is already claimed' },
      }),
    ).toBe(0);
  });

  it('listCases filters by subgroup', async () => {
    const created = await caseService.createCase(adminActor, {
      name: 'Core Test Filter Case',
      subgroup: 'sanepid',
    });
    createdCaseIds.push(created.id);

    const filtered = await caseService.listCases(adminActor, { subgroup: 'sanepid' });
    expect(filtered.some((c) => c.id === created.id)).toBe(true);
    expect(filtered.every((c) => c.subgroup === 'sanepid')).toBe(true);

    const otherSubgroup = await caseService.listCases(adminActor, { subgroup: 'clinical' });
    expect(otherSubgroup.some((c) => c.id === created.id)).toBe(false);
  });
});
