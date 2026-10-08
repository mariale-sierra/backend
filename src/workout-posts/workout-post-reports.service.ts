import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  ContentReport,
  ReportTargetType,
} from './entities/content-report.entity';
import { UserPenalty } from './entities/user-penalty.entity';
import { WorkoutPost } from './entities/workout-post.entity';
import { WorkoutPostComment } from './entities/workout-post-comment.entity';
import {
  CreateReportDto,
  ReportDto,
  ReportTargetPreviewDto,
  ResolveReportDto,
  ResolveReportResultDto,
} from './dto/report.dto';
import { assertPostVisibleToUser } from './workout-post-visibility.util';
import { NotificationsService } from '../notifications/notifications.service';

export const DEFAULT_REPORTS_LIMIT = 20;
export const MAX_REPORTS_LIMIT = 50;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMENT_ID_RE = /^[1-9]\d{0,17}$/;
const PG_UNIQUE_VIOLATION = '23505';

export interface ListReportsResult {
  reports: ReportDto[];
  nextAfter: number | null;
}

/**
 * Sprint 8, Bloque 2 — manual moderation of workout posts and their comments.
 * Chats and spaces are intentionally NOT reportable. Automatic moderation
 * (ModerationService: post photos; B3: comment text) is untouched — this is
 * the human layer on top of it.
 */
