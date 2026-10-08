import { Entity, PrimaryColumn } from 'typeorm';

/** Maps to havit.workout_post_hashtags — many-to-many post <-> hashtag. */
@Entity({ schema: 'havit', name: 'workout_post_hashtags' })
export class WorkoutPostHashtag {
  @PrimaryColumn({ type: 'uuid' })
  workout_post_id!: string;

  @PrimaryColumn({ type: 'bigint' })
  hashtag_id!: number;
}
