import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrimaryExerciseRelationsMigration implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "havit"."exercise_category_map" ADD COLUMN IF NOT EXISTS "is_primary" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "havit"."exercise_location_map" ADD COLUMN IF NOT EXISTS "is_primary" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_exercise_category_primary" ON "havit"."exercise_category_map" ("exercise_id") WHERE "is_primary" = true`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_exercise_location_primary" ON "havit"."exercise_location_map" ("exercise_id") WHERE "is_primary" = true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "havit"."uq_exercise_location_primary"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "havit"."uq_exercise_category_primary"`,
    );

    await queryRunner.query(
      `ALTER TABLE "havit"."exercise_location_map" DROP COLUMN IF EXISTS "is_primary"`,
    );
    await queryRunner.query(
      `ALTER TABLE "havit"."exercise_category_map" DROP COLUMN IF EXISTS "is_primary"`,
    );
  }
}