@Injectable()
export class WorkoutPostReportsService {
  constructor(
    @InjectRepository(ContentReport)
    private reportRepo: Repository<ContentReport>,
    @InjectRepository(UserPenalty)
    private penaltyRepo: Repository<UserPenalty>,
    @InjectRepository(WorkoutPost)
    private postRepo: Repository<WorkoutPost>,
    @InjectRepository(WorkoutPostComment)
    private commentRepo: Repository<WorkoutPostComment>,
    @InjectDataSource()
    private dataSource: DataSource,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Resolves a still-visible report target and returns its author. Hidden,
   * deleted or unknown content is a 404; a private post (or a comment on one)
   * the reporter can't see is a 403 via assertPostVisibleToUser.
   */
  private async resolveTargetOwner(
    targetType: ReportTargetType,
    targetId: string,
    reporterId: string,
  ): Promise<string> {
    if (targetType === 'post') {
      if (!UUID_RE.test(targetId)) {
        throw new BadRequestException('targetId must be a post UUID');
      }
      const post = await this.postRepo.findOne({
        where: { id: targetId, is_hidden: false, is_active: true },
      });
      if (!post) throw new NotFoundException('Workout post not found');
      assertPostVisibleToUser(post, reporterId);
      return post.user_id;
    }

    if (!COMMENT_ID_RE.test(targetId)) {
      throw new BadRequestException('targetId must be a numeric comment id');
    }
    const comment = await this.commentRepo.findOne({
      where: { id: Number(targetId), is_active: true, is_hidden: false },
      relations: { post: true },
    });
    if (
      !comment ||
      !comment.post ||
      comment.post.is_hidden ||
      !comment.post.is_active
    ) {
      throw new NotFoundException('Comment not found');
    }
    assertPostVisibleToUser(comment.post, reporterId);
    return comment.user_id;
  }

  async create(
    reporterId: string,
    dto: CreateReportDto,
  ): Promise<{ id: number; status: string; message: string }> {
    const ownerId = await this.resolveTargetOwner(
      dto.targetType,
      dto.targetId,
      reporterId,
    );
    if (ownerId === reporterId) {
      throw new BadRequestException('You cannot report your own content');
    }

    const existing = await this.reportRepo.findOne({
      where: {
        reporter_id: reporterId,
        target_type: dto.targetType,
        target_id: dto.targetId,
        status: 'pending',
      },
    });
    if (existing) {
      throw new ConflictException('You already reported this content');
    }

    try {
      const saved = await this.reportRepo.save(
        this.reportRepo.create({
          target_type: dto.targetType,
          target_id: dto.targetId,
          target_owner_id: ownerId,
          reporter_id: reporterId,
          reason: dto.reason,
          details: dto.details?.trim() || null,
          status: 'pending',
        }),
      );
      return { id: saved.id, status: saved.status, message: 'Report received' };
    } catch (err) {
      // Race with a concurrent identical report (uq_content_reports_pending_per_reporter).
      if ((err as { code?: string })?.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('You already reported this content');
      }
      throw err;
    }
  }

  /** Admin queue: pending reports, oldest first, keyset-paginated by id. */
  async listPending(options: {
    after?: number;
    limit?: number;
  }): Promise<ListReportsResult> {
    const limit = Math.min(
      options.limit ?? DEFAULT_REPORTS_LIMIT,
      MAX_REPORTS_LIMIT,
    );

    const qb = this.reportRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.reporter', 'reporter')
      .leftJoinAndSelect('r.targetOwner', 'targetOwner')
      .where("r.status = 'pending'")
      .orderBy('r.id', 'ASC')
      .take(limit + 1);
    if (options.after !== undefined) {
      qb.andWhere('r.id > :after', { after: options.after });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextAfter = hasMore ? Number(page[page.length - 1].id) : null;

    const previews = await this.loadPreviews(page);
    const strikes = await this.strikeCounts(page.map((r) => r.target_owner_id));

    return {
      reports: page.map((r) => {
        const dto = new ReportDto();
        dto.id = Number(r.id);
        dto.targetType = r.target_type;
        dto.targetId = r.target_id;
        dto.reason = r.reason;
        dto.details = r.details ?? null;
        dto.status = r.status;
        dto.createdAt = r.created_at;
        dto.reporter = {
          id: r.reporter_id,
          username: r.reporter?.username ?? '',
        };
        dto.targetOwner = {
          id: r.target_owner_id,
          username: r.targetOwner?.username ?? '',
          strikeCount: strikes.get(r.target_owner_id) ?? 0,
        };
        dto.target = previews.get(`${r.target_type}:${r.target_id}`) ?? {
          exists: false,
          isHidden: false,
          text: null,
          imageUrl: null,
          postId: null,
        };
        return dto;
      }),
      nextAfter,
    };
  }

  private async loadPreviews(
    reports: ContentReport[],
  ): Promise<Map<string, ReportTargetPreviewDto>> {
    const previews = new Map<string, ReportTargetPreviewDto>();
    const postIds = [
      ...new Set(
        reports.filter((r) => r.target_type === 'post').map((r) => r.target_id),
      ),
    ];
    const commentIds = [
      ...new Set(
        reports
          .filter((r) => r.target_type === 'comment')
          .map((r) => Number(r.target_id)),
      ),
    ];

    if (postIds.length > 0) {
      const posts = await this.postRepo.find({ where: { id: In(postIds) } });
      for (const p of posts) {
        previews.set(`post:${p.id}`, {
          exists: true,
          isHidden: p.is_hidden,
          text: p.caption ?? null,
          imageUrl: p.image_url,
          postId: p.id,
        });
      }
    }
    if (commentIds.length > 0) {
      const comments = await this.commentRepo.find({
        where: { id: In(commentIds) },
        relations: { post: true },
      });
      for (const c of comments) {
        previews.set(`comment:${c.id}`, {
          exists: c.is_active,
          isHidden: c.is_hidden,
          text: c.comment_text,
          imageUrl: c.post?.image_url ?? null,
          postId: c.workout_post_id,
        });
      }
    }
    return previews;
  }

  private async strikeCounts(userIds: string[]): Promise<Map<string, number>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    const rows = await this.penaltyRepo
      .createQueryBuilder('p')
      .select('p.user_id', 'userId')
      .addSelect('COUNT(*)', 'count')
      .where('p.user_id IN (:...ids)', { ids: unique })
      .groupBy('p.user_id')
      .getRawMany<{ userId: string; count: string }>();
    return new Map(rows.map((r) => [r.userId, Number(r.count)]));
  }

  /**
   * Resolves a pending report atomically: the report's status, the content's
   * hidden state, the author's penalty and the cascade onto every other
   * pending report for the same content all commit or roll back together.
   *
   * Retry-safety: the report row is locked FOR UPDATE and must still be
   * 'pending' (a second attempt gets 409), and the penalty insert is
   * ON CONFLICT DO NOTHING against UNIQUE (target_type, target_id), so the
   * same content can never produce two penalties.
   */
  async resolve(
    reportId: number,
    adminId: string,
    dto: ResolveReportDto,
  ): Promise<ResolveReportResultDto> {
    const penalize = dto.penalize === true;
    if (penalize && dto.action !== 'hide') {
      throw new BadRequestException(
        "penalize is only allowed together with action='hide'",
      );
    }
    const note = dto.note?.trim() || null;
    let resolved: ContentReport | undefined;
    let siblingReporters: Array<{ reportId: number; reporterId: string }> = [];

    const result = await this.dataSource.transaction<ResolveReportResultDto>(
      async (manager) => {
        const report = await manager.findOne(ContentReport, {
          where: { id: reportId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!report) throw new NotFoundException('Report not found');
        if (report.status !== 'pending') {
          throw new ConflictException('Report already resolved');
        }

        const now = new Date();
        const hide = dto.action === 'hide';
        resolved = report;
        const status = hide ? 'actioned' : 'dismissed';
        let penaltyRecorded = false;
        let alsoResolvedReportIds: number[] = [];

        if (hide) {
          const hiddenFields = {
            is_hidden: true,
            hidden_at: now,
            hidden_reason: `report:${report.id}`,
          };
          if (report.target_type === 'post') {
            await manager.update(
              WorkoutPost,
              { id: report.target_id, is_hidden: false },
              hiddenFields,
            );
          } else {
            await manager.update(
              WorkoutPostComment,
              { id: Number(report.target_id), is_hidden: false },
              hiddenFields,
            );
          }

          if (penalize) {
            const inserted: Array<{ id: number }> = await manager.query(
              `INSERT INTO havit.user_penalties
               (user_id, report_id, target_type, target_id, penalty_type, reason, issued_by)
             VALUES ($1, $2, $3, $4, 'strike', $5, $6)
             ON CONFLICT (target_type, target_id) DO NOTHING
             RETURNING id`,
              [
                report.target_owner_id,
                report.id,
                report.target_type,
                report.target_id,
                note ?? report.reason,
                adminId,
              ],
            );
            penaltyRecorded = inserted.length > 0;
          }

          // Once the content is hidden, every other pending report about it is
          // moot — close them in the same transaction so the admin queue
          // doesn't show already-handled content.
          const siblings = await manager.find(ContentReport, {
            where: {
              target_type: report.target_type,
              target_id: report.target_id,
              status: 'pending',
            },
            lock: { mode: 'pessimistic_write' },
          });
          alsoResolvedReportIds = siblings
            .map((s) => Number(s.id))
            .filter((id) => id !== Number(report.id));
          siblingReporters = siblings
            .filter((s) => Number(s.id) !== Number(report.id))
            .map((s) => ({
              reportId: Number(s.id),
              reporterId: s.reporter_id,
            }));
          if (alsoResolvedReportIds.length > 0) {
            await manager.update(
              ContentReport,
              { id: In(alsoResolvedReportIds), status: 'pending' },
              {
                status: 'actioned',
                resolution_action: 'hide',
                resolution_note: `Resuelto junto con el reporte #${report.id}`,
                resolved_by: adminId,
                resolved_at: now,
              },
            );
          }
        }

        const result = await manager.update(
          ContentReport,
          { id: report.id, status: 'pending' },
          {
            status,
            resolution_action: dto.action,
            resolution_note: note,
            resolved_by: adminId,
            resolved_at: now,
          },
        );
        if (result.affected === 0) {
          throw new ConflictException('Report already resolved');
        }

        return {
          reportId: Number(report.id),
          status,
          action: dto.action,
          contentHidden: hide,
          penaltyRecorded,
          alsoResolvedReportIds,
        };
      },
    );

    if (resolved) {
      this.notifyResolution(resolved, result, siblingReporters);
    }
    return result;
  }

  /**
   * After commit. Reporters learn their report was reviewed (and the
   * outcome); the author learns their content was hidden and whether it
   * counted as a strike. No actor: the reviewing admin isn't revealed.
   * Ids only — never the reported content or the report details.
   */
  private notifyResolution(
    report: ContentReport,
    result: ResolveReportResultDto,
    siblingReporters: Array<{ reportId: number; reporterId: string }>,
  ): void {
    const reporters = [
      { reportId: Number(report.id), reporterId: report.reporter_id },
      ...siblingReporters,
    ];
    for (const { reportId, reporterId } of reporters) {
      void this.notificationsService.notify({
        recipientUserId: reporterId,
        type: 'report_resolved',
        entity: { type: 'content_report', id: reportId },
        data: { outcome: result.status },
      });
    }
    if (result.contentHidden) {
      void this.notificationsService.notify({
        recipientUserId: report.target_owner_id,
        type: 'content_hidden',
        entity: { type: 'content_report', id: report.id },
        data: {
          targetType: report.target_type,
          strike: String(result.penaltyRecorded),
        },
      });
    }
  }
}
