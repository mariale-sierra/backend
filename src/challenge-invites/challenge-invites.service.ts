import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ChallengeInvite } from './entities/challenge-invite.entity';
import { Challenge } from '../challenges/entities/challenge.entity';
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class ChallengeInvitesService {
  constructor(
    @InjectRepository(ChallengeInvite)
    private inviteRepo: Repository<ChallengeInvite>,
    @InjectRepository(Challenge)
    private challengeRepo: Repository<Challenge>,
    @InjectRepository(ChallengeUserMap)
    private challengeUserMapRepo: Repository<ChallengeUserMap>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private dataSource: DataSource,
  ) {}

  /**
   * Creates a pending invite. Guards against: unknown challenge/recipient,
   * self-invites, inviting someone already in the challenge, duplicate
   * pending invites, and senders who are not part of the challenge.
   */
  async create(
    senderUserId: string,
    challengeId: string,
    recipientUserId: string,
    message?: string,
  ) {
    if (senderUserId === recipientUserId) {
      throw new BadRequestException('You cannot invite yourself');
    }

    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
    });
    if (!challenge) throw new NotFoundException('Challenge not found');

    const recipient = await this.userRepo.findOne({
      where: { id: recipientUserId, is_active: true },
      select: ['id', 'username'],
    });
    if (!recipient) throw new NotFoundException('Recipient user not found');

    // Only the creator or an active member can invite others.
    const senderMembership = await this.challengeUserMapRepo.findOne({
      where: { challenge_id: challengeId, user_id: senderUserId },
    });
    const isCreator = challenge.created_by_user_id === senderUserId;
    if (
      !isCreator &&
      (!senderMembership || senderMembership.status !== 'active')
    ) {
      throw new ForbiddenException(
        'Only the creator or an active member can send invites for this challenge',
      );
    }

    const recipientMembership = await this.challengeUserMapRepo.findOne({
      where: { challenge_id: challengeId, user_id: recipientUserId },
    });
    if (recipientMembership && recipientMembership.status === 'active') {
      throw new ConflictException('User is already a member of this challenge');
    }
    if (challenge.created_by_user_id === recipientUserId) {
      throw new ConflictException('User is the creator of this challenge');
    }

    const duplicate = await this.inviteRepo.findOne({
      where: {
        challenge_id: challengeId,
        sender_user_id: senderUserId,
        recipient_user_id: recipientUserId,
        status: 'pending',
        is_active: true,
      },
    });
    if (duplicate) {
      throw new ConflictException(
        'There is already a pending invite for this user',
      );
    }

    const invite = this.inviteRepo.create({
      challenge_id: challengeId,
      sender_user_id: senderUserId,
      recipient_user_id: recipientUserId,
      status: 'pending',
      message: message?.trim() || null,
      is_active: true,
    });

    try {
      const saved = await this.inviteRepo.save(invite);
      return this.findOneWithRelations(saved.id);
    } catch (error) {
      // Unique partial index uq_challenge_invite_pending backs this up at the
      // DB level — translate the race-condition duplicate into a 409.
      if ((error as { code?: string })?.code === '23505') {
        throw new ConflictException(
          'There is already a pending invite for this user',
        );
      }
      throw error;
    }
  }

  async listReceived(userId: string) {
    return this.inviteRepo.find({
      where: { recipient_user_id: userId, is_active: true },
      relations: { challenge: true, sender: true, recipient: true },
      order: { created_at: 'DESC' },
    });
  }

  async listSent(userId: string) {
    return this.inviteRepo.find({
      where: { sender_user_id: userId, is_active: true },
      relations: { challenge: true, sender: true, recipient: true },
      order: { created_at: 'DESC' },
    });
  }

  async listPendingReceived(userId: string) {
    return this.inviteRepo.find({
      where: { recipient_user_id: userId, status: 'pending', is_active: true },
      relations: { challenge: true, sender: true, recipient: true },
      order: { created_at: 'DESC' },
    });
  }

  /**
   * Accepting is the only transition with two writes (invite update + member
   * insert), so it runs in a transaction with a row lock on the invite to
   * avoid double-processing under concurrent accepts.
   */
  async accept(inviteId: string, userId: string) {
    await this.dataSource.transaction(async (manager) => {
      const invite = await manager
        .getRepository(ChallengeInvite)
        .createQueryBuilder('invite')
        .setLock('pessimistic_write')
        .where('invite.id = :id', { id: inviteId })
        .getOne();

      if (!invite || !invite.is_active) {
        throw new NotFoundException('Invite not found');
      }
      if (invite.recipient_user_id !== userId) {
        throw new ForbiddenException(
          'Only the invited user can accept this invite',
        );
      }
      this.assertPending(invite);

      invite.status = 'accepted';
      invite.responded_at = new Date();
      await manager.getRepository(ChallengeInvite).save(invite);

      const memberRepo = manager.getRepository(ChallengeUserMap);
      const existing = await memberRepo.findOne({
        where: { challenge_id: invite.challenge_id, user_id: userId },
      });

      if (existing) {
        // Re-activate a previous membership (e.g. the user had left) instead
        // of violating the composite primary key with a duplicate insert.
        if (existing.status !== 'active') {
          existing.status = 'active';
          await memberRepo.save(existing);
        }
      } else {
        await memberRepo.save(
          memberRepo.create({
            challenge_id: invite.challenge_id,
            user_id: userId,
            role: 'participant',
            status: 'active',
          }),
        );
      }
    });

    return this.findOneWithRelations(inviteId);
  }

  async decline(inviteId: string, userId: string) {
    const invite = await this.getActiveInvite(inviteId);
    if (invite.recipient_user_id !== userId) {
      throw new ForbiddenException(
        'Only the invited user can decline this invite',
      );
    }
    this.assertPending(invite);

    invite.status = 'declined';
    invite.responded_at = new Date();
    await this.inviteRepo.save(invite);
    return this.findOneWithRelations(inviteId);
  }

  async cancel(inviteId: string, userId: string) {
    const invite = await this.getActiveInvite(inviteId);
    if (invite.sender_user_id !== userId) {
      throw new ForbiddenException('Only the sender can cancel this invite');
    }
    this.assertPending(invite);

    invite.status = 'cancelled';
    invite.responded_at = new Date();
    await this.inviteRepo.save(invite);
    return this.findOneWithRelations(inviteId);
  }

  private assertPending(invite: ChallengeInvite) {
    if (invite.status !== 'pending') {
      throw new ConflictException(
        `Invite has already been ${invite.status} and cannot be modified`,
      );
    }
    if (invite.expires_at && invite.expires_at.getTime() < Date.now()) {
      throw new ConflictException('Invite has expired');
    }
  }

  private async getActiveInvite(inviteId: string) {
    const invite = await this.inviteRepo.findOne({
      where: { id: inviteId, is_active: true },
    });
    if (!invite) throw new NotFoundException('Invite not found');
    return invite;
  }

  private async findOneWithRelations(inviteId: string) {
    const invite = await this.inviteRepo.findOne({
      where: { id: inviteId },
      relations: { challenge: true, sender: true, recipient: true },
    });
    if (!invite) throw new NotFoundException('Invite not found');
    return invite;
  }
}
