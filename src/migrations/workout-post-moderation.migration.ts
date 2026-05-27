import { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkoutPostModerationMigration implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "havit"."workout_posts_moderation_status_enum" AS ENUM ('pending', 'approved', 'rejected')`,
    );
    await queryRunner.query(
      `ALTER TABLE "havit"."workout_posts" ADD COLUMN IF NOT EXISTS "moderation_status" "havit"."workout_posts_moderation_status_enum" NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "havit"."workout_posts" ADD COLUMN IF NOT EXISTS "moderation_reason" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "havit"."workout_posts" ADD COLUMN IF NOT EXISTS "moderated_at" timestamp`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "havit"."workout_posts" DROP COLUMN IF EXISTS "moderated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "havit"."workout_posts" DROP COLUMN IF EXISTS "moderation_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "havit"."workout_posts" DROP COLUMN IF EXISTS "moderation_status"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "havit"."workout_posts_moderation_status_enum"`,
    );
  }
}